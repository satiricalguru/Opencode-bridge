import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { atomicJSON, readJSON, stateDir } from './storage.js';
import { isObject, type BridgeConfig, type Route } from './types.js';
import { EFFORTS } from './effort.js';
import { CLAUDE_SLOTS } from './slots.js';

export const configPath = (directory = stateDir()) => join(directory, 'bridge.json');
export const OPENCODE_AGENT_URL = 'opencode://agent';
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
function validateRoute(route: unknown, ids: Set<string>, codex: boolean): void {
  if (!isObject(route) || typeof route.id !== 'string' || !route.id || ids.has(route.id) || !['sonnet', 'opus', 'haiku', 'fable'].includes(route.tier) || !['chat', 'anthropic', 'opencode'].includes(route.protocol) || !route.model || !route.ref || !route.label || !isObject(route.auth) || !Number.isSafeInteger(route.maxOutputTokens) || route.maxOutputTokens < 1 || !Number.isSafeInteger(route.contextTokens) || route.contextTokens < 1) throw new Error('Invalid or duplicate bridge route.');
  if (codex ? route.slot !== undefined : route.slot && !CLAUDE_SLOTS.some(slot => slot.key === route.slot && slot.tier === route.tier && slot.id === route.id)) throw new Error('Invalid Claude model slot.');
  ids.add(route.id);
  const mode = route.protocol === 'anthropic' ? 'native' : route.protocol;
  if (route.effort && (!isObject(route.effort) || route.effort.mode !== mode || !Array.isArray(route.effort.levels) || !route.effort.levels.length || route.effort.levels.some((level: any) => !EFFORTS.includes(level)) || new Set(route.effort.levels).size !== route.effort.levels.length)) throw new Error('Invalid route effort capability.');
  if (route.effortOverride !== undefined && !EFFORTS.includes(route.effortOverride)) throw new Error('Invalid route effort override.');
  if (route.displayName !== undefined && (typeof route.displayName !== 'string' || !route.displayName || route.displayName.length > 64)) throw new Error('Invalid route display name.');
  if (route.protocol === 'opencode') {
    // Inference is performed by the bridge-owned OpenCode server, never a stored endpoint.
    if (route.baseURL !== OPENCODE_AGENT_URL || !/^[^/\s]+\/\S+$/.test(route.ref)) throw new Error('Invalid OpenCode agent route.');
    return;
  }
  const u = new URL(route.baseURL);
  const local = LOOPBACK.includes(u.hostname);
  if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && local))) throw new Error('Route endpoint must be HTTPS or loopback HTTP, without embedded credentials.');
  if (route.auth.none && !local) throw new Error('Unauthenticated upstream routes must be local.');
  if (route.headers && Object.keys(route.headers).some(key => /authorization|api.?key|token|cookie/i.test(key))) throw new Error('Secrets must be resolved at runtime, not stored in route headers.');
}
export function validateConfig(value: unknown): asserts value is BridgeConfig {
  if (!isObject(value) || value.version !== 1 || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || typeof value.token !== 'string' || value.token.length < 32 || !Array.isArray(value.routes) || (value.codexRoutes !== undefined && !Array.isArray(value.codexRoutes)) || !(value.routes.length || value.codexRoutes?.length)) throw new Error('Invalid bridge configuration. Run init or check the configuration file.');
  if (value.autoMode !== undefined && typeof value.autoMode !== 'boolean') throw new Error('Invalid Auto mode setting.');
  if (value.opencode !== undefined && (!isObject(value.opencode) || typeof value.opencode.workspace !== 'string' || !value.opencode.workspace.startsWith('/') || !['read-only', 'workspace-write', 'full'].includes(value.opencode.permission))) throw new Error('Invalid OpenCode agent settings.');
  const ids = new Set<string>();
  for (const route of value.routes) validateRoute(route, ids, false);
  const codexIds = new Set<string>();
  for (const route of value.codexRoutes || []) validateRoute(route, codexIds, true);
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
  return { version: config.version, port: config.port, routes: config.routes.map(publicRoute), codexRoutes: (config.codexRoutes || []).map(publicRoute) };
}
function publicRoute({ id, tier, ref, label, protocol, contextTokens, maxOutputTokens, tools, vision, effortOverride, displayName }: Route) {
  return { id, tier, ref, label, protocol, contextTokens, maxOutputTokens, tools, vision, ...(effortOverride ? { effortOverride } : {}), ...(displayName ? { displayName } : {}) };
}
