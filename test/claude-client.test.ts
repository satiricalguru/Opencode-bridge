import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeClient } from '../src/clients/claude.js';
import { activateProfile, journalPath, PROFILE_ID, isProfileActive } from '../src/profile.js';
import { atomicJSON, readJSON } from '../src/storage.js';
import { config } from './helpers.js';

async function setup(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'bridge-client-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const support = join(root, 'support'); const dir = join(root, 'state');
  const normal = join(support, 'Claude', 'claude_desktop_config.json');
  const profile = join(support, 'Claude-3p', 'configLibrary', `${PROFILE_ID}.json`);
  await atomicJSON(normal, { deploymentMode: '1p', theme: 'original' });
  await activateProfile(config('anthropic'), dir, support);
  const events: string[] = [];
  const client = new ClaudeClient(dir, support, { running: async () => true, quit: async restart => { assert.equal(restart, true); events.push('quit'); return true; }, open: async () => { events.push('open'); } });
  return { dir, support, normal, profile, events, client };
}
test('real client reapply restores the original connection before prepare, restarts once, and retains original disconnect state', async t => {
  const f = await setup(t); const updated = config('anthropic'); updated.routes[0].ref = 'fixture/new-model';
  await f.client.apply(updated, true, async () => {
    f.events.push('prepare'); assert.equal((await readJSON(f.normal))?.deploymentMode, '1p');
    assert.equal(await readJSON(journalPath(f.dir)), undefined);
  });
  assert.deepEqual(f.events, ['quit', 'prepare', 'open']);
  assert.equal(await isProfileActive(updated, f.dir, f.support), true);
  await f.client.disconnect(true);
  assert.deepEqual(await readJSON(f.normal), { deploymentMode: '1p', theme: 'original' });
  assert.equal(await readJSON(journalPath(f.dir)), undefined);
});
test('restore conflicts stop client reconfiguration before prepare and preserve the recovery journal', async t => {
  const f = await setup(t); const before = await readFile(journalPath(f.dir), 'utf8');
  await atomicJSON(f.profile, { ...(await readJSON(f.profile)), inferenceGatewayBaseUrl: 'https://external.example' });
  let prepared = false;
  await assert.rejects(() => f.client.apply(config('anthropic'), true, async () => { prepared = true; }), /Restore conflict/);
  assert.equal(prepared, false); assert.deepEqual(f.events, ['quit', 'open']);
  assert.equal(await readFile(journalPath(f.dir), 'utf8'), before);
  assert.equal((await readJSON(f.profile))?.inferenceGatewayBaseUrl, 'https://external.example');
});
test('a gateway preparation failure leaves Claude on its original connection and reopens it', async t => {
  const f = await setup(t);
  await assert.rejects(() => f.client.apply(config('anthropic'), true, async () => { throw new Error('Fixture gateway start failed'); }), /gateway start failed/);
  assert.deepEqual(f.events, ['quit', 'open']);
  assert.deepEqual(await readJSON(f.normal), { deploymentMode: '1p', theme: 'original' });
  assert.equal(await readJSON(journalPath(f.dir)), undefined);
  assert.equal(await readJSON(f.profile), undefined);
});
