import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { activateProfile, isProfileActive, restoreProfile, PROFILE_ID, journalPath, previewProfile } from '../src/profile.js';
import { atomicJSON, readJSON } from '../src/storage.js';
import { config } from './helpers.js';
import { CLAUDE_SLOTS } from '../src/slots.js';
import { resolveRoute } from '../src/gateway.js';

async function setup(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'bridge-profile-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const support = join(root, 'support'); const dir = join(root, 'state');
  const normal = join(support, 'Claude', 'claude_desktop_config.json');
  const third = join(support, 'Claude-3p', 'claude_desktop_config.json');
  const meta = join(support, 'Claude-3p', 'configLibrary', '_meta.json');
  const profile = join(support, 'Claude-3p', 'configLibrary', `${PROFILE_ID}.json`);
  return { root, support, dir, normal, third, meta, profile };
}
test('activation/restoration preserves an existing Ollama profile and unrelated later edits', async t => {
  const f = await setup(t);
  const ollamaId = '00000000-0000-4000-8000-000000000114';
  await atomicJSON(f.normal, { deploymentMode: '3p', mcpServers: { untouched: {} } });
  await atomicJSON(f.third, { deploymentMode: '3p', theme: 'dark' });
  await atomicJSON(f.meta, { appliedId: ollamaId, entries: [{ id: ollamaId, name: 'Ollama' }] });
  const ollamaFile = join(f.support, 'Claude-3p', 'configLibrary', `${ollamaId}.json`);
  await atomicJSON(ollamaFile, { inferenceProvider: 'gateway', inferenceGatewayBaseUrl: 'http://127.0.0.1:11435' });
  const before = await readFile(ollamaFile, 'utf8');
  const preview = await previewProfile(config(), f.support);
  assert.equal(preview.previous.find((r: any) => r.key === 'appliedId').value, ollamaId);
  assert.equal(await readJSON(journalPath(f.dir)), undefined);
  await activateProfile(config(), f.dir, f.support);
  assert.equal((await readJSON(f.meta))?.appliedId, PROFILE_ID);
  assert.equal((await readJSON(f.profile))?.autoModeEnabled, false);
  assert.equal((await readJSON(f.profile))?.coworkEgressAllowedHosts, undefined);
  await atomicJSON(f.normal, { ...(await readJSON(f.normal)), theme: 'light' });
  await atomicJSON(f.meta, { ...(await readJSON(f.meta)), entries: [...(await readJSON(f.meta))!.entries, { id: 'new-profile', name: 'Added after connection' }] });
  assert.equal(await restoreProfile(f.dir), true);
  assert.equal((await readJSON(f.meta))?.appliedId, ollamaId);
  assert.deepEqual((await readJSON(f.meta))?.entries.map((e: any) => e.id), [ollamaId, 'new-profile']);
  assert.equal((await readJSON(f.normal))?.theme, 'light');
  assert.deepEqual((await readJSON(f.normal))?.mcpServers, { untouched: {} });
  assert.equal(await readFile(ollamaFile, 'utf8'), before);
  assert.equal(await readJSON(f.profile), undefined); assert.equal(await readJSON(journalPath(f.dir)), undefined);
});
test('restore removes bridge-created files and preserves missing fields', async t => {
  const f = await setup(t);
  await activateProfile(config(), f.dir, f.support); await restoreProfile(f.dir);
  for (const path of [f.normal, f.third, f.meta, f.profile]) assert.equal(await readJSON(path), undefined);
});
test('Claude picker uses distinct family names and only advertises supported effort levels', async t => {
  const f = await setup(t); const cfg = config('anthropic');
  cfg.routes = ['sonnet', 'opus', 'haiku'].map((tier, index) => ({ ...cfg.routes[0], tier: tier as any, id: `alias-${tier}`, ...(index === 0 ? { effort: { mode: 'native', levels: ['low', 'medium', 'high'] } } : {}) })) as any;
  await activateProfile(cfg, f.dir, f.support);
  assert.deepEqual((await readJSON(f.profile))?.inferenceModels.map((m: any) => [m.labelOverride, m.maxEffort]), [['Claude Sonnet 5', 'high'], ['Claude Opus 5', 'low'], ['Claude Haiku 4.5', 'low']]);
  await restoreProfile(f.dir);
});
test('five picker slots keep Sonnet 5 as the bare family default and restore the original connection after reapply', async t => {
  const f = await setup(t); const cfg = config('anthropic');
  await atomicJSON(f.normal, { deploymentMode: '1p', theme: 'original' });
  cfg.routes = CLAUDE_SLOTS.map(slot => ({ ...cfg.routes[0], id: slot.id, tier: slot.tier, slot: slot.key, ref: `fixture/${slot.key}` }));
  await activateProfile(cfg, f.dir, f.support);
  let models = (await readJSON(f.profile))!.inferenceModels;
  assert.equal(models.length, 5); assert.equal(models.find((model: any) => model.name === 'claude-sonnet-4-6').isFamilyDefault, false);
  assert.equal(resolveRoute(cfg, 'sonnet').id, 'claude-sonnet-5'); assert.equal(resolveRoute(cfg, 'fable').ref, 'fixture/fable');
  assert.equal(resolveRoute(cfg, 'claude-sonnet-4-6').ref, 'fixture/sonnet46');
  await restoreProfile(f.dir);
  await activateProfile({ ...cfg, autoMode: true }, f.dir, f.support);
  assert.equal((await readJSON(f.profile))?.autoModeEnabled, true);
  await restoreProfile(f.dir);
  assert.deepEqual(await readJSON(f.normal), { deploymentMode: '1p', theme: 'original' });
});
test('restore detects an external connection change before modifying any file', async t => {
  const f = await setup(t);
  await atomicJSON(f.normal, { deploymentMode: '1p' });
  await activateProfile(config(), f.dir, f.support);
  await atomicJSON(f.profile, { ...(await readJSON(f.profile)), inferenceGatewayBaseUrl: 'https://external.example' });
  await assert.rejects(() => restoreProfile(f.dir), /Restore conflict/);
  assert.equal((await readJSON(f.normal))?.deploymentMode, '3p');
  assert.ok(await readJSON(journalPath(f.dir)));
});
test('repeated activation cannot overwrite the original recovery journal', async t => {
  const f = await setup(t); await activateProfile(config(), f.dir, f.support);
  const journal = await readFile(journalPath(f.dir), 'utf8');
  await assert.rejects(() => activateProfile(config(), f.dir, f.support), /journal already exists/);
  assert.equal(await readFile(journalPath(f.dir), 'utf8'), journal); await restoreProfile(f.dir);
});
test('pending journal restores after an interrupted multi-file application', async t => {
  const f = await setup(t);
  await atomicJSON(f.normal, { deploymentMode: '1p' });
  await activateProfile(config(), f.dir, f.support);
  const journal = (await readJSON(journalPath(f.dir)))!; journal.state = 'pending';
  await atomicJSON(journalPath(f.dir), journal);
  await atomicJSON(f.normal, { deploymentMode: '1p' }); // simulated file not applied yet
  assert.equal(await restoreProfile(f.dir), true); assert.deepEqual(await readJSON(f.normal), { deploymentMode: '1p' });
});
test('active profile reuse checks configuration and externally edited fields without changing the recovery journal', async t => {
  const f = await setup(t); const cfg = config();
  assert.equal(await isProfileActive(cfg, f.dir, f.support), false);
  await activateProfile(cfg, f.dir, f.support);
  const journal = await readFile(journalPath(f.dir), 'utf8');
  assert.equal(await isProfileActive(cfg, f.dir, f.support), true);
  assert.equal(await isProfileActive({ ...cfg, port: cfg.port + 1 }, f.dir, f.support), false);
  await atomicJSON(f.normal, { ...(await readJSON(f.normal)), deploymentMode: '1p' });
  assert.equal(await isProfileActive(cfg, f.dir, f.support), false);
  assert.equal(await readFile(journalPath(f.dir), 'utf8'), journal);
});
