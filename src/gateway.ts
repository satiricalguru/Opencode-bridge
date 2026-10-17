import { createServer, type Server, type ServerResponse, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { credentials, providerConfig, resolveEnv } from './opencode.js';
import { BridgeError, invalid, isObject, type BridgeConfig, type Route, type Wire } from './types.js';
import { estimateTokens, fromChat, normalizeSystemMessages, parseSSE, ReasoningReplay, toChat, translateChatStream, validateRequest, type Emit } from './protocol.js';
import { AgentEngine, defaultAgentSettings, OpenCodeServer } from './agent.js';
import { resolveEffort } from './effort.js';
import { toMessages, ResponsesTranslator } from './responses.js';
import type { IncomingHttpHeaders } from 'node:http';
import { validateConfig } from './config.js';
import { routePresentation } from './slots.js';

export const SERVICE = 'opencode-claude-bridge';
export const VERSION = '0.3.0';
export interface Gateway {
  server: Server;
  url: string;
  close(): Promise<void>;
}
export interface GatewayOptions {
  port?: number;
  fetch?: typeof fetch;
  credential?: (route: Route) => Promise<string | undefined>;
  log?: (record: Wire) => void;
  agent?: AgentEngine;
}
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function errorResponse(err: unknown): { status: number; body: Wire } {
  const e = err instanceof BridgeError ? err : new BridgeError(502, 'api_error', 'Gateway or upstream request failed. Check connection availability.');
  return { status: e.status, body: { type: 'error', error: { type: e.type, message: e.message } } };
}
async function requestBody(req: IncomingMessage): Promise<Wire> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8 * 1024 * 1024) throw new BridgeError(413, 'request_too_large', 'Request body exceeds 8 MiB.');
    chunks.push(chunk);
  }
  let data: unknown;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { invalid('Request body must be valid JSON.'); }
  if (!isObject(data)) invalid('Request body must be a JSON object.');
  return data;
}
function authorized(req: IncomingMessage, token: string): boolean {
  const supplied = req.headers.authorization?.replace(/^Bearer /i, '') || req.headers['x-api-key'];
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied); const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function resolveRoute(config: BridgeConfig, model: unknown, codex = false): Route {
  if (typeof model !== 'string') invalid('model is required.');
  if (codex) {
    const route = config.codexRoutes?.find(r => r.id === model || r.ref === model) || config.routes.find(r => r.id === model || r.ref === model) || config.codexRoutes?.[0];
    if (!route) invalid('No Codex model is configured. Choose one in OpenCode Bridge.');
    return route;
  }
  const route = config.routes.find(r => r.id === model || r.ref === model) || config.routes.find(r => r.tier === model && routePresentation(r).familyDefault);
  if (!route) invalid(`Unknown model route. Select an ID advertised by /v1/models.`);
  return route;
}
export function modelCatalog(config: BridgeConfig): Wire {
  const data = config.routes.map(route => ({
    id: route.id, type: 'model', display_name: route.label, created_at: '2026-09-17T00:00:00Z',
    max_tokens: route.maxOutputTokens, anthropic_family_tier: route.tier, is_family_default: routePresentation(route).familyDefault,
  }));
  return { data, first_id: data[0]?.id, last_id: data.at(-1)?.id, has_more: false };
}
async function writeEvent(res: ServerResponse, event: string, data: Wire): Promise<void> {
  if (res.destroyed || res.writableEnded || !res.writable) throw new Error('Client disconnected.');
  if (!res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { res.off('drain', drain); res.off('close', closed); };
      const drain = () => { cleanup(); resolve(); };
      const closed = () => { cleanup(); reject(new Error('Client disconnected.')); };
      res.once('drain', drain); res.once('close', closed);
    });
  }
}
function upstreamError(status: number): BridgeError {
  if (status === 401 || status === 403) return new BridgeError(status, 'authentication_error', `Upstream rejected the configured connection (HTTP ${status}).`);
  if (status === 429) return new BridgeError(429, 'rate_limit_error', 'Upstream rate limit reached.');
  return new BridgeError(status >= 400 && status < 500 ? status : 502, status >= 400 && status < 500 ? 'invalid_request_error' : 'api_error', `Upstream rejected the request (HTTP ${status}).`);
}
async function classifiedUpstreamError(response: Response): Promise<BridgeError> {
  // Read a bounded error envelope, never echo provider messages, keys, or request data.
  const reader = response.body?.getReader();
  if (!reader) return upstreamError(response.status);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 64 * 1024) return upstreamError(response.status);
      chunks.push(value);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (response.status === 403 && data?.error?.type === 'FreeTierError') return new BridgeError(403, 'permission_error', 'OpenCode restricts this free-tier route to OpenCode itself. Select a provider API-key route or a local model.');
  } catch {} finally { await reader.cancel().catch(() => {}); }
  return upstreamError(response.status);
}
// Applies the pinned or requested effort, mapped onto levels the backend advertises.
export function applyEffort(body: Wire, route: Route): Wire {
  const requested = route.effortOverride || body.output_config?.effort;
  if (!route.effort) {
    if (route.protocol === 'chat' && body.output_config?.effort !== undefined) { const { effort: _, ...rest } = body.output_config; body = { ...body, output_config: rest }; }
    if (route.protocol === 'chat' && body.thinking?.type === 'adaptive') { const { thinking: _, ...rest } = body; body = rest; }
    return body;
  }
  const effort = resolveEffort(requested, route.effort);
  if (effort) return { ...body, output_config: { ...body.output_config, effort } };
  if (body.output_config?.effort === undefined) return body;
  const { effort: _, ...rest } = body.output_config;
  return { ...body, output_config: rest };
}
interface Exchange { headers: IncomingHttpHeaders; signal: AbortSignal; setHeader(name: string, value: string): void }
export async function startGateway(config: BridgeConfig, options: GatewayOptions = {}): Promise<Gateway> {
  validateConfig(config);
  const replay = new ReasoningReplay(); const controllers = new Set<AbortController>(); let active = 0; let routed = 0;
  const ownedServer = options.agent ? undefined : new OpenCodeServer();
  const agent = options.agent || new AgentEngine(ownedServer!, () => config.opencode || defaultAgentSettings());
  // Shared by Messages and Responses. Normalizes the request, then either streams
  // Anthropic events through emit or returns one Anthropic message.
  async function forward(route: Route, input: Wire, exchange: Exchange, emit?: Emit): Promise<Wire | void> {
    let body = applyEffort(normalizeSystemMessages(input), route);
    // Desktop chooses output budgets from the Claude family ID (64k in the
    // observed Sonnet request), even when its selected backend has a lower cap.
    // max_tokens is an upper bound: enforce the advertised backend budget.
    if (Number.isSafeInteger(body.max_tokens) && body.max_tokens > route.maxOutputTokens) {
      body.max_tokens = route.maxOutputTokens;
      exchange.setHeader('x-bridge-max-tokens', String(body.max_tokens));
    }
    if (route.protocol === 'anthropic' && body.thinking?.type === 'enabled' && Number.isSafeInteger(body.thinking.budget_tokens) && Number.isSafeInteger(body.max_tokens) && body.thinking.budget_tokens >= body.max_tokens) {
      if (body.max_tokens <= 1024) invalid('The backend output budget is too small for explicit Anthropic thinking. Disable thinking for this model.');
      body.thinking = { ...body.thinking, budget_tokens: body.max_tokens - 1 };
    }
    if (route.protocol === 'opencode') {
      if (!Array.isArray(body.messages) || !body.messages.length) invalid('messages must be a nonempty array.');
      if (emit) return agent.run(route, body, emit, exchange.signal);
      return collect(handler => agent.run(route, body, handler, exchange.signal));
    }
    validateRequest(body, route);
    const outgoing = route.protocol === 'chat' ? toChat({ ...body, stream: !!emit }, route, replay) : { ...body, stream: !!emit, model: route.model };
    const key = await (options.credential || credentials)(route);
    const headers = new Headers({ 'content-type': 'application/json', 'user-agent': `${SERVICE}/${VERSION}` });
    // Incoming credentials never reach upstream. Resolve selected provider headers at runtime.
    const cfg = options.credential ? {} : await providerConfig(route.auth.provider || '');
    for (const [name, value] of Object.entries({ ...cfg.options?.headers, ...route.headers })) {
      if (typeof value !== 'string' || /cookie|host|content-length|authorization|api.?key/i.test(name)) continue;
      headers.set(name, resolveEnv(value) as string);
    }
    const incoming = exchange.headers;
    if (route.protocol === 'anthropic') {
      headers.set('anthropic-version', typeof incoming['anthropic-version'] === 'string' ? incoming['anthropic-version'] : '2023-06-01');
      if (typeof incoming['anthropic-beta'] === 'string') headers.set('anthropic-beta', incoming['anthropic-beta']);
      if (key) headers.set('x-api-key', key);
    } else if (key) headers.set('authorization', `Bearer ${key}`);
    for (const name of ['x-opencode-session', 'x-claude-code-session-id']) if (typeof incoming[name] === 'string') headers.set(name, incoming[name]);
    const response = await (options.fetch || fetch)(`${route.baseURL}/${route.protocol === 'chat' ? 'chat/completions' : 'messages'}`, { method: 'POST', headers, body: JSON.stringify(outgoing), signal: exchange.signal, redirect: 'error' });
    if (!response.ok) throw await classifiedUpstreamError(response);
    if (!emit) {
      const data = await response.json() as Wire;
      if (route.protocol === 'anthropic' && (!isObject(data) || data.type !== 'message' || !Array.isArray(data.content))) throw new BridgeError(502, 'api_error', 'Invalid native upstream message.');
      return route.protocol === 'chat' ? fromChat(data, route, replay) : { ...data, model: route.id };
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new BridgeError(502, 'api_error', 'Expected an upstream event stream.'); }
    if (route.protocol === 'chat') return translateChatStream(response.body, route, replay, emit);
    let complete = false;
    for await (const item of parseSSE(response.body)) {
      if (item.event === 'ping') { await emit('ping', { type: 'ping' }); continue; }
      let data: Wire;
      try { data = JSON.parse(item.data); } catch { throw new BridgeError(502, 'api_error', 'Invalid native stream JSON.'); }
      if (item.event === 'message_start' && data.message) data.message.model = route.id;
      if (item.event === 'error') throw new BridgeError(502, 'api_error', 'Upstream reported a native stream error.');
      await emit(item.event, data);
      if (item.event === 'message_stop') { complete = true; break; }
    }
    if (!complete) throw new BridgeError(502, 'api_error', 'Native stream ended before message_stop.');
  }
  const server = createServer(async (req, res) => {
    // Anthropic's beta SDK adds ?beta=true to Messages/count_tokens, and model
    // listing adds pagination parameters. Match the path, never the full URL.
    const path = (req.url || '').split('?')[0].replace(/\/{2,}/g, '/');
    const started = Date.now(); let route: Route | undefined; let keepAlive: NodeJS.Timeout | undefined;
    let requestSummary: Wire = {};
    let controller: AbortController | undefined; let admitted = false; let outcome = 'completed';
    let responses: ResponsesTranslator | undefined;
    try {
      // Native client only. Host restrictions also defend against DNS rebinding.
      const port = (server.address() as any)?.port;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
      if (!allowedHosts.includes(req.headers.host || '') || req.headers.origin !== undefined || !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress || '')) throw new BridgeError(403, 'permission_error', 'Native loopback clients only.');
      if (path === '/health' && req.method === 'GET') {
        json(res, 200, { service: SERVICE, version: VERSION, pid: process.pid, ready: true, routes: healthRoutes(config), routed, active }); return;
      }
      if (!authorized(req, config.token)) throw new BridgeError(401, 'authentication_error', 'Bridge credential required.');
      if (path === '/v1/models' || path.startsWith('/v1/models/')) {
        if (req.method !== 'GET') throw new BridgeError(405, 'invalid_request_error', 'Use GET.');
        const catalog = modelCatalog(config);
        if (path !== '/v1/models') {
          let id: string;
          try { id = decodeURIComponent(path.slice('/v1/models/'.length)); } catch { invalid('Invalid model ID encoding.'); }
          const model = catalog.data.find((item: Wire) => item.id === id);
          if (!model) throw new BridgeError(404, 'not_found_error', 'Unknown model ID. Select an ID advertised by /v1/models.');
          json(res, 200, model); return;
        }
        json(res, 200, catalog); return;
      }
      const codex = path === '/v1/responses' || path === '/responses';
      if (!codex && !['/v1/messages', '/v1/messages/count_tokens'].includes(path)) throw new BridgeError(404, 'not_found_error', 'Unknown endpoint.');
      if (req.method !== 'POST') throw new BridgeError(405, 'invalid_request_error', 'Use POST.');
      if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) invalid('Content-Type must be application/json.');
      if (active >= 8) throw new BridgeError(429, 'rate_limit_error', 'Gateway concurrency limit reached.');
      active++; admitted = true;
      const raw = await requestBody(req); route = resolveRoute(config, raw.model, codex);
      const translated = codex ? toMessages(raw, route) : undefined;
      const body = translated ? translated.anthropic : raw;
      const streaming = codex ? raw.stream !== false : !!body.stream;
      if (options.log) requestSummary = {
        ...(codex ? { api: 'responses' } : {}),
        ...(Number.isSafeInteger(body.max_tokens) ? { requestedMaxTokens: body.max_tokens } : {}),
        estimatedInputTokens: estimateTokens(body),
        ...(Array.isArray(body.tools) ? { toolsCount: body.tools.length } : {}),
        ...(['enabled', 'disabled', 'adaptive'].includes(body.thinking?.type) ? { thinkingMode: body.thinking.type } : {}),
        ...(typeof body.output_config?.effort === 'string' ? { requestedEffort: body.output_config.effort } : {}),
      };
      if (path === '/v1/messages/count_tokens') {
        if (!Array.isArray(body.messages)) invalid('messages must be an array.');
        res.setHeader('x-bridge-token-count', 'estimated'); json(res, 200, { input_tokens: estimateTokens(body) }); return;
      }
      controller = new AbortController(); controllers.add(controller);
      const abort = controller;
      req.on('aborted', () => abort.abort());
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      // Agent turns run tools and can legitimately take much longer than one completion.
      const timeout = setTimeout(() => abort.abort(), route.protocol === 'opencode' ? 1_800_000 : 300_000); timeout.unref();
      const exchange: Exchange = { headers: req.headers, signal: controller.signal, setHeader: (name, value) => { if (!res.headersSent) res.setHeader(name, value); } };
      try {
        if (translated) {
          const sse = streaming;
          const write = async (event: string, data: Wire) => { if (sse) await writeEvent(res, event, data); };
          if (sse) { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-store', 'x-accel-buffering': 'no' }); res.flushHeaders(); }
          responses = new ResponsesTranslator(translated, write);
          await responses.start();
          if (sse) { keepAlive = setInterval(() => { if (!res.destroyed) res.write(': keep-alive\n\n'); }, 15_000); keepAlive.unref(); }
          await forward(route, body, exchange, responses.handle);
          const final = await responses.finish();
          if (sse) res.end(); else json(res, 200, final);
        } else if (streaming) {
          let begun = false;
          const begin = () => { if (begun) return; begun = true; res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-store', 'x-accel-buffering': 'no' }); res.flushHeaders(); keepAlive = setInterval(() => { if (!res.destroyed) void writeEvent(res, 'ping', { type: 'ping' }).catch(() => abort.abort()); }, 15_000); keepAlive.unref(); };
          // Native/Chat routes surface upstream failures as HTTP status; agent turns start streaming at once.
          if (route.protocol === 'opencode') begin();
          await forward(route, body, exchange, async (event, data) => { begin(); await writeEvent(res, event, data); });
          begin(); res.end();
        } else json(res, 200, await forward(route, body, exchange));
        routed++;
      } finally { clearTimeout(timeout); }
    } catch (err) {
      outcome = controller?.signal.aborted ? 'cancelled' : 'failed';
      const failure = errorResponse(err);
      if (!res.destroyed && !res.writableEnded) {
        if (res.headersSent) {
          if (responses) await responses.fail(failure.body.error.type, failure.body.error.message).catch(() => {});
          else await writeEvent(res, 'error', failure.body).catch(() => {});
          res.end();
        } else json(res, failure.status, failure.body);
      }
    } finally {
      if (keepAlive) clearInterval(keepAlive);
      if (controller) controllers.delete(controller);
      if (admitted) active--;
      if (route && path !== '/v1/messages/count_tokens' && admitted) options.log?.({ timestamp: new Date().toISOString(), route: route.id, backend: route.ref, protocol: route.protocol, status: res.statusCode, outcome, durationMs: Date.now() - started, ...requestSummary });
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? config.port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return { server, url: `http://127.0.0.1:${(server.address() as any).port}`, close: async () => {
    for (const controller of controllers) controller.abort();
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await ownedServer?.close();
  } };
}
export function healthRoutes(config: BridgeConfig): Wire[] {
  return [...config.routes, ...(config.codexRoutes || []).map(r => ({ ...r, id: `codex:${r.id}` }))].map(r => ({ id: r.id, ref: r.ref, protocol: r.protocol, ...(r.effortOverride ? { effort: r.effortOverride } : {}) }));
}
// Gathers an Anthropic event stream into one non-streaming message.
export async function collect(run: (emit: Emit) => Promise<void>): Promise<Wire> {
  let message: Wire = {}; const blocks: Wire[] = [];
  await run(async (event, data) => {
    if (event === 'message_start') message = { ...data.message };
    else if (event === 'content_block_start') blocks[data.index] = { ...data.content_block };
    else if (event === 'content_block_delta' && blocks[data.index]) {
      const block = blocks[data.index];
      if (data.delta.type === 'text_delta') block.text = (block.text || '') + data.delta.text;
      if (data.delta.type === 'input_json_delta') block.partial = (block.partial || '') + data.delta.partial_json;
    } else if (event === 'message_delta') message = { ...message, ...data.delta, usage: { ...message.usage, ...data.usage } };
  });
  const content = blocks.filter(Boolean).map(({ partial, ...block }) => block.type === 'tool_use' ? { ...block, input: partial ? JSON.parse(partial) : block.input } : block);
  return { ...message, content };
}
