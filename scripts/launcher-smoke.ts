import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialize } from '../src/config.js';
import { readJSON } from '../src/storage.js';
import { type Route } from '../src/types.js';

const exec = promisify(execFile);
const dir = await mkdtemp(join(tmpdir(), 'bridge-launcher-smoke-'));
const upstream = createServer(async (req, res) => {
  for await (const _ of req) { /* Consume the disposable fixture request. */ }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'message', id: 'msg_fixture', role: 'assistant', model: 'fixture-model', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }));
});
await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
const reservation = createServer();
await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = (reservation.address() as any).port;
await new Promise<void>(resolve => reservation.close(() => resolve()));
const route: Route = { id: 'claude-sonnet-5', tier: 'sonnet', ref: 'fixture/model', label: 'Disposable local fixture', protocol: 'anthropic', baseURL: `http://127.0.0.1:${(upstream.address() as any).port}/v1`, model: 'fixture-model', auth: { none: true }, contextTokens: 32000, maxOutputTokens: 4096, tools: true, vision: false };
const cfg = await initialize([route], port, dir);
const executable = process.env.BRIDGE_SMOKE_EXECUTABLE || process.execPath;
const env = { ...process.env, BRIDGE_STATE_DIR: dir, ...(process.env.BRIDGE_SMOKE_EXECUTABLE ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
const cli = process.env.BRIDGE_SMOKE_CLI || new URL('../dist/cli.js', import.meta.url).pathname;
const run = async (command: string) => JSON.parse((await exec(executable, [cli, command], { env, timeout: 30_000 })).stdout);
try {
  assert.equal((await run('start')).started, true);
  assert.equal((await run('start')).started, true); // Reuse a matching daemon.
  const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` }, body: JSON.stringify({ model: route.id, max_tokens: 64, messages: [{ role: 'user', content: 'Fixture request' }] }) });
  assert.equal(response.status, 200); assert.equal((await response.json() as any).content[0].text, 'OK');
  assert.equal((await run('status')).gateway.routed, 1);
  assert.equal((await run('profile')).profile, 'OpenCode Bridge');
  assert.equal(await readJSON(join(dir, 'profile-journal.json')), undefined);
  assert.equal((await run('stop')).stopped, true);
  let stopped = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const status = await run('status');
    if (!status.gateway.ready) { stopped = true; break; }
  }
  assert.equal(stopped, true);
  console.log(JSON.stringify({ passed: true, runtime: process.env.BRIDGE_SMOKE_EXECUTABLE ? 'packaged' : 'node', backgroundStart: true, repeatedStart: true, inference: true, profilePreview: true, backgroundStop: true, desktopSettingsChanged: false }));
} finally {
  const record = await readJSON(join(dir, 'gateway-process.json'));
  if (record?.pid) { try { process.kill(record.pid, 'SIGTERM'); } catch {} }
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
}
