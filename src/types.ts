// Provider wire objects are intentionally open: native routes preserve unknown fields.
export type Wire = Record<string, any>;
export type Protocol = 'anthropic' | 'chat';
export type Tier = 'sonnet' | 'opus' | 'haiku';
export interface Route {
  id: string;
  tier: Tier;
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
}
export interface BridgeConfig {
  version: 1;
  port: number;
  token: string;
  routes: Route[];
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
