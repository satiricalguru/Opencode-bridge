import { inventory, makeRoute, credentials, supportedProtocol, agentEligible } from '../opencode.js';
import { effortCapability } from '../effort.js';
import type { Wire } from '../types.js';
import type { ModelItem } from './contracts.js';

export interface Catalog { metadata: Map<string, Wire>; items: ModelItem[]; notices: string[] }
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
export async function discoverCatalog(): Promise<Catalog> {
  const notices: string[] = [];
  const [openCode, local] = await Promise.allSettled([inventory(), discoverLocalModels()]);
  const metadata = openCode.status === 'fulfilled' ? openCode.value : new Map<string, Wire>();
  if (openCode.status === 'rejected') notices.push('OpenCode models could not be read. Check that its CLI is installed and your provider configuration is valid.');
  if (local.status === 'fulfilled') for (const [ref, meta] of local.value) if (!metadata.has(ref)) metadata.set(ref, meta);
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
    if (!meta.capabilities?.toolcall) reason = 'Desktop integration requires tool-call support.';
    else if (protocol === 'unsupported') direct = 'This provider protocol needs an adapter.';
    else if (meta.providerID === 'opencode-go') direct = 'OpenCode Go integration is not enabled.';
    else if (meta.providerID === 'opencode' && free) direct = 'OpenCode free models only run inside OpenCode.';
    else {
      if (!auth.has(meta.providerID)) auth.set(meta.providerID, makeRoute(ref, 'sonnet', metadata).then(credentials).then(() => true, () => false));
      if (!await auth.get(meta.providerID)) direct = 'Connect this provider with an API key in OpenCode.';
    }
    if (!reason && direct) { if (agent) via = 'agent'; else reason = direct; }
    const efforts = reason ? [] : effortCapability(meta, via === 'agent' ? 'opencode' : protocol as 'anthropic' | 'chat')?.levels || [];
    items.push({ ref, name: meta.name || meta.id, provider: meta.providerID, source: meta._bridgeSource === 'ollama' ? 'ollama' : 'opencode', protocol: via === 'agent' ? 'opencode' : protocol, via, efforts, tools: !!meta.capabilities?.toolcall, vision: !!meta.capabilities?.input?.image, context: meta.limit?.context || 32768, free, enabled: !reason, ...(reason ? { reason } : {}) });
  }
  items.sort((a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.source === 'ollama') - Number(a.source === 'ollama') || Number(b.free) - Number(a.free) || a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  return { metadata, items, notices };
}
