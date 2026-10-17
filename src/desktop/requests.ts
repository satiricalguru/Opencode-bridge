import { isObject } from '../types.js';
import { EFFORTS } from '../effort.js';
import type { DesktopRequest, Selection } from './contracts.js';

function selection(value: unknown): Selection {
  if (!isObject(value) || Object.keys(value).some(k => !['model', 'opus', 'haiku', 'fable', 'sonnet46', 'autoMode', 'effort'].includes(k)) || typeof value.model !== 'string' || !value.model || value.model.length > 512) throw new Error('Invalid model selection.');
  if (value.effort !== undefined && (!isObject(value.effort) || Object.entries(value.effort).some(([slot, level]) => !['sonnet', 'opus', 'haiku', 'fable', 'sonnet46'].includes(slot) || !EFFORTS.includes(level as any)))) throw new Error('Invalid effort selection.');
  for (const key of ['opus', 'haiku', 'fable', 'sonnet46']) if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 512)) throw new Error('Invalid auxiliary model selection.');
  if (value.autoMode !== undefined && typeof value.autoMode !== 'boolean') throw new Error('Auto mode preference must be boolean.');
  return { model: value.model, ...Object.fromEntries(['opus', 'haiku', 'fable', 'sonnet46'].filter(key => value[key]).map(key => [key, value[key]])), ...(value.autoMode !== undefined ? { autoMode: value.autoMode } : {}), ...(value.effort && Object.keys(value.effort).length ? { effort: { ...value.effort } } : {}) };
}
export function parseDesktopRequest(value: unknown): DesktopRequest {
  if (!isObject(value) || typeof value.action !== 'string') throw new Error('Invalid app request.');
  if (value.action === 'settings') {
    const agent = value.agent;
    if (Object.keys(value).length !== 2 || !isObject(agent) || Object.keys(agent).some(k => !['workspace', 'permission'].includes(k)) || typeof agent.workspace !== 'string' || !agent.workspace.startsWith('/') || agent.workspace.length > 1024 || agent.workspace.includes('\0') || !['read-only', 'workspace-write', 'full'].includes(agent.permission)) throw new Error('Invalid OpenCode agent settings.');
    return { action: 'settings', agent: { workspace: agent.workspace, permission: agent.permission } };
  }
  if (value.action === 'theme') {
    if (Object.keys(value).length !== 2 || !['system', 'light', 'dark'].includes(value.theme)) throw new Error('Invalid theme.');
    return { action: 'theme', theme: value.theme };
  }
  if (['state', 'refresh', 'stop', 'open-state'].includes(value.action)) {
    if (Object.keys(value).length !== 1) throw new Error('Unexpected app request fields.');
    return { action: value.action } as DesktopRequest;
  }
  if (!['save', 'launch', 'apply', 'disconnect', 'disconnect-quit'].includes(value.action) || typeof value.client !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.client)) throw new Error('Invalid client action.');
  const disconnecting = value.action === 'disconnect' || value.action === 'disconnect-quit';
  const allowed = disconnecting ? ['action', 'client', 'restart'] : ['action', 'client', 'selection', 'port', ...(value.action !== 'save' ? ['restart'] : []), ...(value.action === 'launch' ? ['target'] : [])];
  if (value.target !== undefined && !['cli', 'app'].includes(value.target)) throw new Error('Invalid launch target.');
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error('Unexpected app request fields.');
  if (value.action !== 'save' && typeof value.restart !== 'boolean') throw new Error('Restart preference must be explicit.');
  if (disconnecting) return { action: value.action, client: value.client, restart: value.restart } as DesktopRequest;
  if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw new Error('Choose a port between 1024 and 65535.');
  const picked = selection(value.selection);
  return value.action === 'save' ? { action: 'save', client: value.client, selection: picked, port: value.port } : { action: value.action, client: value.client, selection: picked, port: value.port, restart: value.restart, ...(value.target ? { target: value.target } : {}) } as DesktopRequest;
}
