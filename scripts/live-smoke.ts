import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { atomicJSON } from '../src/storage.js';
import Anthropic from '@anthropic-ai/sdk';
import { inventory, makeRoute } from '../src/opencode.js';
import { startGateway } from '../src/gateway.js';
import { type Wire } from '../src/types.js';

const refs = process.argv.slice(2);
const selected = refs.length ? refs : ['opencode/union-alpha', 'opencode/big-pickle'];
const results: Wire[] = [];
const models = await inventory();
for (const ref of selected) {
  const meta = models.get(ref);
  // This development smoke intentionally permits only currently advertised free routes.
  assert.ok(meta && meta.cost?.input === 0 && meta.cost?.output === 0, `Live smoke requires a currently free model: ${ref}`);
  const route = await makeRoute(ref, 'sonnet', models);
  const token = randomBytes(32).toString('hex');
  const live = await startGateway({ version: 1, port: 41415, token, routes: [route] }, { port: 0 });
  const client = new Anthropic({ baseURL: live.url, apiKey: token, maxRetries: 0, timeout: 120_000 });
  const started = Date.now();
  try {
    const tools: Anthropic.Tool[] = [{ name: 'bridge_add', description: 'Adds two numbers in a disposable integration test.', input_schema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } }];
    const prompt: Anthropic.MessageParam = { role: 'user', content: 'Call bridge_add with a=2 and b=3. After receiving the result, reply exactly VERIFIED 5.' };
    const first = await client.messages.stream({ model: route.id, max_tokens: 1024, tools, tool_choice: { type: 'tool', name: 'bridge_add' }, messages: [prompt] }).finalMessage();
    const call = first.content.find(b => b.type === 'tool_use');
    assert.ok(call?.type === 'tool_use', 'Expected a structured client tool call.');
    const input = call.input as { a: number; b: number }; assert.equal(input.a + input.b, 5);
    const second = await client.messages.stream({ model: route.id, max_tokens: 1024, tools, messages: [prompt, { role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: '5' }] }] }).finalMessage();
    const text = second.content.filter(b => b.type === 'text').map(b => b.text).join('');
    assert.match(text, /VERIFIED\s*5/);
    const record = { ref, protocol: route.protocol, passed: true, streamed: true, toolRoundTrip: true, durationMs: Date.now() - started, inputTokens: first.usage.input_tokens + second.usage.input_tokens, outputTokens: first.usage.output_tokens + second.usage.output_tokens };
    results.push(record); console.log(JSON.stringify(record));
  } catch (err: any) {
    const reason = err.error?.error?.type === 'permission_error' && err.error?.error?.message?.startsWith('OpenCode restricts')
      ? 'Provider restricts this free-tier route to OpenCode itself.' : err instanceof assert.AssertionError ? err.message : 'Provider/gateway smoke failed; inspect the gateway’s normalized error.';
    const record = { ref, protocol: route.protocol, passed: false, status: err.status ?? null, reason, durationMs: Date.now() - started };
    results.push(record); console.log(JSON.stringify(record)); process.exitCode = 1;
  } finally { await live.close(); }
}
await atomicJSON(new URL('../.bridge/live-smoke-results.json', import.meta.url).pathname, { timestamp: new Date().toISOString(), results });
