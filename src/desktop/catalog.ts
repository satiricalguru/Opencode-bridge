import { inventory, makeRoute, credentials, supportedProtocol } from '../opencode.js';
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
    let reason: string | undefined;
    if (protocol === 'unsupported') reason = 'This provider protocol needs an adapter.';
    else if (meta.providerID === 'opencode-go') reason = 'OpenCode Go integration is not enabled.';
    else if (meta.providerID === 'opencode' && free) reason = 'OpenCode restricts its free-tier routes to OpenCode itself.';
    else if (!meta.capabilities?.toolcall) reason = 'Desktop integration requires tool-call support.';
    else {
      if (!auth.has(meta.providerID)) auth.set(meta.providerID, makeRoute(ref, 'sonnet', metadata).then(credentials).then(() => true, () => false));
      if (!await auth.get(meta.providerID)) reason = 'Connect this provider with an API key in OpenCode. OAuth reuse is not supported yet.';
    }
    items.push({ ref, name: meta.name || meta.id, provider: meta.providerID, source: meta._bridgeSource === 'ollama' ? 'ollama' : 'opencode', protocol, tools: !!meta.capabilities?.toolcall, vision: !!meta.capabilities?.input?.image, context: meta.limit?.context || 32768, free, enabled: !reason, ...(reason ? { reason } : {}) });
  }
  items.sort((a, b) => Number(b.source === 'ollama') - Number(a.source === 'ollama') || Number(b.enabled) - Number(a.enabled) || a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  return { metadata, items, notices };
}
