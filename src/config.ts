import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { atomicJSON, readJSON, stateDir } from './storage.js';
import { isObject, type BridgeConfig, type Route } from './types.js';
import { EFFORTS } from './effort.js';
import { CLAUDE_SLOTS } from './slots.js';

export const configPath = (directory = stateDir()) => join(directory, 'bridge.json');
export function validateConfig(value: unknown): asserts value is BridgeConfig {
  if (!isObject(value) || value.version !== 1 || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || typeof value.token !== 'string' || value.token.length < 32 || !Array.isArray(value.routes) || !value.routes.length) throw new Error('Invalid bridge configuration. Run init or check the configuration file.');
  const ids = new Set<string>();
  if (value.autoMode !== undefined && typeof value.autoMode !== 'boolean') throw new Error('Invalid Auto mode setting.');
  for (const route of value.routes) {
    if (!isObject(route) || typeof route.id !== 'string' || ids.has(route.id) || !['sonnet', 'opus', 'haiku', 'fable'].includes(route.tier) || !['chat', 'anthropic'].includes(route.protocol) || !route.model || !route.ref || !route.label || !isObject(route.auth) || !Number.isSafeInteger(route.maxOutputTokens) || route.maxOutputTokens < 1 || !Number.isSafeInteger(route.contextTokens) || route.contextTokens < 1) throw new Error('Invalid or duplicate bridge route.');
    if (route.slot && !CLAUDE_SLOTS.some(slot => slot.key === route.slot && slot.tier === route.tier && slot.id === route.id)) throw new Error('Invalid Claude model slot.');
    ids.add(route.id);
    if (route.effort && (!isObject(route.effort) || route.effort.mode !== (route.protocol === 'anthropic' ? 'native' : 'chat') || !Array.isArray(route.effort.levels) || !route.effort.levels.length || route.effort.levels.some((level: any) => !EFFORTS.includes(level)) || new Set(route.effort.levels).size !== route.effort.levels.length)) throw new Error('Invalid route effort capability.');
    const u = new URL(route.baseURL);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && local))) throw new Error('Route endpoint must be HTTPS or loopback HTTP, without embedded credentials.');
    if (route.auth.none && !local) throw new Error('Unauthenticated upstream routes must be local.');
    if (route.headers && Object.keys(route.headers).some(key => /authorization|api.?key|token|cookie/i.test(key))) throw new Error('Secrets must be resolved at runtime, not stored in route headers.');
  }
}
export async function loadConfig(directory = stateDir()): Promise<BridgeConfig> {
  const value = await readJSON(configPath(directory)); validateConfig(value); return value;
}
export async function initialize(routes: Route[], port = 41415, directory = stateDir(), autoMode?: boolean): Promise<BridgeConfig> {
  const previous = await readJSON(configPath(directory));
  if (previous) throw new Error('Bridge is already initialized. Use a different BRIDGE_STATE_DIR or edit its routes after stopping the gateway.');
  const config: BridgeConfig = { version: 1, port, token: randomBytes(32).toString('hex'), routes, ...(autoMode !== undefined ? { autoMode } : {}) };
  validateConfig(config); await atomicJSON(configPath(directory), config); return config;
}
export function publicConfig(config: BridgeConfig) {
  return { version: config.version, port: config.port, routes: config.routes.map(({ id, tier, ref, label, protocol, contextTokens, maxOutputTokens, tools, vision }) => ({ id, tier, ref, label, protocol, contextTokens, maxOutputTokens, tools, vision })) };
}
