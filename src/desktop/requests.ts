import { isObject } from '../types.js';
import type { DesktopRequest, Selection } from './contracts.js';

function selection(value: unknown): Selection {
  if (!isObject(value) || Object.keys(value).some(k => !['model', 'opus', 'haiku'].includes(k)) || typeof value.model !== 'string' || !value.model || value.model.length > 512) throw new Error('Invalid model selection.');
  for (const key of ['opus', 'haiku']) if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 512)) throw new Error('Invalid auxiliary model selection.');
  return { model: value.model, ...(value.opus ? { opus: value.opus } : {}), ...(value.haiku ? { haiku: value.haiku } : {}) };
}
export function parseDesktopRequest(value: unknown): DesktopRequest {
  if (!isObject(value) || typeof value.action !== 'string') throw new Error('Invalid app request.');
  if (['state', 'refresh', 'stop', 'open-state'].includes(value.action)) {
    if (Object.keys(value).length !== 1) throw new Error('Unexpected app request fields.');
    return { action: value.action } as DesktopRequest;
  }
  if (!['save', 'launch', 'disconnect'].includes(value.action) || typeof value.client !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.client)) throw new Error('Invalid client action.');
  const allowed = value.action === 'disconnect' ? ['action', 'client', 'restart'] : ['action', 'client', 'selection', 'port', ...(value.action === 'launch' ? ['restart'] : [])];
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error('Unexpected app request fields.');
  if (value.action !== 'save' && typeof value.restart !== 'boolean') throw new Error('Restart preference must be explicit.');
  if (value.action === 'disconnect') return { action: 'disconnect', client: value.client, restart: value.restart };
  if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw new Error('Choose a port between 1024 and 65535.');
  const picked = selection(value.selection);
  return value.action === 'save' ? { action: 'save', client: value.client, selection: picked, port: value.port } : { action: 'launch', client: value.client, selection: picked, port: value.port, restart: value.restart };
}
