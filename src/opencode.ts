import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readJSON } from './storage.js';
import { BridgeError, isObject, type Route, type Slot, type Wire } from './types.js';
import { effortCapability } from './effort.js';
import { CLAUDE_SLOTS } from './slots.js';

const exec = promisify(execFile);
export const SLOTS = Object.fromEntries(CLAUDE_SLOTS.map(slot => [slot.key, slot.id])) as Record<Slot, string>;
const ENV: Record<string, string> = {
  opencode: 'OPENCODE_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY',
  nvidia: 'NVIDIA_API_KEY', openrouter: 'OPENROUTER_API_KEY', 'ollama-cloud': 'OLLAMA_API_KEY',
};
export function parseModels(text: string): Map<string, Wire> {
  const result = new Map<string, Wire>();
  // CLI output: a model reference followed by one pretty-printed JSON object.
  const pattern = /^([^\s]+\/[^\s]+)\r?\n(\{[\s\S]*?^\})/gm;
  for (const match of text.matchAll(pattern)) {
    try {
      const data = JSON.parse(match[2]);
      if (isObject(data)) result.set(match[1], data);
    } catch {}
  }
  return result;
}
export async function inventory(): Promise<Map<string, Wire>> {
  const { stdout } = await exec(process.env.OPENCODE_BIN || 'opencode', ['models', '--verbose', '--pure'], {
    maxBuffer: 30 * 1024 * 1024, timeout: 60_000,
  });
  const models = parseModels(stdout);
  if (!models.size) throw new Error('OpenCode returned no readable model metadata. Requires the v1 models --verbose interface.');
  return models;
}
export function supportedProtocol(model: Wire): 'anthropic' | 'chat' | undefined {
  const npm = model.api?.npm;
  if (npm === '@ai-sdk/anthropic') return 'anthropic';
  if (npm === '@ai-sdk/openai-compatible' || npm === '@ai-sdk/openrouter') return 'chat';
  if (npm === '@ai-sdk/openai' && model.api?.endpoint === 'chat') return 'chat';
  return undefined;
}
export function resolveEnv(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\{env:([^}]+)\}|\$\{([^}]+)\}/g, (_, a, b) => {
    const name = a || b;
    if (process.env[name] === undefined) throw new Error(`Missing environment variable ${name}`);
    return process.env[name]!;
  });
  if (Array.isArray(value)) return value.map(resolveEnv);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, resolveEnv(val)]));
  return value;
}
export async function providerConfig(provider: string): Promise<Wire> {
  const root = process.env.OPENCODE_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode');
  const files = [join(root, 'opencode.json'), join(root, 'opencode.jsonc'), join(process.cwd(), 'opencode.json'), join(process.cwd(), 'opencode.jsonc')];
  if (process.env.OPENCODE_CONFIG) files.push(process.env.OPENCODE_CONFIG);
  let selected: Wire = {};
  for (const file of [...new Set(files)]) {
    const doc = await readJSON(file);
    if (!doc) continue;
    if (doc.providers) throw new Error('OpenCode v2 configuration is not supported by this importer yet.');
    const p = doc.provider?.[provider];
    if (p) selected = { ...selected, ...p, options: { ...selected.options, ...p.options } };
  }
  return selected;
}
export async function credentials(route: Route): Promise<string | undefined> {
  if (route.auth.none) return undefined;
  if (route.auth.env && process.env[route.auth.env]) return process.env[route.auth.env];
  const provider = route.auth.provider;
  if (!provider) throw new BridgeError(401, 'authentication_error', 'This route has no credential source.');
  const cfg = await providerConfig(provider);
  const configured = resolveEnv(cfg.options?.apiKey);
  if (typeof configured === 'string' && configured) return configured;
  const path = process.env.OPENCODE_AUTH_FILE || join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'opencode/auth.json');
  const doc = await readJSON(path);
  const auth = doc?.[provider];
  if (auth?.type === 'api' && typeof auth.key === 'string') return auth.key;
  if (auth?.type === 'oauth') throw new BridgeError(401, 'authentication_error', `${provider}: OAuth runtime reuse is not implemented. Use an API-key connection.`);
  throw new BridgeError(401, 'authentication_error', `No API key available for ${provider}. Connect it in OpenCode first.`);
}
export async function makeRoute(ref: string, slot: Slot, models?: Map<string, Wire>): Promise<Route> {
  const model = (models || await inventory()).get(ref);
  if (!model) throw new Error(`Model not found in OpenCode: ${ref}`);
  const protocol = supportedProtocol(model);
  if (!protocol) throw new Error(`${ref} uses an unsupported provider runtime (Responses, Google, OAuth, or custom SDK).`);
  if (model.providerID === 'opencode-go') throw new Error('Go routes are deferred until Desktop session/usage compatibility is validated.');
  const cfg = await providerConfig(model.providerID);
  if (cfg.blacklist?.includes(model.id) || (cfg.whitelist && !cfg.whitelist.includes(model.id))) throw new Error(`${ref} is filtered by OpenCode configuration.`);
  const options = { ...model.options };
  // Never persist a key read from OpenCode; resolve it at request time.
  delete options.apiKey;
  const baseURL = resolveEnv(cfg.options?.baseURL || model.api.url);
  if (typeof baseURL !== 'string') throw new Error('Provider has no usable base URL.');
  const url = new URL(baseURL);
  if (url.username || url.password || url.search || url.hash) throw new Error('Provider base URL must not contain credentials, query parameters, or fragments.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Provider endpoints must use HTTPS or local loopback HTTP.');
  return {
    id: SLOTS[slot], tier: slot === 'sonnet46' ? 'sonnet' : slot, slot, ref, label: `${model.name} · ${model.providerID}`,
    protocol, baseURL: baseURL.replace(/\/$/, ''), model: model.api.id,
    auth: { provider: model.providerID, env: ENV[model.providerID],
      ...(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !cfg.options?.apiKey && !process.env[ENV[model.providerID]] ? { none: true } : {}) },
    headers: Object.fromEntries(Object.entries(model.headers || {}).filter(([key]) => !/authorization|api.?key|token|cookie/i.test(key))) as Record<string, string>, options,
    contextTokens: model.limit?.context || 32768, inputTokens: model.limit?.input,
    maxOutputTokens: model.limit?.output || 4096,
    vision: model.capabilities?.input?.image === true, tools: model.capabilities?.toolcall === true,
    reasoningField: model.capabilities?.interleaved?.field,
    effort: effortCapability(model, protocol),
  };
}
