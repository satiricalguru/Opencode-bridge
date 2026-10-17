import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyRoot, catalog, CodexClient, restoreRoot, type CodexLifecycle } from '../src/clients/codex.js';
import { config, route } from './helpers.js';
import type { BridgeConfig } from '../src/types.js';

const ORIGINAL = `# my codex settings
model_reasoning_effort = "xhigh"
notify = ["notifier", "turn-ended"]
model = "gpt-5.6-terra"
service_tier = "default"

[projects."/Users/me/app"]
trust_level = "trusted"
model = "per-project-key-is-not-root"
`;
function codexConfig(): BridgeConfig {
  const cfg = config();
  cfg.codexRoutes = [{ ...route(), id: 'opencode/free', ref: 'opencode/free', slot: undefined, protocol: 'opencode', baseURL: 'opencode://agent', effort: { mode: 'opencode', levels: ['low', 'high'] }, effortOverride: 'high' }];
  return cfg;
}
async function setup(t: test.TestContext, root?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-codex-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'codex'); const state = join(dir, 'state');
  if (root !== undefined) { await rm(home, { recursive: true, force: true }); await import('node:fs/promises').then(fs => fs.mkdir(home, { recursive: true })); await writeFile(join(home, 'config.toml'), root); }
  const events: string[] = []; let running = true;
  const lifecycle: CodexLifecycle = { cli: async () => true, app: async () => '/Applications/ChatGPT.app', running: async () => running, quit: async () => { events.push('quit'); running = false; }, open: async () => { events.push('open'); running = true; }, terminal: async command => { events.push(`terminal:${command}`); } };
  return { home, state, events, client: new CodexClient(state, home, lifecycle) };
}
test('root config edits keep comments/tables, move only top-level selection keys, and restore verbatim', () => {
  const { text, removed } = applyRoot(ORIGINAL, ['model = "opencode/free"', 'model_provider = "opencode-bridge"'], '[model_providers.opencode-bridge]\nname = "OpenCode Bridge"');
  assert.deepEqual(removed, ['model_reasoning_effort = "xhigh"', 'model = "gpt-5.6-terra"']);
  assert.match(text, /^# >>> OpenCode Bridge[^\n]*\nmodel = "opencode\/free"/);
  assert.ok(text.includes('model = "per-project-key-is-not-root"') && text.includes('notify = ["notifier", "turn-ended"]'));
  assert.ok(text.trimEnd().endsWith('name = "OpenCode Bridge"\n# <<< OpenCode Bridge <<<'));
  const restored = restoreRoot(text, removed);
  for (const line of ORIGINAL.split('\n').filter(Boolean)) assert.ok(restored.includes(line), line);
  assert.equal(restoreRoot(restored, []), restored);
  assert.throws(() => applyRoot(text, [], ''), /already has/);
  assert.throws(() => applyRoot('[model_providers.opencode-bridge]\nname="x"\n', [], ''), /already defines/);
});
test('Codex catalog advertises bridge models with their real effort levels', () => {
  const entry = catalog(codexConfig().codexRoutes!).models[0];
  assert.equal(entry.slug, 'opencode/free');
  assert.deepEqual(entry.supported_reasoning_levels.map((l: any) => l.effort), ['low', 'high']);
  assert.equal(entry.default_reasoning_level, 'high');
  assert.equal(entry.context_window, 200000);
});
test('Codex CLI launch writes a private profile and catalog; the app connection is journaled and fully reversible', async t => {
  const f = await setup(t, ORIGINAL); const cfg = codexConfig();
  await f.client.launch(cfg, false, { target: 'cli' });
  const profile = await readFile(join(f.home, 'opencode-bridge.config.toml'), 'utf8');
  assert.match(profile, /model = "opencode\/free"\nmodel_provider = "opencode-bridge"/);
  assert.match(profile, /base_url = "http:\/\/127\.0\.0\.1:41415\/v1"\nwire_api = "responses"/);
  assert.match(profile, /model_reasoning_effort = "high"/);
  assert.equal((await stat(join(f.home, 'opencode-bridge.config.toml'))).mode & 0o777, 0o600);
  assert.deepEqual(f.events, ['terminal:codex --profile opencode-bridge']);
  assert.equal(await readFile(join(f.home, 'config.toml'), 'utf8'), ORIGINAL);
  let status = await f.client.inspect(cfg);
  assert.equal(status.connected, true); assert.equal(status.appConnected, false);

  await assert.rejects(() => f.client.launch(cfg, false, { target: 'app' }), /running/);
  await f.client.launch(cfg, true, { target: 'app' });
  assert.deepEqual(f.events.slice(1), ['quit', 'open']);
  const root = await readFile(join(f.home, 'config.toml'), 'utf8');
  assert.match(root, /model_provider = "opencode-bridge"/); assert.ok(!root.includes('gpt-5.6-terra'));
  status = await f.client.inspect(cfg); assert.equal(status.appConnected, true);

  await f.client.disconnect(true);
  const restored = await readFile(join(f.home, 'config.toml'), 'utf8');
  for (const line of ORIGINAL.split('\n').filter(Boolean)) assert.ok(restored.includes(line), line);
  assert.ok(!restored.includes('OpenCode Bridge'));
  await assert.rejects(() => stat(join(f.home, 'opencode-bridge.config.toml')));
  status = await f.client.inspect(cfg); assert.equal(status.connected, false); assert.equal(status.recoveryNeeded, false);
});
test('a Codex app connection created from no config file removes the file on disconnect', async t => {
  const f = await setup(t);
  await f.client.launch(codexConfig(), true, { target: 'app' });
  assert.match(await readFile(join(f.home, 'config.toml'), 'utf8'), /opencode-bridge/);
  await f.client.disconnect(false);
  await assert.rejects(() => stat(join(f.home, 'config.toml')));
});
test('Codex names come from Codex\'s own cache in priority order, and the catalog shows them', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-codex-names-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { readCodexNames, DEFAULT_CODEX_NAMES } = await import('../src/clients/codex-names.js');
  assert.deepEqual(await readCodexNames(dir), DEFAULT_CODEX_NAMES);
  await writeFile(join(dir, 'models_cache.json'), JSON.stringify({ models: [
    { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list', priority: 4 },
    { slug: 'codex-auto-review', display_name: 'Auto Review', visibility: 'hide', priority: 1 },
    { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', visibility: 'list', priority: 2 },
    { slug: '../evil', display_name: 'x', visibility: 'list', priority: 0 },
  ] }));
  assert.deepEqual(await readCodexNames(dir), [{ slug: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' }, { slug: 'gpt-6-luna', label: 'GPT-6-Luna' }]);
  const cfg = codexConfig(); cfg.codexRoutes = [{ ...cfg.codexRoutes![0], id: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra' }];
  const entry = catalog(cfg.codexRoutes).models[0];
  assert.equal(entry.slug, 'gpt-5.6-terra'); assert.equal(entry.display_name, 'GPT-5.6-Terra'); assert.match(entry.description, /Answered by/);
});
