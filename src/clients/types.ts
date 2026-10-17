import type { BridgeConfig, Wire } from '../types.js';

export interface ClientDescriptor {
  id: string;
  name: string;
  description: string;
  availability: 'available' | 'planned';
  protocol: 'anthropic-messages' | 'openai-responses' | null;
  reason?: string;
}
export interface ClientStatus {
  installed: boolean; running: boolean; connected: boolean; recoveryNeeded: boolean;
  // Codex: which launch targets exist, and whether the app selection is applied.
  targets?: { cli: boolean; app: boolean }; appConnected?: boolean;
}
export interface LaunchOptions { target?: 'cli' | 'app' }
export interface DesktopClient {
  descriptor: ClientDescriptor;
  inspect(config?: BridgeConfig): Promise<ClientStatus>;
  preview(config: BridgeConfig): Promise<Wire>;
  launch(config: BridgeConfig, restart: boolean, options?: LaunchOptions): Promise<void>;
  apply?(config: BridgeConfig, restart: boolean, prepare: () => Promise<void>): Promise<void>;
  disconnect(restart: boolean): Promise<boolean>;
}
