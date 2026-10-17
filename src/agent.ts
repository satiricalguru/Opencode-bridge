import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseSSE, type Emit } from './protocol.js';
import { resolveEffort } from './effort.js';
import { BridgeError, isObject, type AgentPermission, type OpenCodeAgentSettings, type Route, type Wire } from './types.js';

// Claude Desktop → bridge → a genuine OpenCode agent session. OpenCode runs the
// model with its own system prompt and tools; Desktop receives the streamed
// answer plus short notes about the tools OpenCode used. Nothing here alters
// how OpenCode identifies itself to its providers.

export const defaultAgentSettings = (): OpenCodeAgentSettings => ({ workspace: join(homedir(), 'OpenCode Bridge'), permission: 'read-only' });
const READ_ONLY = new Set(['read', 'glob', 'grep', 'list', 'lsp', 'codesearch', 'webfetch', 'websearch', 'todoread', 'todowrite', 'skill']);
const WRITE = new Set(['edit', 'write', 'patch', 'apply_patch', 'multiedit', 'bash', 'task']);
export function permissionReply(policy: AgentPermission, permission: string): 'once' | 'reject' {
  // Desktop cannot answer OpenCode's interactive prompts, and loops are never auto-approved.
  if (['doom_loop', 'question'].includes(permission)) return 'reject';
  if (READ_ONLY.has(permission)) return 'once';
  if (policy === 'full') return 'once';
  if (policy === 'workspace-write' && WRITE.has(permission)) return 'once';
  return 'reject';
}

export interface AgentServer { url: string; authorization: string }
export class OpenCodeServer {
  private child?: ChildProcess;
  private starting?: Promise<AgentServer>;
  constructor(private bin = process.env.OPENCODE_BIN || 'opencode', private cwd = homedir(), private startTimeout = 45_000) {}
  start(): Promise<AgentServer> {
    if (!this.starting) this.starting = this.spawn().catch(err => { this.starting = undefined; throw err; });
    return this.starting;
  }
  private async spawn(): Promise<AgentServer> {
    const password = randomBytes(24).toString('hex');
    const child = spawn(this.bin, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: this.cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENCODE_SERVER_PASSWORD: password } });
    this.child = child;
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => fail(new BridgeError(503, 'api_error', 'OpenCode did not start its local server. Check that the OpenCode CLI works in Terminal.')), this.startTimeout);
      const fail = (err: Error) => { clearTimeout(timer); child.kill('SIGTERM'); reject(err); };
      const read = (chunk: Buffer) => {
        output = (output + chunk.toString('utf8')).slice(-8192);
        const match = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      };
      child.stdout!.on('data', read); child.stderr!.on('data', read);
      child.once('error', () => fail(new BridgeError(503, 'api_error', 'OpenCode CLI was not found. Install OpenCode or set OPENCODE_BIN.')));
      child.once('exit', () => fail(new BridgeError(503, 'api_error', 'OpenCode exited while starting its local server.')));
    });
    child.stdout!.resume(); child.stderr!.resume();
    child.once('exit', () => { if (this.child === child) { this.child = undefined; this.starting = undefined; } });
    return { url, authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` };
  }
  async close(): Promise<void> {
    const child = this.child; this.child = undefined; this.starting = undefined;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }
}

// Claude Code's system prompt names its working directory. Use it so the agent
// works in the same project; otherwise fall back to the bridge workspace.
export async function agentDirectory(body: Wire, settings: OpenCodeAgentSettings): Promise<string> {
  const system = systemText(body.system);
  // Codex sends <environment_context><cwd>…</cwd> as an early user message.
  const early = (Array.isArray(body.messages) ? body.messages.slice(0, 4) : []).map(messageText).join('\n');
  const candidates = [
    /(?:Primary working directory|Working directory|cwd):\s*`?(\/[^\n`<]+?)`?\s*(?:\n|<|$)/i.exec(system)?.[1],
    /<cwd>\s*(\/[^<\n]+?)\s*<\/cwd>/.exec(early)?.[1],
  ];
  for (const candidate of candidates) {
    if (!candidate || candidate === '/') continue;
    try { if ((await stat(candidate)).isDirectory()) return candidate; } catch {}
  }
  await mkdir(settings.workspace, { recursive: true, mode: 0o700 });
  return settings.workspace;
}
function systemText(value: unknown): string {
  if (typeof value === 'string') return value;
  return Array.isArray(value) ? value.map(block => typeof block?.text === 'string' ? block.text : '').join('\n') : '';
}
function blockText(block: Wire): string {
  if (block.type === 'text') return block.text || '';
  if (block.type === 'tool_use') return `[Called ${block.name} with ${JSON.stringify(block.input ?? {})}]`;
  if (block.type === 'tool_result') {
    const content = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map((b: Wire) => b.type === 'text' ? b.text : `[${b.type}]`).join('\n') : '';
    return `[${block.is_error ? 'Tool error' : 'Tool result'} ${block.tool_use_id}]\n${content}`;
  }
  if (block.type === 'image') return '[image]';
  if (block.type === 'document') return '[document]';
  return '';
}
export function messageText(message: Wire): string {
  const content = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map(blockText).filter(Boolean).join('\n') : '';
  return content.trim();
}
const transcriptKey = (route: Route, directory: string, messages: Wire[]) => createHash('sha256').update(JSON.stringify([route.ref, directory, messages.map(m => [m.role, messageText(m)])])).digest('hex');

function fileParts(message: Wire): Wire[] {
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((block: Wire, index: number) => {
    if ((block.type === 'image' || block.type === 'document') && block.source?.type === 'base64' && typeof block.source.data === 'string' && typeof block.source.media_type === 'string') {
      return [{ type: 'file', mime: block.source.media_type, filename: `${block.type}-${index + 1}`, url: `data:${block.source.media_type};base64,${block.source.data}` }];
    }
    return [];
  });
}
const PREAMBLE = 'The user is chatting with you from Claude Desktop through OpenCode Bridge. Work with your OpenCode tools when they help; the user sees your final text and a short note for each tool you use. Do not claim to have tools that are not in your tool list.';
export function agentPrompt(body: Wire, resumed: boolean): { system: string; parts: Wire[] } {
  const messages: Wire[] = body.messages;
  const last = messages[messages.length - 1];
  const parts: Wire[] = [];
  let text = messageText(last);
  if (!resumed && messages.length > 1) {
    const history = messages.slice(0, -1).map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}:\n${messageText(m)}`).join('\n\n');
    text = `<conversation_history>\n${history}\n</conversation_history>\n\nContinue the conversation. The user's latest message:\n${text}`;
  }
  parts.push({ type: 'text', text: text || '(empty message)' }, ...fileParts(last));
  // Client tool definitions (Claude Code, Cowork) cannot be executed by OpenCode; a
  // plain chat system prompt is safe to forward and keeps Desktop's style.
  const desktop = Array.isArray(body.tools) && body.tools.length ? '' : systemText(body.system).slice(0, 24_000);
  return { system: desktop ? `${PREAMBLE}\n\n${desktop}` : PREAMBLE, parts };
}

interface Session { id: string; directory: string; expires: number }
export class AgentEngine {
  private sessions = new Map<string, Session>();
  constructor(private server: OpenCodeServer, private settings: () => OpenCodeAgentSettings, private fetcher: typeof fetch = fetch) {}
  private async call(server: AgentServer, path: string, directory: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const response = await this.fetcher(`${server.url}${path}${path.includes('?') ? '&' : '?'}directory=${encodeURIComponent(directory)}`, { ...init, signal, redirect: 'error', headers: { authorization: server.authorization, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers as any } });
    if (!response.ok) { await response.body?.cancel(); throw new BridgeError(502, 'api_error', `OpenCode server rejected ${path.split('?')[0].replace(/ses_\w+|per_\w+|que_\w+/g, ':id')} (HTTP ${response.status}).`); }
    return response;
  }
  private take(key: string): Session | undefined {
    const session = this.sessions.get(key); this.sessions.delete(key);
    return session && session.expires > Date.now() ? session : undefined;
  }
  private remember(key: string, session: Session): void {
    this.sessions.set(key, { ...session, expires: Date.now() + 6 * 3_600_000 });
    while (this.sessions.size > 128) this.sessions.delete(this.sessions.keys().next().value!);
  }
  // Streams one Desktop turn as Anthropic Messages events.
  async run(route: Route, body: Wire, emit: Emit, signal: AbortSignal): Promise<void> {
    const settings = this.settings();
    const directory = await agentDirectory(body, settings);
    const messages: Wire[] = body.messages;
    if (messages[messages.length - 1]?.role !== 'user') throw new BridgeError(400, 'invalid_request_error', 'The OpenCode agent needs a user message to respond to.');
    const server = await this.server.start();
    const prior = this.take(transcriptKey(route, directory, messages.slice(0, -1)));
    const session = prior?.directory === directory ? prior : { id: (await (await this.call(server, '/session', directory, { method: 'POST', body: JSON.stringify({ title: `Claude Desktop · ${route.ref}`, permission: [{ permission: '*', pattern: '*', action: 'ask' }] }) }, signal)).json() as Wire).id, directory, expires: 0 };
    if (typeof session.id !== 'string') throw new BridgeError(502, 'api_error', 'OpenCode did not create a session.');
    const { system, parts } = agentPrompt(body, !!prior);
    const slash = route.ref.indexOf('/');
    const variant = resolveEffort(route.effortOverride || body.output_config?.effort, route.effort);
    const prompt = { model: { providerID: route.ref.slice(0, slash), modelID: route.ref.slice(slash + 1) }, system, parts, ...(variant ? { variant } : {}) };

    const events = new AbortController();
    const stop = () => events.abort();
    signal.addEventListener('abort', stop, { once: true });
    const stream = await this.call(server, '/event', directory, { headers: { accept: 'text/event-stream' } }, events.signal);
    const id = `msg_${randomBytes(12).toString('hex')}`;
    await emit('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: route.id, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
    let open = false; let written = ''; let lastPart = '';
    const say = async (text: string, part: string) => {
      if (!text) return;
      if (!open) { open = true; await emit('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }); }
      if (part !== lastPart && written && !written.endsWith('\n\n')) text = `${written.endsWith('\n') ? '\n' : '\n\n'}${text}`;
      lastPart = part; written += text;
      await emit('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
    };
    const roles = new Map<string, string>(); const types = new Map<string, string>();
    const emitted = new Map<string, number>(); const pending = new Map<string, Wire[]>(); const noted = new Set<string>();
    const usage = new Map<string, Wire>();
    let sent = false; let busy = false; let failure: BridgeError | undefined;
    const ours = (p: Wire) => (p.sessionID || p.part?.sessionID || p.info?.sessionID) === session.id;
    const textPart = async (part: Wire) => {
      if (roles.get(part.messageID) !== 'assistant') return;
      const full = typeof part.text === 'string' ? part.text : '';
      const done = emitted.get(part.id) || 0;
      if (full.length > done) { emitted.set(part.id, full.length); await say(full.slice(done), part.id); }
    };
    const early = new Map<string, Wire>();
    const handlePart = async (part: Wire) => {
      if (roles.get(part.messageID) !== 'assistant') return;
      if (part.type === 'text') await textPart(part);
      if (part.type === 'tool' && ['completed', 'error'].includes(part.state?.status) && !noted.has(part.id)) {
        noted.add(part.id);
        const title = typeof part.state?.title === 'string' && part.state.title ? ` · ${part.state.title.replace(/\s+/g, ' ').slice(0, 160)}` : '';
        await say(`> ⚙︎ ${part.tool}${title}${part.state.status === 'error' ? ' — not completed' : ''}\n\n`, part.id);
      }
    };
    // Parts and deltas can arrive before their message's role is known.
    const flush = async (messageID: string) => {
      for (const [key, part] of [...early]) if (part.messageID === messageID) { early.delete(key); await handlePart(part); }
      for (const [key, items] of [...pending]) {
        if (items[0]?.messageID !== messageID || !types.has(key)) continue;
        pending.delete(key);
        if (types.get(key) === 'text' && roles.get(messageID) === 'assistant') for (const item of items) { emitted.set(key, (emitted.get(key) || 0) + item.delta.length); await say(item.delta, key); }
      }
    };
    try {
      for await (const item of parseSSE(stream.body!)) {
        let event: Wire;
        try { event = JSON.parse(item.data); } catch { continue; }
        const p: Wire = event.properties || {};
        if (event.type === 'server.connected' && !sent) {
          sent = true;
          await this.call(server, `/session/${session.id}/prompt_async`, directory, { method: 'POST', body: JSON.stringify(prompt) }, signal);
          continue;
        }
        if (!sent || !ours(p)) continue;
        switch (event.type) {
          case 'message.updated': {
            const info = p.info || {};
            roles.set(info.id, info.role);
            if (info.role === 'assistant') {
              busy = true;
              if (info.tokens) usage.set(info.id, info.tokens);
              if (info.error && info.error.name !== 'MessageAbortedError') failure = agentError(info.error);
            }
            await flush(info.id);
            break;
          }
          case 'message.part.updated': {
            const part = p.part || {};
            types.set(part.id, part.type);
            if (!roles.has(part.messageID)) { early.set(part.id, part); break; }
            await flush(part.messageID); await handlePart(part);
            break;
          }
          case 'message.part.delta': {
            if (p.field !== 'text' || typeof p.delta !== 'string') break;
            const kind = types.get(p.partID);
            if (kind === 'text' && roles.get(p.messageID) === 'assistant') { emitted.set(p.partID, (emitted.get(p.partID) || 0) + p.delta.length); await say(p.delta, p.partID); }
            else if (!kind || !roles.has(p.messageID)) pending.set(p.partID, [...(pending.get(p.partID) || []), { messageID: p.messageID, delta: p.delta }]);
            break;
          }
          case 'permission.asked': {
            const reply = permissionReply(settings.permission, String(p.permission));
            await this.call(server, `/permission/${p.id}/reply`, directory, { method: 'POST', body: JSON.stringify(reply === 'reject' ? { reply, message: `OpenCode Bridge policy (${settings.permission}) does not allow ${p.permission}. Continue without it.` } : { reply }) }, signal);
            break;
          }
          case 'question.asked': {
            await this.call(server, `/question/${p.id}/reject`, directory, { method: 'POST' }, signal).catch(() => {});
            break;
          }
          case 'session.error': {
            if (p.error && p.error.name !== 'MessageAbortedError') failure = agentError(p.error);
            break;
          }
          case 'session.status': if (p.status?.type === 'busy') busy = true; else if (p.status?.type === 'idle' && busy) events.abort(); break;
          case 'session.idle': if (busy) events.abort(); break;
        }
        if (events.signal.aborted) break;
      }
    } catch (err) {
      if (!events.signal.aborted) throw err;
    } finally {
      signal.removeEventListener('abort', stop);
      events.abort();
    }
    if (signal.aborted) {
      await this.call(server, `/session/${session.id}/abort`, directory, { method: 'POST' }).catch(() => {});
      throw new BridgeError(499, 'api_error', 'Request cancelled.');
    }
    if (failure && !written) throw failure;
    if (!busy) throw new BridgeError(502, 'api_error', 'OpenCode ended the event stream before answering.');
    if (failure) await say(`\n\n_OpenCode reported an error: ${failure.message}_`, 'error');
    if (!open) { await emit('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }); }
    await emit('content_block_stop', { type: 'content_block_stop', index: 0 });
    const totals = [...usage.values()].reduce((a, t) => ({ input: a.input + (t.input || 0), output: a.output + (t.output || 0) + (t.reasoning || 0), cache: a.cache + (t.cache?.read || 0) }), { input: 0, output: 0, cache: 0 });
    await emit('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: totals.input, output_tokens: totals.output, cache_read_input_tokens: totals.cache } });
    await emit('message_stop', { type: 'message_stop' });
    this.remember(transcriptKey(route, directory, [...messages, { role: 'assistant', content: written }]), session);
  }
}
function agentError(error: Wire): BridgeError {
  const data = isObject(error.data) ? error.data : {};
  const status = Number.isSafeInteger(data.statusCode) ? data.statusCode : 0;
  if (error.name === 'ProviderAuthError' || status === 401) return new BridgeError(401, 'authentication_error', 'OpenCode could not authenticate this provider. Reconnect it in OpenCode.');
  if (status === 429) return new BridgeError(429, 'rate_limit_error', 'The model provider rate limit was reached. Try again shortly.');
  if (error.name === 'ContextOverflowError') return new BridgeError(400, 'invalid_request_error', 'The conversation is larger than this model’s context window.');
  // OpenCode's own messages are short and contain no request content; keep them bounded.
  const message = typeof data.message === 'string' ? data.message.replace(/\s+/g, ' ').slice(0, 300) : error.name || 'unknown error';
  return new BridgeError(status >= 400 && status < 500 ? status : 502, 'api_error', `OpenCode: ${message}`);
}
