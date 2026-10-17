import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Anthropic from '@anthropic-ai/sdk';
import { AgentEngine, agentDirectory, agentPrompt, permissionReply, type OpenCodeServer } from '../src/agent.js';
import { startGateway } from '../src/gateway.js';
import { config } from './helpers.js';
import type { Route } from '../src/types.js';

const agentRoute = (): Route => ({ id: 'claude-sonnet-5', tier: 'sonnet', slot: 'sonnet', ref: 'opencode/free-model', label: 'Free · opencode · OpenCode agent', protocol: 'opencode', baseURL: 'opencode://agent', model: 'opencode/free-model', auth: { none: true }, contextTokens: 200000, maxOutputTokens: 32000, vision: false, tools: true, effort: { mode: 'opencode', levels: ['low', 'high'] } });
const sse = (events: object[]) => new Response(new ReadableStream({ start(c) {
  for (const e of events) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`));
  c.close();
} }), { headers: { 'content-type': 'text/event-stream' } });
// A scripted OpenCode server: records calls and replays one agent turn.
function fakeOpenCode(turn: (session: string) => object[]) {
  const calls: Array<{ method: string; path: string; body?: any; auth?: string }> = [];
  let sessions = 0;
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url); const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method: init.method || 'GET', path: u.pathname, body, auth: (init.headers as any)?.authorization });
    assert.ok(u.searchParams.get('directory'));
    if (u.pathname === '/session') return Response.json({ id: `ses_${++sessions}` });
    if (u.pathname === '/event') return sse([{ type: 'server.connected', properties: {} }, ...turn(`ses_${sessions}`)]);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const server = { start: async () => ({ url: 'http://127.0.0.1:9', authorization: 'Basic test' }), close: async () => {} } as unknown as OpenCodeServer;
  return { calls, fetcher, server };
}
const reply = (session: string, text: string) => [
  { type: 'session.status', properties: { sessionID: session, status: { type: 'busy' } } },
  { type: 'message.updated', properties: { sessionID: session, info: { id: 'm_user', role: 'user', sessionID: session } } },
  { type: 'message.part.updated', properties: { sessionID: session, part: { id: 'p_user', messageID: 'm_user', sessionID: session, type: 'text', text: 'SHOULD NOT ECHO' } } },
  // A delta can precede both its part and message metadata.
  { type: 'message.part.delta', properties: { sessionID: session, messageID: 'm_a', partID: 'p_text', field: 'text', delta: text.slice(0, 3) } },
  { type: 'message.updated', properties: { sessionID: session, info: { id: 'm_a', role: 'assistant', sessionID: session, tokens: { input: 10, output: 4, reasoning: 1, cache: { read: 5 } } } } },
  { type: 'permission.asked', properties: { id: 'per_1', sessionID: session, permission: 'bash', patterns: ['rm -rf'] } },
  { type: 'message.part.updated', properties: { sessionID: session, part: { id: 'p_tool', messageID: 'm_a', sessionID: session, type: 'tool', tool: 'read', state: { status: 'completed', title: 'note.txt' } } } },
  { type: 'message.part.updated', properties: { sessionID: session, part: { id: 'p_text', messageID: 'm_a', sessionID: session, type: 'text', text } } },
  { type: 'message.part.updated', properties: { sessionID: 'ses_other', part: { id: 'x', messageID: 'm_a', sessionID: 'ses_other', type: 'text', text: 'OTHER SESSION' } } },
  { type: 'session.idle', properties: { sessionID: session } },
];

test('permission policy allows reads, gates writes by policy, and never auto-answers loops or questions', () => {
  assert.equal(permissionReply('read-only', 'read'), 'once');
  assert.equal(permissionReply('read-only', 'edit'), 'reject');
  assert.equal(permissionReply('read-only', 'external_directory'), 'reject');
  assert.equal(permissionReply('workspace-write', 'bash'), 'once');
  assert.equal(permissionReply('workspace-write', 'external_directory'), 'reject');
  assert.equal(permissionReply('full', 'external_directory'), 'once');
  assert.equal(permissionReply('full', 'doom_loop'), 'reject');
  assert.equal(permissionReply('full', 'question'), 'reject');
});
test('agent prompts carry history once, drop client-tool system prompts, and attach images as files', () => {
  const body = { system: 'Desktop chat style', messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: [{ type: 'text', text: 'Hello' }, { type: 'tool_use', id: 't', name: 'Read', input: { p: 1 } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'data' }, { type: 'text', text: 'Now?' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }] }] };
  const fresh = agentPrompt(body, false);
  assert.match(fresh.parts[0].text, /<conversation_history>[\s\S]*User:\nHi[\s\S]*Assistant:\nHello\n\[Called Read with \{"p":1\}\]/);
  assert.match(fresh.parts[0].text, /latest message:\n\[Tool result t\]\ndata\nNow\?/);
  assert.deepEqual(fresh.parts[1], { type: 'file', mime: 'image/png', filename: 'image-3', url: 'data:image/png;base64,AAA' });
  assert.match(fresh.system, /Desktop chat style/);
  const resumed = agentPrompt({ ...body, tools: [{ name: 'Read' }] }, true);
  assert.ok(!resumed.parts[0].text.includes('conversation_history'));
  assert.ok(!resumed.system.includes('Desktop chat style'));
});
test('agent directory follows Claude Code and Codex working directories, else the bridge workspace', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-agent-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const settings = { workspace: join(dir, 'ws'), permission: 'read-only' as const };
  assert.equal(await agentDirectory({ system: `<env>\nWorking directory: ${dir}\n</env>`, messages: [] }, settings), dir);
  assert.equal(await agentDirectory({ messages: [{ role: 'user', content: `<environment_context>\n  <cwd>${dir}</cwd>\n</environment_context>` }] }, settings), dir);
  assert.equal(await agentDirectory({ system: 'Working directory: /nonexistent/path', messages: [] }, settings), settings.workspace);
});
test('agent turns stream only assistant text and tool notes, apply policy, reuse sessions, and report usage', async () => {
  const fake = fakeOpenCode(session => reply(session, 'pineapple'));
  const engine = new AgentEngine(fake.server, () => ({ workspace: tmpdir(), permission: 'read-only' }), fake.fetcher);
  const events: Array<[string, any]> = [];
  const messages: any[] = [{ role: 'user', content: 'What is in note.txt?' }];
  await engine.run(agentRoute(), { messages, output_config: { effort: 'medium' } }, async (e, d) => { events.push([e, d]); }, new AbortController().signal);
  const text = events.filter(([e]) => e === 'content_block_delta').map(([, d]) => d.delta.text).join('');
  // The early delta is held until its part is known to be text, never dropped or duplicated.
  assert.equal(text, '> ⚙︎ read · note.txt\n\npineapple');
  assert.ok(!text.includes('SHOULD NOT ECHO') && !text.includes('OTHER SESSION'));
  assert.deepEqual(events.at(-2)?.[1].usage, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 5 });
  const prompt = fake.calls.find(c => c.path.endsWith('/prompt_async'))!;
  assert.deepEqual(prompt.body.model, { providerID: 'opencode', modelID: 'free-model' });
  assert.equal(prompt.body.variant, 'low');
  assert.equal(prompt.auth, 'Basic test');
  assert.deepEqual(fake.calls.find(c => c.path === '/permission/per_1/reply')?.body.reply, 'reject');
  assert.deepEqual(fake.calls.find(c => c.path === '/session')?.body.permission, [{ permission: '*', pattern: '*', action: 'ask' }]);
  // The next Desktop turn resumes the same OpenCode session without resending history.
  fake.calls.length = 0;
  await engine.run(agentRoute(), { messages: [...messages, { role: 'assistant', content: [{ type: 'text', text }] }, { role: 'user', content: 'Thanks' }] }, async () => {}, new AbortController().signal);
  assert.equal(fake.calls.some(c => c.path === '/session'), false);
  assert.equal(fake.calls.find(c => c.path.endsWith('/prompt_async'))?.path, '/session/ses_1/prompt_async');
  assert.equal(fake.calls.find(c => c.path.endsWith('/prompt_async'))?.body.parts[0].text, 'Thanks');
});
test('agent errors before any text become client errors; the gateway streams agent routes to the Anthropic SDK', async t => {
  const failing = fakeOpenCode(session => [
    { type: 'session.status', properties: { sessionID: session, status: { type: 'busy' } } },
    { type: 'message.updated', properties: { sessionID: session, info: { id: 'm', role: 'assistant', sessionID: session, error: { name: 'APIError', data: { statusCode: 429, message: 'slow down' } } } } },
    { type: 'session.idle', properties: { sessionID: session } },
  ]);
  const engine = new AgentEngine(failing.server, () => ({ workspace: tmpdir(), permission: 'read-only' }), failing.fetcher);
  await assert.rejects(() => engine.run(agentRoute(), { messages: [{ role: 'user', content: 'x' }] }, async () => {}, new AbortController().signal), (e: any) => e.status === 429);

  const ok = fakeOpenCode(session => reply(session, 'Bridge OK'));
  const cfg = config(); cfg.routes = [agentRoute()];
  const gateway = await startGateway(cfg, { port: 0, agent: new AgentEngine(ok.server, () => ({ workspace: tmpdir(), permission: 'read-only' }), ok.fetcher) });
  t.after(() => gateway.close());
  const client = new Anthropic({ baseURL: gateway.url, apiKey: cfg.token, maxRetries: 0 });
  const message = await client.messages.stream({ model: 'claude-sonnet-5', max_tokens: 64000, tools: [{ name: 'Bash', input_schema: { type: 'object' } }], messages: [{ role: 'user', content: 'go' }] }).finalMessage();
  assert.equal(message.model, 'claude-sonnet-5'); assert.match((message.content[0] as any).text, /Bridge OK$/);
  const once = await client.messages.create({ model: 'claude-sonnet-5', max_tokens: 100, messages: [{ role: 'user', content: 'again' }] });
  assert.match((once.content[0] as any).text, /Bridge OK$/); assert.equal(once.stop_reason, 'end_turn');
});
