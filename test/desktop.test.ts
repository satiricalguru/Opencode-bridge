import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopService } from '../src/desktop/service.js';
import { ClientRegistry } from '../src/clients/registry.js';
import { parseDesktopRequest } from '../src/desktop/requests.js';
import { atomicJSON, readJSON } from '../src/storage.js';
import { configPath, loadConfig } from '../src/config.js';
import { journalPath } from '../src/profile.js';
import type { DesktopClient } from '../src/clients/types.js';
import type { BridgeConfig } from '../src/types.js';
import { discoverLocalModels, type Catalog } from '../src/desktop/catalog.js';

async function setup(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-desktop-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const refs = ['bridge-test/a', 'bridge-test/b'];
  const catalog: Catalog = { notices: [], metadata: new Map(refs.map(ref => [ref, { id: ref.split('/')[1], name: ref, providerID: 'bridge-test', api: { id: ref, npm: '@ai-sdk/openai-compatible', url: 'http://127.0.0.1:65500/v1' }, limit: { context: 32768, output: 4096 }, capabilities: { toolcall: true } }])), items: refs.map(ref => ({ ref, name: ref, provider: 'bridge-test', source: 'opencode', protocol: 'chat', tools: true, vision: false, context: 32768, free: true, enabled: true })) };
  const calls: Array<{ action: string; config?: BridgeConfig; restart?: boolean }> = [];
  let connected = false;
  let installed = true;
  let running = false;
  const client: DesktopClient = {
    descriptor: { id: 'claude', name: 'Claude Desktop', description: 'Test fixture', availability: 'available', protocol: 'anthropic-messages' },
    inspect: async () => ({ installed, running, connected, recoveryNeeded: false }), preview: async () => ({}),
    launch: async (config, restart) => { calls.push({ action: 'launch', config, restart }); connected = true; await atomicJSON(journalPath(dir), { version: 1, state: 'active' }); },
    disconnect: async restart => { calls.push({ action: 'disconnect', restart }); connected = false; await unlink(journalPath(dir)).catch(() => {}); return true; },
  };
  const gateway = { start: async (config: BridgeConfig) => { calls.push({ action: 'start', config }); }, stop: async (config: BridgeConfig) => { calls.push({ action: 'stop', config }); return true; } };
  const service = new DesktopService(new ClientRegistry([client]), gateway, dir, async () => catalog);
  await service.refresh();
  return { service, dir, calls, gateway, client, setInstalled: (value: boolean) => { installed = value; }, setRunning: (value: boolean) => { running = value; } };
}
test('GUI saves model choices without inference or Desktop mutation, then launches through the client adapter', async t => {
  const f = await setup(t);
  await f.service.save('claude', { model: 'bridge-test/a', opus: 'bridge-test/b' }, 65501);
  assert.equal(await readJSON(configPath(f.dir)), undefined); assert.equal(await readJSON(journalPath(f.dir)), undefined); assert.deepEqual(f.calls, []);
  const state = await f.service.launch('claude', { model: 'bridge-test/a', opus: 'bridge-test/b' }, 65501, false);
  const config = await loadConfig(f.dir);
  assert.deepEqual(config.routes.map(r => r.ref), ['bridge-test/a', 'bridge-test/b', 'bridge-test/a']);
  assert.equal(config.token.length, 64); assert.equal(config.routes[0].auth.none, true);
  assert.deepEqual(f.calls.map(c => c.action), ['start', 'launch']);
  assert.equal(state.clients.find(c => c.id === 'claude')?.status?.connected, true);
  assert.ok(!JSON.stringify(state).includes(config.token));
});
test('active connections cannot be overwritten, repeated launch reuses routes, and restore precedes stop', async t => {
  const f = await setup(t); const selection = { model: 'bridge-test/a' };
  await f.service.launch('claude', selection, 65501, false);
  const before = await loadConfig(f.dir);
  await assert.rejects(() => f.service.save('claude', { model: 'bridge-test/b' }, 65501), /Restore/);
  await assert.rejects(() => f.service.launch('claude', { model: 'bridge-test/b' }, 65501, false), /Disconnect/);
  await assert.rejects(() => f.service.stop(), /Restore/);
  await f.service.launch('claude', selection, 65501, false);
  assert.deepEqual(await loadConfig(f.dir), before);
  await f.service.disconnect('claude', true);
  assert.deepEqual(f.calls.slice(-2).map(c => c.action), ['disconnect', 'stop']);
  assert.equal(f.calls.at(-2)?.restart, true);
  await f.service.launch('claude', { model: 'bridge-test/b' }, 65501, false);
  assert.equal((await loadConfig(f.dir)).token, before.token);
});
test('missing apps and running Desktop without restart permission fail before gateway or profile changes', async t => {
  const f = await setup(t);
  f.setInstalled(false);
  await assert.rejects(() => f.service.launch('claude', { model: 'bridge-test/a' }, 65501, false), /not installed/);
  f.setInstalled(true); f.setRunning(true);
  await assert.rejects(() => f.service.launch('claude', { model: 'bridge-test/a' }, 65501, false), /Restart Claude/);
  assert.deepEqual(f.calls, []); assert.equal(await readJSON(configPath(f.dir)), undefined);
});
test('app action serialization prevents simultaneous connection mutations', async t => {
  const f = await setup(t);
  let release!: () => void; let started!: () => void;
  const entering = new Promise<void>(resolve => { started = resolve; });
  f.gateway.start = async () => { started(); await new Promise<void>(resolve => { release = resolve; }); };
  const launch = f.service.launch('claude', { model: 'bridge-test/a' }, 65501, false);
  await entering;
  await assert.rejects(() => f.service.save('claude', { model: 'bridge-test/a' }, 65501), /in progress/);
  release(); await launch;
});
test('client registry refuses future/unknown integrations and replaces planned metadata when an adapter is implemented', async t => {
  const f = await setup(t);
  await assert.rejects(() => f.service.launch('chatgpt', { model: 'bridge-test/a' }, 65501, false), /enabled integration/);
  const registry = new ClientRegistry([{ ...f.client, descriptor: { ...f.client.descriptor, id: 'chatgpt' } }]);
  assert.equal(registry.descriptors().filter(c => c.id === 'chatgpt').length, 1);
  assert.equal(registry.get('chatgpt').descriptor.availability, 'available');
});
test('native IPC validates actions and rejects arbitrary commands, malformed selections, and implicit restarts', () => {
  assert.deepEqual(parseDesktopRequest({ action: 'refresh' }), { action: 'refresh' });
  assert.deepEqual(parseDesktopRequest({ action: 'launch', client: 'claude', selection: { model: 'test/a' }, port: 41415, restart: false }), { action: 'launch', client: 'claude', selection: { model: 'test/a' }, port: 41415, restart: false });
  for (const input of [{ action: 'exec', command: 'evil' }, { action: 'state', token: 'leak' }, { action: 'launch', client: 'claude', selection: { model: 'test/a' }, port: 41415 }, { action: 'save', client: 'claude', selection: { model: 'test/a', baseURL: 'https://evil' }, port: 41415 }, { action: 'save', client: '../evil', selection: { model: 'test/a' }, port: 41415 }, { action: 'save', client: 'claude', selection: { model: 'test/a' }, port: 80 }]) assert.throws(() => parseDesktopRequest(input));
});
test('local discovery inspects installed models and uses Ollama native Messages without inference or downloads', async () => {
  const urls: string[] = [];
  const models = await discoverLocalModels(async (url, init) => {
    urls.push(String(url));
    if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ name: 'fixture:9b' }, { name: 123 }] });
    assert.equal(JSON.parse(init?.body as string).model, 'fixture:9b');
    return Response.json({ capabilities: ['completion', 'tools', 'vision'], model_info: { 'fixture.context_length': 131072 } });
  });
  const model = models.get('ollama-local/fixture:9b')!;
  assert.deepEqual(urls, ['http://127.0.0.1:11434/api/tags', 'http://127.0.0.1:11434/api/show']);
  assert.equal(model.api.npm, '@ai-sdk/anthropic'); assert.equal(model.api.url, 'http://127.0.0.1:11434/v1');
  assert.equal(model.capabilities.toolcall, true); assert.equal(model.capabilities.input.image, true);
  assert.equal(model.limit.context, 32768);
});
