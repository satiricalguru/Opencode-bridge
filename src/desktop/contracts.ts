import type { ClientDescriptor, ClientStatus } from '../clients/types.js';
import type { Effort, OpenCodeAgentSettings, Slot, Tier } from '../types.js';

export interface ModelItem {
  ref: string; name: string; provider: string; source: 'opencode' | 'ollama' | 'lmstudio';
  protocol: 'anthropic' | 'chat' | 'opencode' | 'unsupported'; via: 'direct' | 'agent'; efforts: Effort[];
  tools: boolean; vision: boolean; context: number; free: boolean; enabled: boolean; reason?: string;
}
export interface Selection {
  model: string; opus?: string; haiku?: string; fable?: string; sonnet46?: string; autoMode?: boolean; effort?: Partial<Record<Slot, Effort>>;
  // Codex: `model` answers the default Codex name; `names` maps other Codex names to backends.
  primary?: string; names?: Record<string, string>; nameEffort?: Record<string, Effort>;
}
export interface CodexNameItem { slug: string; label: string }
export interface Preferences { version: 1; selectedClient: string; selections: Record<string, Selection>; port: number; agent: OpenCodeAgentSettings }
export interface SavedRoute { tier: Tier; slot: Slot; ref: string; label: string; protocol: string; effort?: Effort; id: string; displayName?: string }
export interface DesktopState {
  version: string; models: ModelItem[]; notices: string[]; preferences: Preferences;
  clients: Array<ClientDescriptor & { status?: ClientStatus }>;
  gateway: { ready: boolean; active: number; routed: number; port: number };
  savedRoutes: SavedRoute[]; codexRoutes: SavedRoute[]; codexNames: CodexNameItem[];
  update?: { version: string; url: string };
}
export type DesktopRequest =
  | { action: 'state' | 'refresh' }
  | { action: 'save'; client: string; selection: Selection; port: number }
  | { action: 'launch'; client: string; selection: Selection; port: number; restart: boolean; target?: 'cli' | 'app' }
  | { action: 'apply'; client: string; selection: Selection; port: number; restart: boolean }
  | { action: 'disconnect' | 'disconnect-quit'; client: string; restart: boolean }
  | { action: 'stop' }
  | { action: 'settings'; agent: OpenCodeAgentSettings }
  | { action: 'theme'; theme: 'system' | 'light' | 'dark' }
  | { action: 'open-release' | 'copy-codex-command' }
  | { action: 'open-state' };
export type DesktopResponse = { ok: true; state: DesktopState } | { ok: false; error: string };
export interface ModelChange { state: DesktopState; added: Array<Pick<ModelItem, 'ref' | 'name' | 'provider' | 'source'>>; removed: Array<Pick<ModelItem, 'ref' | 'name' | 'provider' | 'source'>> }
export interface DesktopAPI { request(value: DesktopRequest): Promise<DesktopResponse>; onChange(listener: (change: ModelChange) => void): () => void }
