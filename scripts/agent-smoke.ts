import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { inventory, makeRoute } from '../src/opencode.js';
import { startGateway } from '../src/gateway.js';

// Live check of free OpenCode Zen models through the bridge-owned OpenCode agent:
// Messages streaming, a read tool inside OpenCode, read-only policy, and session reuse.
const refs = process.argv.slice(2);
const selected = refs.length ? refs : ['opencode/deepseek-v4.1-flash-free'];
const models = await inventory();
const workspace = await mkdtemp(join(tmpdir(), 'bridge-agent-smoke-'));
const marker = `marker-${randomBytes(4).toString('hex')}`;
await writeFile(join(workspace, 'note.txt'), `${marker}\n`);
try {
  for (const ref of selected) {
    const route = await makeRoute(ref, 'sonnet', models, { via: 'agent' });
    const token = randomBytes(32).toString('hex');
    const gateway = await startGateway({ version: 1, port: 41415, token, routes: [route], opencode: { workspace, permission: 'read-only' } }, { port: 0 });
    const client = new Anthropic({ baseURL: gateway.url, apiKey: token, maxRetries: 0, timeout: 600_000 });
    const started = Date.now();
    try {
      const prompt: Anthropic.MessageParam = { role: 'user', content: 'Read note.txt in your working directory and reply with its exact single-line content only.' };
      const first = await client.messages.stream({ model: route.id, max_tokens: 4096, messages: [prompt] }).finalMessage();
      const text = first.content.map(b => b.type === 'text' ? b.text : '').join('');
      assert.ok(text.includes(marker), 'Expected the agent to read the marker file.');
      const second = await client.messages.stream({ model: route.id, max_tokens: 4096, messages: [prompt, { role: 'assistant', content: first.content }, { role: 'user', content: 'Without using tools again, repeat that exact content once more.' }] }).finalMessage();
      const again = second.content.map(b => b.type === 'text' ? b.text : '').join('');
      assert.ok(again.includes(marker), `Expected the resumed session to remember the file; got: ${JSON.stringify(again.slice(-200))}`);
      console.log(JSON.stringify({ ref, passed: true, durationMs: Date.now() - started, inputTokens: first.usage.input_tokens, outputTokens: first.usage.output_tokens }));
    } catch (err: any) {
      console.log(JSON.stringify({ ref, passed: false, status: err.status ?? null, reason: err instanceof Error ? err.message.slice(0, 300) : 'failed', durationMs: Date.now() - started }));
      process.exitCode = 1;
    } finally { await gateway.close(); }
  }
} finally { await rm(workspace, { recursive: true, force: true }); }
