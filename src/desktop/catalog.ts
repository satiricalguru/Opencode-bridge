import { inventory, makeRoute, credentials, supportedProtocol, agentEligible } from '../opencode.js';
import { effortCapability } from '../effort.js';
import type { Wire } from '../types.js';
import type { ModelItem } from './contracts.js';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const exec = promisify(execFile);
export interface Catalog { metadata: Map<string, Wire>; items: ModelItem[]; notices: string[]; openCode?: Map<string, Wire> }
export const LMSTUDIO_URL = 'http://127.0.0.1:1234';
export const lmsBin = () => process.env.LMS_BIN || join(homedir(), '.lmstudio', 'bin', 'lms');
const lmStudioMeta = (key: string, model: Wire, serverUp: boolean): Wire => ({
  id: key, name: model.display_name || model.displayName || key, providerID: 'lmstudio', _bridgeSource: 'lmstudio', _serverUp: serverUp,
  // LM Studio 0.4 serves Anthropic Messages at /v1/messages, like Ollama.
  api: { id: key, url: `${LMSTUDIO_URL}/v1`, npm: '@ai-sdk/anthropic' },
  limit: { context: Math.min(model.max_context_length || model.maxContextLength || 32768, 131072), output: 8192 },
  capabilities: { toolcall: (model.capabilities?.trained_for_tool_use ?? model.trainedForToolUse) === true, reasoning: false, input: { image: (model.capabilities?.vision ?? model.vision) === true } },
  cost: { input: 0, output: 0 }, _type: model.type,
});
// LM Studio: the REST API when its server runs, otherwise the `lms` CLI's offline listing.
// Only lists downloaded models; never loads or downloads one.
// Downloaded models on disk (<root>/<publisher>/<model>). Read directly: the `lms`
// CLI boots LM Studio as a background service, which browsing must never do.
export async function lmStudioOnDisk(root = join(homedir(), '.lmstudio', 'models')): Promise<Wire[]> {
  const entries: Wire[] = [];
  for (const publisher of await readdir(root, { withFileTypes: true })) {
    if (!publisher.isDirectory() || publisher.name.startsWith('.')) continue;
    for (const model of await readdir(join(root, publisher.name), { withFileTypes: true })) {
      if (!model.isDirectory() || model.name.startsWith('.') || /embed/i.test(model.name)) continue;
      entries.push({ key: model.name, display_name: model.name, type: 'llm', offline: true });
    }
  }
  return entries;
}
export async function discoverLmStudio(fetcher: typeof fetch = fetch, list: () => Promise<Wire[]> = () => lmStudioOnDisk()): Promise<Map<string, Wire>> {
  const models = new Map<string, Wire>();
  let entries: Wire[] = []; let serverUp = false;
  try {
    const response = await fetcher(`${LMSTUDIO_URL}/api/v1/models`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (response.ok) { const data = await response.json() as Wire; if (Array.isArray(data.models)) { entries = data.models; serverUp = true; } }
  } catch {}
  if (!serverUp) { try { const listed = await list(); if (Array.isArray(listed)) entries = listed; } catch { return models; } }
  for (const model of entries.slice(0, 200)) {
    const key = model.key || model.modelKey;
    if (typeof key !== 'string' || model.type !== 'llm') continue;
    models.set(`lmstudio/${key}`, { ...lmStudioMeta(key, model, serverUp), ...(model.offline ? { _offline: true } : {}) });
  }
  return models;
}
export async function discoverLocalModels(fetcher: typeof fetch = fetch): Promise<Map<string, Wire>> {
  const baseURL = 'http://127.0.0.1:11434';
  const response = await fetcher(`${baseURL}/api/tags`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
  if (!response.ok) return new Map();
  const tags = await response.json() as Wire;
  if (!Array.isArray(tags.models)) return new Map();
  const models = new Map<string, Wire>();
  // Inspect only installed models. Never pull a model or start inference during discovery.
  for (const tag of tags.models.slice(0, 100)) {
    if (typeof tag.name !== 'string') continue;
    try {
      const show = await fetcher(`${baseURL}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: tag.name }), signal: AbortSignal.timeout(2000), redirect: 'error' });
      if (!show.ok) continue;
      const info = await show.json() as Wire;
      const context = Object.entries(info.model_info || {}).find(([key]) => key.endsWith('.context_length'))?.[1];
      models.set(`ollama-local/${tag.name}`, {
        id: tag.name, name: tag.name, providerID: 'ollama-local', _bridgeSource: 'ollama',
        // Ollama already implements Messages and thinking streams; use its adapter.
        api: { id: tag.name, url: `${baseURL}/v1`, npm: '@ai-sdk/anthropic' },
        limit: { context: typeof context === 'number' ? Math.min(context, 32768) : 32768, output: 4096 },
        capabilities: { toolcall: info.capabilities?.includes('tools') === true, reasoning: info.capabilities?.includes('thinking') === true, input: { image: info.capabilities?.includes('vision') === true } },
        cost: { input: 0, output: 0 },
      });
    } catch { /* A temporarily unavailable model is omitted rather than advertised as ready. */ }
  }
  return models;
}
// Before launch: start LM Studio's server if needed and load the selected models
// (LM Studio's Messages endpoint answers "No models loaded" otherwise).
export async function ensureLmStudio(keys: string[], fetcher: typeof fetch = fetch, run: (args: string[]) => Promise<unknown> = args => exec(lmsBin(), args, { timeout: 60_000 })): Promise<void> {
  if (!keys.length) return;
  const listing = async () => { try { const r = await fetcher(`${LMSTUDIO_URL}/api/v1/models`, { signal: AbortSignal.timeout(1500), redirect: 'error' }); return r.ok ? await r.json() as Wire : undefined; } catch { return undefined; } };
  let data = await listing();
  if (!data) {
    try { await run(['server', 'start']); } catch { throw new Error('LM Studio’s server could not be started. Open LM Studio and enable its local server.'); }
    data = await listing();
    if (!data) throw new Error('LM Studio’s server did not respond on port 1234.');
  }
  for (const key of new Set(keys)) {
    const model = (data.models || []).find((m: Wire) => m.key === key);
    if (model?.loaded_instances?.length) continue;
    const response = await fetcher(`${LMSTUDIO_URL}/api/v1/models/load`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: key }), signal: AbortSignal.timeout(300_000), redirect: 'error' }).catch(() => undefined);
    if (!response?.ok) throw new Error(`LM Studio could not load ${key}. Load it in LM Studio, then try again.`);
  }
}
// reuse: a previous OpenCode inventory, so a local-only change skips the slow CLI call.
export async function discoverCatalog(reuse?: Map<string, Wire>): Promise<Catalog> {
  const notices: string[] = [];
  const [openCode, local, lmstudio] = await Promise.allSettled([reuse ? Promise.resolve(reuse) : inventory(), discoverLocalModels(), discoverLmStudio()]);
  const metadata = new Map<string, Wire>(openCode.status === 'fulfilled' ? openCode.value : []);
  if (openCode.status === 'rejected') notices.push('OpenCode models could not be read. Check that its CLI is installed and your provider configuration is valid.');
  for (const found of [local, lmstudio]) if (found.status === 'fulfilled') for (const [ref, meta] of found.value) if (!metadata.has(ref)) metadata.set(ref, meta);
  const auth = new Map<string, Promise<boolean>>();
  const items: ModelItem[] = [];
  for (const [ref, meta] of metadata) {
    const protocol = supportedProtocol(meta) || 'unsupported';
    const free = meta.cost?.input === 0 && meta.cost?.output === 0;
    const agent = openCode.status === 'fulfilled' && agentEligible(meta);
    let reason: string | undefined; let via: 'direct' | 'agent' = 'direct';
    // Prefer a direct route: Desktop's own tools (Code, Cowork) then run client-side.
    // Otherwise run the model inside OpenCode's agent, which OpenCode supports for
    // its free tier, OAuth logins and every SDK it ships.
    let direct: string | undefined;
    if (meta._offline) reason = 'LM Studio isn’t running. Open LM Studio and turn on its local server to use this model — it will appear here automatically.';
    else if (meta._bridgeSource === 'lmstudio' && !meta.capabilities?.toolcall) reason = 'LM Studio reports this model is not trained for tool use.';
    else if (!meta.capabilities?.toolcall) reason = 'Desktop integration requires tool-call support.';
    else if (protocol === 'unsupported') direct = 'This provider protocol needs an adapter.';
    else if (meta.providerID === 'opencode-go') direct = 'OpenCode Go integration is not enabled.';
    else if (meta.providerID === 'opencode' && free) direct = 'OpenCode free models only run inside OpenCode.';
    else {
      if (!auth.has(meta.providerID)) auth.set(meta.providerID, makeRoute(ref, 'sonnet', metadata).then(credentials).then(() => true, () => false));
      if (!await auth.get(meta.providerID)) direct = 'Connect this provider with an API key in OpenCode.';
    }
    if (!reason && direct) { if (agent) via = 'agent'; else reason = direct; }
    const efforts = reason ? [] : effortCapability(meta, via === 'agent' ? 'opencode' : protocol as 'anthropic' | 'chat')?.levels || [];
    items.push({ ref, name: meta.name || meta.id, provider: meta.providerID, source: meta._bridgeSource === 'ollama' || meta._bridgeSource === 'lmstudio' ? meta._bridgeSource : 'opencode', protocol: via === 'agent' ? 'opencode' : protocol, via, efforts, tools: !!meta.capabilities?.toolcall, vision: !!meta.capabilities?.input?.image, context: meta.limit?.context || 32768, free, enabled: !reason, ...(reason ? { reason } : {}) });
  }
  items.sort((a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.source !== 'opencode') - Number(a.source !== 'opencode') || Number(b.free) - Number(a.free) || a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  return { metadata, items, notices, ...(openCode.status === 'fulfilled' ? { openCode: openCode.value } : {}) };
}
