import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverLmStudio, ensureLmStudio } from '../src/desktop/catalog.js';
import { fingerprint, ModelWatcher, type Fingerprint } from '../src/desktop/watch.js';
import { parseDesktopRequest } from '../src/desktop/requests.js';

test('LM Studio discovery uses the REST API when up, the CLI listing when down, and never treats embeddings as chat models', async () => {
  const up = await discoverLmStudio(async () => Response.json({ models: [
    { type: 'llm', key: 'qwen/qwen3-coder', display_name: 'Qwen3 Coder', max_context_length: 262144, capabilities: { vision: false, trained_for_tool_use: true } },
    { type: 'llm', key: 'rvc', display_name: 'RVC', capabilities: { trained_for_tool_use: false } },
    { type: 'embedding', key: 'nomic' },
  ] }), async () => { throw new Error('CLI must not run when the API answers'); });
  assert.deepEqual([...up.keys()], ['lmstudio/qwen/qwen3-coder', 'lmstudio/rvc']);
  const qwen = up.get('lmstudio/qwen/qwen3-coder')!;
  assert.equal(qwen.api.npm, '@ai-sdk/anthropic'); assert.equal(qwen.api.url, 'http://127.0.0.1:1234/v1');
  assert.equal(qwen.capabilities.toolcall, true); assert.equal(qwen.limit.context, 131072);
  const down = await discoverLmStudio(async () => { throw new Error('ECONNREFUSED'); }, async () => [{ type: 'llm', modelKey: 'gemma', displayName: 'Gemma', maxContextLength: 8192, trainedForToolUse: true, vision: true }]);
  assert.equal(down.get('lmstudio/gemma')?.capabilities.input.image, true);
  // With the server off, models come from disk (never the `lms` CLI, which boots LM Studio).
  const root = await mkdtemp(join(tmpdir(), 'bridge-lms-'));
  await mkdir(join(root, 'qwen', 'qwen3-coder-30b'), { recursive: true }); await mkdir(join(root, 'nomic-ai', 'nomic-embed-text'), { recursive: true });
  const { lmStudioOnDisk } = await import('../src/desktop/catalog.js');
  const offline = await discoverLmStudio(async () => { throw new Error('ECONNREFUSED'); }, () => lmStudioOnDisk(root));
  assert.deepEqual([...offline.keys()], ['lmstudio/qwen3-coder-30b']); assert.equal(offline.get('lmstudio/qwen3-coder-30b')?._offline, true);
  await rm(root, { recursive: true, force: true });
  assert.equal((await discoverLmStudio(async () => { throw new Error('down'); }, async () => { throw new Error('no lms'); })).size, 0);
});
test('LM Studio preparation starts the server when needed and loads only unloaded models', async () => {
  const calls: string[] = []; let serverUp = false;
  const fetcher = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method || 'GET'} ${new URL(url).pathname}${init?.body ? ` ${JSON.parse(init.body as string).model}` : ''}`);
    if (!serverUp) throw new Error('ECONNREFUSED');
    if (url.endsWith('/load')) return Response.json({ ok: true });
    return Response.json({ models: [{ key: 'a', loaded_instances: [{}] }, { key: 'b', loaded_instances: [] }] });
  }) as typeof fetch;
  await ensureLmStudio(['a', 'b', 'b'], fetcher, async args => { calls.push(`lms ${args.join(' ')}`); serverUp = true; });
  assert.deepEqual(calls, ['GET /api/v1/models', 'lms server start', 'GET /api/v1/models', 'POST /api/v1/models/load b']);
  await ensureLmStudio([], async () => { throw new Error('no calls for no LM Studio routes'); });
});
test('watcher fingerprints reflect Ollama tags, LM Studio folders and OpenCode files, and fire only on change', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-watch-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let tags = [{ name: 'qwen3.6', digest: 'a' }];
  const fetcher = (async (url: string) => url.includes('11434') ? Response.json({ models: tags }) : Promise.reject(new Error('down'))) as typeof fetch;
  const before = await fingerprint(fetcher, dir, [join(dir, 'models.json')]);
  assert.deepEqual(await fingerprint(fetcher, dir, [join(dir, 'models.json')]), before);
  tags = [...tags, { name: 'llama4', digest: 'b' }];
  const pulled = await fingerprint(fetcher, dir, [join(dir, 'models.json')]);
  assert.notEqual(pulled.local, before.local); assert.equal(pulled.opencode, before.opencode);
  await mkdir(join(dir, 'qwen', 'qwen3-coder'), { recursive: true });
  assert.notEqual((await fingerprint(fetcher, dir, [join(dir, 'models.json')])).local, pulled.local);

  let current: Fingerprint = { local: 'l1', opencode: 'o1' };
  const seen: string[][] = []; let fail = false;
  const watcher = new ModelWatcher(async kinds => { if (fail) throw new Error('busy'); seen.push(kinds); }, async () => current, 60_000);
  await watcher.start(); t.after(() => watcher.stop());
  await watcher.tick(); assert.deepEqual(seen, []);
  current = { local: 'l2', opencode: 'o1' }; fail = true; await watcher.tick();
  fail = false; await watcher.tick(); // A refused refresh is retried on the next tick.
  current = { local: 'l2', opencode: 'o2' }; await watcher.tick();
  assert.deepEqual(seen, [['local'], ['opencode']]);
});
test('IPC accepts theme changes only for known themes', () => {
  assert.deepEqual(parseDesktopRequest({ action: 'theme', theme: 'dark' }), { action: 'theme', theme: 'dark' });
  assert.throws(() => parseDesktopRequest({ action: 'theme', theme: 'neon' }));
  assert.throws(() => parseDesktopRequest({ action: 'theme', theme: 'dark', extra: 1 }));
});
