import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeRoute, credentials, parseModels, supportedProtocol, resolveEnv } from '../src/opencode.js';
import { atomicJSON, readJSON } from '../src/storage.js';
import { initialize, configPath } from '../src/config.js';
import { route } from './helpers.js';

test('parse multiline CLI model metadata and identify unsupported runtime types', () => {
  const text = `provider/model\n{\n  "api": {"npm":"@ai-sdk/anthropic"},\n  "name": "Model"\n}\nprovider/other\n{\n  "api": {"npm":"@ai-sdk/openai"}\n}\n`;
  const models = parseModels(text); assert.equal(models.size, 2);
  assert.equal(supportedProtocol(models.get('provider/model')!), 'anthropic');
  assert.equal(supportedProtocol(models.get('provider/other')!), undefined);
});
test('parseModels tolerates corrupted JSON chunks and continues parsing remaining models', () => {
  const text = `provider/bad\n{\n  "corrupted json\n}\nprovider/good\n{\n  "name": "Good"\n}\n`;
  const models = parseModels(text);
  assert.equal(models.size, 1);
  assert.equal(models.get('provider/good')?.name, 'Good');
});
test('resolveEnv preserves empty string environment variables without throwing', () => {
  process.env.TEST_EMPTY_VAR = '';
  try {
    assert.equal(resolveEnv('prefix-{env:TEST_EMPTY_VAR}-suffix'), 'prefix--suffix');
  } finally {
    delete process.env.TEST_EMPTY_VAR;
  }
});
test('selected custom provider endpoint is imported without persisting configured API keys', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-import-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const saved = process.env.OPENCODE_CONFIG_DIR; process.env.OPENCODE_CONFIG_DIR = dir;
  t.after(() => { if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = saved; });
  await atomicJSON(join(dir, 'opencode.json'), { provider: { custom: { options: { baseURL: 'https://custom.example/v1', apiKey: 'DO_NOT_COPY_KEY', headers: { Authorization: 'SECRET_HEADER' } } } } });
  const models = new Map([['custom/my-model', { id: 'my-model', name: 'My Model', providerID: 'custom', api: { id: 'upstream-id', url: 'https://catalog.example/v1', npm: '@ai-sdk/openai-compatible' }, limit: { context: 64000, output: 4096 }, capabilities: { toolcall: true } }]]);
  const imported = await makeRoute('custom/my-model', 'sonnet', models);
  assert.equal(imported.baseURL, 'https://custom.example/v1'); assert.equal(imported.model, 'upstream-id');
  assert.equal(await credentials(imported), 'DO_NOT_COPY_KEY');
  assert.ok(!JSON.stringify(imported).includes('DO_NOT_COPY_KEY')); assert.ok(!JSON.stringify(imported).includes('SECRET_HEADER'));
});
test('configuration is permission-restricted and rejects embedded credentials and unauthenticated cloud endpoints', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-config-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await initialize([route()], 41415, dir);
  assert.equal((await stat(configPath(dir))).mode & 0o777, 0o600);
  assert.equal((await readJSON(configPath(dir)))?.token.length, 64);
  await assert.rejects(() => initialize([route()], 41415, dir), /already initialized/);
  const bad = route(); bad.baseURL = 'https://user:secret@example.com/v1';
  await assert.rejects(() => initialize([bad], 41415, join(dir, 'other')), /embedded credentials/);
});
test('local OpenCode models work without a cloud API key, while configured local keys are resolved at runtime', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-local-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const saved = process.env.OPENCODE_CONFIG_DIR; process.env.OPENCODE_CONFIG_DIR = dir;
  t.after(() => { if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = saved; });
  const models = new Map([['local/my-model', { id: 'my-model', name: 'Local', providerID: 'local', api: { id: 'my-model', url: 'http://127.0.0.1:11434/v1', npm: '@ai-sdk/openai-compatible' } }]]);
  const local = await makeRoute('local/my-model', 'sonnet', models);
  assert.equal(local.auth.none, true); assert.equal(await credentials(local), undefined);
  await atomicJSON(join(dir, 'opencode.json'), { provider: { local: { options: { apiKey: 'LOCAL_SECRET' } } } });
  const secured = await makeRoute('local/my-model', 'sonnet', models);
  assert.equal(secured.auth.none, undefined); assert.equal(await credentials(secured), 'LOCAL_SECRET');
});
