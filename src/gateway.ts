import { createServer, type Server, type ServerResponse, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { credentials, providerConfig, resolveEnv } from './opencode.js';
import { BridgeError, invalid, isObject, type BridgeConfig, type Route, type Wire } from './types.js';
import { estimateTokens, fromChat, parseSSE, ReasoningReplay, toChat, translateChatStream, validateRequest } from './protocol.js';
import { validateConfig } from './config.js';

export const SERVICE = 'opencode-claude-bridge';
export const VERSION = '0.1.0';
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
export function resolveRoute(config: BridgeConfig, model: unknown): Route {
  if (typeof model !== 'string') invalid('model is required.');
  const route = config.routes.find(r => r.id === model || r.ref === model || r.tier === model);
  if (!route) invalid(`Unknown model route. Select an ID advertised by /v1/models.`);
  return route;
}
export function modelCatalog(config: BridgeConfig): Wire {
  const data = config.routes.map(route => ({
    id: route.id, type: 'model', display_name: route.label, created_at: '2026-09-17T00:00:00Z',
    max_tokens: route.maxOutputTokens, anthropic_family_tier: route.tier, is_family_default: true,
  }));
  return { data, first_id: data[0]?.id, last_id: data.at(-1)?.id, has_more: false };
}
async function writeEvent(res: ServerResponse, event: string, data: Wire): Promise<void> {
  if (res.destroyed) throw new Error('Client disconnected.');
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
export async function startGateway(config: BridgeConfig, options: GatewayOptions = {}): Promise<Gateway> {
  validateConfig(config);
  const replay = new ReasoningReplay(); const controllers = new Set<AbortController>(); let active = 0; let routed = 0;
  const server = createServer(async (req, res) => {
    const started = Date.now(); let route: Route | undefined; let keepAlive: NodeJS.Timeout | undefined;
    let controller: AbortController | undefined; let admitted = false; let outcome = 'completed';
    try {
      // Native client only. Host restrictions also defend against DNS rebinding.
      const allowedHosts = [`127.0.0.1:${(server.address() as any)?.port}`, `localhost:${(server.address() as any)?.port}`];
      if (!allowedHosts.includes(req.headers.host || '') || req.headers.origin !== undefined || !['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress || '')) throw new BridgeError(403, 'permission_error', 'Native loopback clients only.');
      if (req.url === '/health' && req.method === 'GET') {
        json(res, 200, { service: SERVICE, version: VERSION, pid: process.pid, ready: true, routes: config.routes.map(r => ({ id: r.id, ref: r.ref, protocol: r.protocol })), routed, active }); return;
      }
      if (!authorized(req, config.token)) throw new BridgeError(401, 'authentication_error', 'Bridge credential required.');
      if (req.url === '/v1/models') {
        if (req.method !== 'GET') throw new BridgeError(405, 'invalid_request_error', 'Use GET.');
        json(res, 200, modelCatalog(config)); return;
      }
      if (!['/v1/messages', '/v1/messages/count_tokens'].includes(req.url || '')) throw new BridgeError(404, 'not_found_error', 'Unknown endpoint.');
      if (req.method !== 'POST') throw new BridgeError(405, 'invalid_request_error', 'Use POST.');
      if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) invalid('Content-Type must be application/json.');
      if (active >= 8) throw new BridgeError(429, 'rate_limit_error', 'Gateway concurrency limit reached.');
      active++; admitted = true;
      const body = await requestBody(req); route = resolveRoute(config, body.model);
      if (req.url === '/v1/messages/count_tokens') {
        if (!Array.isArray(body.messages)) invalid('messages must be an array.');
        res.setHeader('x-bridge-token-count', 'estimated'); json(res, 200, { input_tokens: estimateTokens(body) }); return;
      }
      validateRequest(body, route);
      const outgoing = route.protocol === 'chat' ? toChat(body, route, replay) : { ...body, model: route.model };
      const key = await (options.credential || credentials)(route);
      const headers = new Headers({ 'content-type': 'application/json', 'user-agent': `${SERVICE}/${VERSION}` });
      // Incoming credentials never reach upstream. Resolve selected provider headers at runtime.
      const cfg = options.credential ? {} : await providerConfig(route.auth.provider || '');
      for (const [name, value] of Object.entries({ ...cfg.options?.headers, ...route.headers })) {
        if (typeof value !== 'string' || /cookie|host|content-length|authorization|api.?key/i.test(name)) continue;
        headers.set(name, resolveEnv(value) as string);
      }
      if (route.protocol === 'anthropic') {
        headers.set('anthropic-version', typeof req.headers['anthropic-version'] === 'string' ? req.headers['anthropic-version'] : '2023-06-01');
        if (typeof req.headers['anthropic-beta'] === 'string') headers.set('anthropic-beta', req.headers['anthropic-beta']);
        if (key) headers.set('x-api-key', key);
      } else if (key) headers.set('authorization', `Bearer ${key}`);
      for (const name of ['x-opencode-session', 'x-claude-code-session-id']) if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
      controller = new AbortController(); controllers.add(controller);
      const abort = controller;
      req.on('aborted', () => abort.abort());
      res.on('close', () => { if (!res.writableEnded) abort.abort(); });
      const timeout = setTimeout(() => abort.abort(), 300_000); timeout.unref();
      let response: Response;
      try {
        response = await (options.fetch || fetch)(`${route.baseURL}/${route.protocol === 'chat' ? 'chat/completions' : 'messages'}`, { method: 'POST', headers, body: JSON.stringify(outgoing), signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw await classifiedUpstreamError(response);
        if (body.stream) {
          if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new BridgeError(502, 'api_error', 'Expected an upstream event stream.'); }
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-store', 'x-accel-buffering': 'no' }); res.flushHeaders();
          const emit = (event: string, data: Wire) => writeEvent(res, event, data);
          keepAlive = setInterval(() => { if (!res.destroyed) void emit('ping', { type: 'ping' }).catch(() => abort.abort()); }, 15_000); keepAlive.unref();
          if (route.protocol === 'chat') await translateChatStream(response.body, route, replay, emit);
          else {
            let complete = false;
            for await (const item of parseSSE(response.body)) {
              let data: Wire;
              try { data = JSON.parse(item.data); } catch { throw new BridgeError(502, 'api_error', 'Invalid native stream JSON.'); }
              if (item.event === 'message_start' && data.message) data.message.model = route.id;
              if (item.event === 'error') throw new BridgeError(502, 'api_error', 'Upstream reported a native stream error.');
              await emit(item.event, data);
              if (item.event === 'message_stop') { complete = true; break; }
            }
            if (!complete) throw new BridgeError(502, 'api_error', 'Native stream ended before message_stop.');
          }
          res.end();
        } else {
          const data = await response.json() as Wire;
          if (route.protocol === 'anthropic' && (!isObject(data) || data.type !== 'message' || !Array.isArray(data.content))) throw new BridgeError(502, 'api_error', 'Invalid native upstream message.');
          json(res, 200, route.protocol === 'chat' ? fromChat(data, route, replay) : { ...data, model: route.id });
        }
        routed++;
      } finally { clearTimeout(timeout); }
    } catch (err) {
      outcome = controller?.signal.aborted ? 'cancelled' : 'failed';
      const failure = errorResponse(err);
      if (!res.destroyed && !res.writableEnded) {
        if (res.headersSent) { await writeEvent(res, 'error', failure.body).catch(() => {}); res.end(); }
        else json(res, failure.status, failure.body);
      }
    } finally {
      if (keepAlive) clearInterval(keepAlive);
      if (controller) controllers.delete(controller);
      if (admitted) active--;
      if (route && req.url === '/v1/messages') options.log?.({ timestamp: new Date().toISOString(), route: route.id, backend: route.ref, status: res.statusCode, outcome, durationMs: Date.now() - started });
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? config.port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return { server, url: `http://127.0.0.1:${(server.address() as any).port}`, close: async () => {
    for (const controller of controllers) controller.abort();
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  } };
}
