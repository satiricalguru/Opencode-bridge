import test from 'node:test';
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { request as httpRequest } from 'node:http';
import { startGateway } from '../src/gateway.js';
import { config, request, stream } from './helpers.js';
import { parseSSE } from '../src/protocol.js';

async function setup(t: test.TestContext, protocol: 'chat' | 'anthropic', upstream: typeof fetch) {
  const cfg = config(protocol);
  const gateway = await startGateway(cfg, { port: 0, fetch: upstream, credential: async () => 'UPSTREAM_KEY' });
  t.after(() => gateway.close());
  const client = new Anthropic({ baseURL: gateway.url, apiKey: cfg.token, maxRetries: 0 });
  const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${gateway.url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.token, ...headers }, body: JSON.stringify(body) });
  return { cfg, gateway, client, post };
}
test('loopback authentication, Host/Origin checks and endpoint/method validation', async t => {
  let calls = 0;
  const { gateway, cfg, post } = await setup(t, 'chat', async () => { calls++; return Response.json({}); });
  assert.equal((await fetch(`${gateway.url}/health`)).status, 200);
  assert.equal((await fetch(`${gateway.url}/v1/models`)).status, 401);
  const models = await fetch(`${gateway.url}/v1/models`, { headers: { authorization: `Bearer ${cfg.token}` } });
  assert.equal((await models.json() as any).data[0].display_name, 'Test Model');
  assert.equal((await post(request(), { origin: 'https://evil.example' })).status, 403);
  // Node fetch normalizes Host; use a native HTTP request to exercise rebinding protection.
  const badHostStatus = await new Promise<number>(resolve => {
    const req = httpRequest(`${gateway.url}/v1/models`, { headers: { host: 'evil.example', 'x-api-key': cfg.token } }, res => { res.resume(); resolve(res.statusCode!); }); req.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await post(request({ model: 'unknown' }))).status, 400);
  assert.equal((await post(request({ max_tokens: 4097 }))).status, 400);
  assert.equal((await post(request({ messages: [{ role: 'system', content: 'bad' }] }))).status, 400);
  assert.equal((await fetch(`${gateway.url}/v1/messages`, { headers: { 'x-api-key': cfg.token } })).status, 405);
  const count = await fetch(`${gateway.url}/v1/messages/count_tokens`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.token }, body: JSON.stringify(request()) });
  assert.equal(count.headers.get('x-bridge-token-count'), 'estimated');
  assert.ok((await count.json() as any).input_tokens > 0);
  assert.equal(calls, 0);
});
test('Anthropic SDK accumulates fragmented Unicode and parallel tool streams, then replays results', async t => {
  let calls = 0;
  const { client } = await setup(t, 'chat', async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer UPSTREAM_KEY');
    assert.equal(headers.get('x-api-key'), null);
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, 'actual-model');
    calls++;
    if (calls === 2) {
      assert.equal(body.messages[1].tool_calls[0].id, 'call_1');
      assert.equal(body.messages[1].tool_calls[0].function.name, 'lookup');
      assert.equal(body.messages[2].tool_call_id, 'call_1');
      assert.equal(body.messages[3].tool_call_id, 'call_2');
      return stream([{ data: { choices: [{ delta: { content: 'Verified ✓' }, finish_reason: null }] } }, { data: { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 60, completion_tokens: 5 } } }, { data: '[DONE]' }]);
    }
    return stream([
      { data: { choices: [{ delta: { content: 'Checking 🌍' }, finish_reason: null }] } },
      { data: { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_', function: { name: 'look', arguments: '{"q":' } }, { index: 1, id: 'call_2', function: { name: 'lookup', arguments: '{"q":"B"}' } }] }, finish_reason: null }] } },
      { data: { choices: [{ delta: { tool_calls: [{ index: 0, id: '1', function: { name: 'up', arguments: '"A"}' } }] }, finish_reason: 'tool_calls' }] } },
      { data: { choices: [], usage: { prompt_tokens: 50, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 30 } } } }, { data: '[DONE]' },
    ], 1);
  });
  const tools: Anthropic.Tool[] = [{ name: 'lookup', input_schema: { type: 'object', properties: { q: { type: 'string' } } } }];
  const first = await client.messages.stream({ model: 'claude-sonnet-5', max_tokens: 128, tools, messages: [{ role: 'user', content: 'Look up A and B' }] }).finalMessage();
  assert.equal(first.model, 'claude-sonnet-5'); assert.equal(first.stop_reason, 'tool_use');
  assert.deepEqual(first.content.filter(b => b.type === 'tool_use').map(b => b.input), [{ q: 'A' }, { q: 'B' }]);
  assert.equal(first.usage.input_tokens, 20); assert.equal(first.usage.cache_read_input_tokens, 30);
  const second = await client.messages.stream({ model: 'claude-sonnet-5', max_tokens: 128, tools, messages: [{ role: 'user', content: 'Look up A and B' }, { role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'A result' }, { type: 'tool_result', tool_use_id: 'call_2', content: 'B result' }] }] }).finalMessage();
  assert.equal(second.stop_reason, 'end_turn'); assert.equal((second.content[0] as any).text, 'Verified ✓');
});
test('native Anthropic preserves cache/opaque fields, replaces models and strips bridge credentials', async t => {
  const { post, client } = await setup(t, 'anthropic', async (_url, init) => {
    const headers = new Headers(init?.headers); assert.equal(headers.get('x-api-key'), 'UPSTREAM_KEY'); assert.equal(headers.get('authorization'), null);
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, 'actual-model'); assert.equal(body.system[0].cache_control.type, 'ephemeral'); assert.equal(body.metadata.user_id, 'fixture-session');
    const message = { id: 'msg_native', type: 'message', role: 'assistant', model: 'actual-model', content: [{ type: 'text', text: 'Native' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } };
    if (!body.stream) return Response.json(message);
    return stream([{ event: 'message_start', data: { type: 'message_start', message: { ...message, content: [], stop_reason: null } } }, { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }, { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Native' } } }, { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } }, { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 2 } } }, { event: 'message_stop', data: { type: 'message_stop' } }]);
  });
  const extra = { system: [{ type: 'text' as const, text: 'system', cache_control: { type: 'ephemeral' as const } }], metadata: { user_id: 'fixture-session' } };
  assert.equal((await (await post(request(extra))).json() as any).model, 'claude-sonnet-5');
  const message = await client.messages.stream({ ...request(), ...extra } as any).finalMessage();
  assert.equal(message.model, 'claude-sonnet-5'); assert.equal((message.content[0] as any).text, 'Native');
});
test('non-streaming tools and provider reasoning replay stay out of synthetic thinking blocks', async t => {
  const cfg = config(); cfg.routes[0].reasoningField = 'reasoning_content';
  let called = 0;
  const gateway = await startGateway(cfg, { port: 0, credential: async () => undefined, fetch: async (_url, init) => {
    called++; const body = JSON.parse(init?.body as string);
    if (called === 2) { assert.equal(body.messages[1].reasoning_content, 'opaque provider state'); return Response.json({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1 } }); }
    return Response.json({ choices: [{ message: { content: null, reasoning_content: 'opaque provider state', tool_calls: [{ id: 'r1', function: { name: 'lookup', arguments: '{"q":"A"}' } }] }, finish_reason: 'tool_calls' }] });
  } }); t.after(() => gateway.close());
  const client = new Anthropic({ baseURL: gateway.url, apiKey: cfg.token, maxRetries: 0 });
  const first = await client.messages.create(request() as any);
  assert.equal(first.content[0].type, 'tool_use');
  await client.messages.create(request({ messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'result' }] }] }) as any);
});
test('unsupported content/explicit thinking fail clearly without an upstream call', async t => {
  let calls = 0;
  const { post } = await setup(t, 'chat', async () => { calls++; return Response.json({}); });
  for (const body of [request({ thinking: { type: 'adaptive' } }), request({ messages: [{ role: 'user', content: [{ type: 'document' }] }] }), request({ messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64' } }] }] }), request({ tools: [{ name: 'web_search', type: 'web_search_20260209' }] })]) assert.equal((await post(body)).status, 400);
  assert.equal(calls, 0);
});
test('upstream status errors are normalized without echoing secrets or prompt bodies', async t => {
  const { post } = await setup(t, 'chat', async () => new Response('SECRET prompt contents UPSTREAM_KEY', { status: 429 }));
  const response = await post(request()); assert.equal(response.status, 429);
  const text = await response.text(); assert.ok(text.includes('rate_limit_error')); assert.ok(!text.includes('SECRET')); assert.ok(!text.includes('UPSTREAM_KEY'));
});
test('restricted OpenCode free-tier access produces actionable static errors without echoing the upstream envelope', async t => {
  const { post } = await setup(t, 'chat', async () => Response.json({ type: 'error', error: { type: 'FreeTierError', message: 'SECRET UPSTREAM_KEY' } }, { status: 403 }));
  const response = await post(request()); assert.equal(response.status, 403);
  const data = await response.json() as any;
  assert.equal(data.error.type, 'permission_error'); assert.match(data.error.message, /restricts this free-tier route/);
  assert.ok(!JSON.stringify(data).includes('SECRET'));
});
test('malformed and truncated streams produce SDK errors rather than false successful completions', async t => {
  const { client } = await setup(t, 'chat', async () => stream([{ data: { choices: [{ delta: { content: 'partial' }, finish_reason: null }] } }]));
  await assert.rejects(() => client.messages.stream(request() as any).finalMessage(), /before completion/);
});
test('client disconnect aborts the upstream request', async t => {
  let upstreamSignal: AbortSignal | null | undefined;
  const { gateway, cfg } = await setup(t, 'chat', async (_url, init) => {
    upstreamSignal = init?.signal;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"first"},"finish_reason":null}]}\n\n')); }, cancel() {} }), { headers: { 'content-type': 'text/event-stream' } });
  });
  const controller = new AbortController();
  const response = await fetch(`${gateway.url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.token }, body: JSON.stringify(request({ stream: true })), signal: controller.signal });
  await response.body!.getReader().read(); controller.abort();
  await new Promise<void>(resolve => { if (upstreamSignal?.aborted) resolve(); else upstreamSignal?.addEventListener('abort', () => resolve(), { once: true }); });
  assert.equal(upstreamSignal?.aborted, true);
});
test('SSE parser handles multiline data and final frames without a trailing newline', async () => {
  const body = new Response('event: test\ndata: {"a":\ndata: 1}\n\nevent: end\ndata: done').body!;
  const events = []; for await (const e of parseSSE(body)) events.push(e);
  assert.deepEqual(events, [{ event: 'test', data: '{"a":\n1}' }, { event: 'end', data: 'done' }]);
});
