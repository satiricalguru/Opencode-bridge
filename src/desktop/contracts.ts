import type { ClientDescriptor, ClientStatus } from '../clients/types.js';
import type { Slot, Tier } from '../types.js';

export interface ModelItem {
  ref: string; name: string; provider: string; source: 'opencode' | 'ollama';
  protocol: 'anthropic' | 'chat' | 'unsupported'; tools: boolean; vision: boolean;
  context: number; free: boolean; enabled: boolean; reason?: string;
}
export interface Selection { model: string; opus?: string; haiku?: string; fable?: string; sonnet46?: string; autoMode?: boolean }
export interface Preferences { version: 1; selectedClient: string; selections: Record<string, Selection>; port: number }
export interface DesktopState {
  version: string; models: ModelItem[]; notices: string[]; preferences: Preferences;
  clients: Array<ClientDescriptor & { status?: ClientStatus }>;
  gateway: { ready: boolean; active: number; routed: number; port: number };
  savedRoutes: Array<{ tier: Tier; slot: Slot; ref: string; label: string }>;
}
export type DesktopRequest =
  | { action: 'state' | 'refresh' }
  | { action: 'save'; client: string; selection: Selection; port: number }
  | { action: 'launch'; client: string; selection: Selection; port: number; restart: boolean }
  | { action: 'apply'; client: string; selection: Selection; port: number; restart: boolean }
  | { action: 'disconnect' | 'disconnect-quit'; client: string; restart: boolean }
  | { action: 'stop' }
  | { action: 'open-state' };
export type DesktopResponse = { ok: true; state: DesktopState } | { ok: false; error: string };
export interface DesktopAPI { request(value: DesktopRequest): Promise<DesktopResponse> }
