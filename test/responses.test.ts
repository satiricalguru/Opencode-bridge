import test from 'node:test';
import assert from 'node:assert/strict';
import { startGateway } from '../src/gateway.js';
import { toMessages } from '../src/responses.js';
import { parseSSE } from '../src/protocol.js';
import { config, route, stream } from './helpers.js';

const codexRoute = () => ({ ...route(), id: 'test/model', ref: 'test/model', slot: undefined });
test('Responses input maps instructions, developer text, tool calls/outputs and custom tools onto Messages', () => {
  const r = { ...codexRoute(), effort: { mode: 'chat' as const, levels: ['low' as const, 'high' as const] } };
  const { anthropic, custom } = toMessages({
    model: 'test/model', instructions: 'Base', stream: true, reasoning: { effort: 'high' }, max_output_tokens: 999999, parallel_tool_calls: false,
    input: [
      { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'Dev rules' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'List files' }] },
      { type: 'reasoning', summary: [] },
      { type: 'function_call', call_id: 'c1', name: 'shell', arguments: '{"command":["ls"]}' },
      { type: 'custom_tool_call', call_id: 'c2', name: 'apply_patch', input: '*** Begin Patch' },
      { type: 'function_call_output', call_id: 'c1', output: 'a.txt' },
      { type: 'custom_tool_call_output', call_id: 'c2', output: [{ type: 'input_text', text: 'Done' }] },
    ],
    tools: [{ type: 'function', name: 'shell', description: 'Run', parameters: { type: 'object', properties: { command: { type: 'array' } } } }, { type: 'custom', name: 'apply_patch', format: { type: 'grammar', syntax: 'lark', definition: 'start: x' } }, { type: 'web_search' }],
  }, r);
  assert.equal(anthropic.system, 'Base\n\nDev rules');
  assert.equal(anthropic.max_tokens, r.maxOutputTokens);
  assert.deepEqual(anthropic.output_config, { effort: 'high' }); assert.equal(anthropic.thinking, undefined);
  assert.deepEqual(anthropic.messages.map((m: any) => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(anthropic.messages[1].content.map((b: any) => [b.id, b.name, b.input]), [['c1', 'shell', { command: ['ls'] }], ['c2', 'apply_patch', { input: '*** Begin Patch' }]]);
  assert.deepEqual(anthropic.messages[2].content.map((b: any) => [b.tool_use_id, b.content]), [['c1', 'a.txt'], ['c2', 'Done']]);
  assert.deepEqual(anthropic.tools.map((t: any) => t.name), ['shell', 'apply_patch']);
  assert.match(anthropic.tools[1].description, /start: x/);
  assert.deepEqual(anthropic.tool_choice, { type: 'auto', disable_parallel_tool_use: true });
  assert.ok(custom.has('apply_patch'));
});
test('Codex Responses streaming round-trips text and function calls through a Chat backend', async t => {
  const cfg = config(); cfg.codexRoutes = [codexRoute()];
  let calls = 0;
  const gateway = await startGateway(cfg, { port: 0, credential: async () => 'KEY', fetch: async (_url, init) => {
    const body = JSON.parse(init?.body as string); calls++;
    assert.equal(body.model, 'actual-model'); assert.equal(body.stream, true);
    if (calls === 2) {
      assert.deepEqual(body.messages.map((m: any) => m.role), ['user', 'assistant', 'tool']);
      assert.equal(body.messages[2].content, 'a.txt');
      return stream([{ data: { choices: [{ delta: { content: 'Found a.txt' }, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 3 } } }, { data: '[DONE]' }]);
    }
    return stream([{ data: { choices: [{ delta: { content: 'Listing' } }] } }, { data: { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'shell', arguments: '{"command":["ls"]}' } }] }, finish_reason: 'tool_calls' }] } }, { data: '[DONE]' }]);
  } });
  t.after(() => gateway.close());
  const post = async (body: unknown, path = '/v1/responses') => fetch(`${gateway.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` }, body: JSON.stringify(body) });
  const tools = [{ type: 'function', name: 'shell', parameters: { type: 'object', properties: { command: { type: 'array' } } } }];
  const first = await post({ model: 'test/model', stream: true, instructions: 'Be Codex', input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ls' }] }], tools }, '/v1//responses');
  assert.equal(first.headers.get('content-type'), 'text/event-stream');
  const events: any[] = []; for await (const e of parseSSE(first.body!)) events.push(JSON.parse(e.data));
  const types = events.map(e => e.type);
  assert.deepEqual([types[0], types[1], types.at(-1)], ['response.created', 'response.in_progress', 'response.completed']);
  assert.ok(types.includes('response.output_text.delta') && types.includes('response.function_call_arguments.done'));
  assert.deepEqual(events.map(e => e.sequence_number), events.map((_, i) => i));
  const done = events.at(-1).response;
  assert.equal(done.status, 'completed');
  assert.deepEqual(done.output.map((item: any) => item.type), ['message', 'function_call']);
  assert.equal(done.output[0].content[0].text, 'Listing');
  assert.deepEqual([done.output[1].call_id, done.output[1].name, done.output[1].arguments], ['call_9', 'shell', '{"command":["ls"]}']);
  const second = await post({ model: 'test/model', stream: false, input: [{ type: 'message', role: 'user', content: 'ls' }, done.output[1], { type: 'function_call_output', call_id: 'call_9', output: 'a.txt' }], tools });
  const body = await second.json() as any;
  assert.equal(body.object, 'response'); assert.equal(body.status, 'completed');
  assert.equal(body.output[0].content[0].text, 'Found a.txt');
  assert.deepEqual([body.usage.input_tokens, body.usage.output_tokens], [9, 3]);
});
test('Responses failures after streaming starts arrive as response.failed without leaking upstream bodies', async t => {
  const cfg = config(); cfg.codexRoutes = [codexRoute()];
  const gateway = await startGateway(cfg, { port: 0, credential: async () => 'KEY', fetch: async () => new Response('SECRET', { status: 429 }) });
  t.after(() => gateway.close());
  const response = await fetch(`${gateway.url}/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` }, body: JSON.stringify({ model: 'anything', input: 'hi' }) });
  const text = await response.text();
  assert.match(text, /response\.failed/); assert.match(text, /rate_limit_error/); assert.ok(!text.includes('SECRET'));
  // Unknown Codex model names fall back to the configured Codex route.
  assert.match(text, /response\.created/);
});
