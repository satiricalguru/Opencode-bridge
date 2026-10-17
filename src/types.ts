// Provider wire objects are intentionally open: native routes preserve unknown fields.
export type Wire = Record<string, any>;
// opencode: inference runs inside a bridge-owned `opencode serve` agent session.
export type Protocol = 'anthropic' | 'chat' | 'opencode';
export type Tier = 'sonnet' | 'opus' | 'haiku' | 'fable';
export type Slot = Tier | 'sonnet46';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface EffortCapability { mode: 'native' | 'chat' | 'opencode'; levels: Effort[] }
export type AgentPermission = 'read-only' | 'workspace-write' | 'full';
export interface Route {
  id: string;
  tier: Tier;
  slot?: Slot;
  ref: string;
  label: string;
  protocol: Protocol;
  baseURL: string;
  model: string;
  auth: { provider?: string; env?: string; none?: boolean };
  headers?: Record<string, string>;
  options?: Wire;
  contextTokens: number;
  maxOutputTokens: number;
  inputTokens?: number;
  vision: boolean;
  tools: boolean;
  reasoningField?: string;
  effort?: EffortCapability;
  // User-pinned effort. Overrides the level requested by the client.
  effortOverride?: Effort;
}
export interface OpenCodeAgentSettings { workspace: string; permission: AgentPermission }
export interface BridgeConfig {
  version: 1;
  port: number;
  token: string;
  routes: Route[];
  // Routes reachable by Codex (OpenAI Responses). Never advertised to Claude.
  codexRoutes?: Route[];
  autoMode?: boolean;
  opencode?: OpenCodeAgentSettings;
}
export class BridgeError extends Error {
  constructor(public status: number, public type: string, message: string) {
    super(message);
  }
}
export function invalid(message: string): never {
  throw new BridgeError(400, 'invalid_request_error', message);
}
export function isObject(value: unknown): value is Wire {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
