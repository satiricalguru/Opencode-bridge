import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { atomicJSON, readJSON, stateDir, withLock } from '../storage.js';
import { configPath, loadConfig, validateConfig } from '../config.js';
import { makeRoute, credentials } from '../opencode.js';
import { journalPath } from '../profile.js';
import { probeGateway } from '../runtime.js';
import { VERSION } from '../gateway.js';
import type { BridgeConfig, Slot } from '../types.js';
import { CLAUDE_SLOTS, routeSlot } from '../slots.js';
import type { ClientRegistry } from '../clients/registry.js';
import { discoverCatalog, type Catalog } from './catalog.js';
import type { DesktopState, Preferences, Selection } from './contracts.js';

export interface GatewayControl { start(config: BridgeConfig): Promise<void>; stop(config: BridgeConfig): Promise<boolean> }
export class DesktopService {
  private catalog: Catalog = { metadata: new Map(), items: [], notices: [] };
  private mutating = false;
  get actionInProgress(): boolean { return this.mutating; }
  constructor(private clients: ClientRegistry, private gateway: GatewayControl, private directory = stateDir(), private discover = discoverCatalog, private probe = probeGateway) {}
  private async config(): Promise<BridgeConfig | undefined> {
    if (!await readJSON(configPath(this.directory))) return undefined;
    return loadConfig(this.directory);
  }
  private async preferences(): Promise<Preferences> {
    const saved = await readJSON(join(this.directory, 'preferences.json'));
    const config = await this.config();
    return { version: 1, selectedClient: saved?.selectedClient || 'claude', selections: saved?.selections || (config ? { claude: { model: config.routes.find(r => routeSlot(r) === 'sonnet')!.ref, ...Object.fromEntries(config.routes.filter(r => routeSlot(r) !== 'sonnet').map(r => [routeSlot(r), r.ref])), autoMode: config.autoMode === true } } : {}), port: saved?.port || config?.port || 41415 };
  }
  async refresh(): Promise<DesktopState> { this.catalog = await this.discover(); return this.state(); }
  async state(): Promise<DesktopState> {
    const config = await this.config();
    const preferences = await this.preferences();
    let health: any;
    if (config) { try { health = await this.probe(config); } catch {} }
    const clients = await Promise.all(this.clients.descriptors().map(async descriptor => descriptor.availability === 'available' ? { ...descriptor, status: await this.clients.get(descriptor.id).inspect(config) } : descriptor));
    return { version: VERSION, models: this.catalog.items, notices: this.catalog.notices, preferences, clients, gateway: { ready: !!health, active: health?.active || 0, routed: health?.routed || 0, port: config?.port || preferences.port }, savedRoutes: config?.routes.map(r => ({ tier: r.tier, slot: routeSlot(r), ref: r.ref, label: r.label })) || [] };
  }
  private validate(client: string, selection: Selection, port: number): void {
    this.clients.get(client);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535.');
    for (const ref of [selection.model, selection.opus, selection.haiku, selection.fable, selection.sonnet46].filter(Boolean)) {
      const item = this.catalog.items.find(m => m.ref === ref);
      if (!item?.enabled) throw new Error(item?.reason || 'Choose an available model from the current list.');
    }
    if (!selection.model) throw new Error('Choose a primary model.');
    if (selection.autoMode !== undefined && typeof selection.autoMode !== 'boolean') throw new Error('Auto mode must be boolean.');
  }
  private refs(selection: Selection): Record<Slot, string> {
    return { sonnet: selection.model, opus: selection.opus || selection.model, haiku: selection.haiku || selection.model, fable: selection.fable || selection.model, sonnet46: selection.sonnet46 || selection.model };
  }
  private async build(selection: Selection, port: number, previous?: BridgeConfig): Promise<BridgeConfig> {
    const refs = this.refs(selection);
    const routes = await Promise.all(CLAUDE_SLOTS.map(slot => makeRoute(refs[slot.key], slot.key, this.catalog.metadata)));
    for (const route of routes) await credentials(route);
    const config: BridgeConfig = { version: 1, token: previous?.token || randomBytes(32).toString('hex'), port, routes, autoMode: selection.autoMode === true };
    validateConfig(config); return config;
  }
  private async assertIdle(config?: BridgeConfig): Promise<void> {
    if (!config) return;
    try { if ((await this.probe(config)).active) throw new Error('Claude has an active request. Wait for it to finish before changing or disconnecting the connection.'); }
    catch (error: any) { if (error.cause?.code !== 'ECONNREFUSED') throw error; }
  }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.mutating) throw new Error('Another connection action is in progress.');
    this.mutating = true; try { return await fn(); } finally { this.mutating = false; }
  }
  async save(client: string, selection: Selection, port: number): Promise<DesktopState> {
    return this.exclusive(async () => {
      this.validate(client, selection, port);
      if (await readJSON(journalPath(this.directory))) throw new Error('Restore the current connection before changing models or the gateway port.');
      const prefs = await this.preferences();
      await atomicJSON(join(this.directory, 'preferences.json'), { ...prefs, selectedClient: client, port, selections: { ...prefs.selections, [client]: selection } });
      return this.state();
    });
  }
  async launch(clientId: string, selection: Selection, port: number, restart: boolean): Promise<DesktopState> {
    return this.exclusive(async () => {
      this.validate(clientId, selection, port);
      const client = this.clients.get(clientId);
      const previous = await this.config();
      const status = await client.inspect(previous);
      if (!status.installed) throw new Error(`${client.descriptor.name} is not installed in Applications.`);
      if (status.recoveryNeeded) throw new Error('Restore the previous connection before launching again.');
      const refs = this.refs(selection);
      const unchanged = previous && previous.port === port && previous.routes.length === CLAUDE_SLOTS.length && previous.routes.every(r => refs[routeSlot(r)] === r.ref) && (previous.autoMode === true) === (selection.autoMode === true);
      const journal = await readJSON(journalPath(this.directory));
      if (journal && !unchanged) throw new Error('Disconnect before changing a connected model or gateway port.');
      if (status.running && !status.connected && !restart) throw new Error('Claude is running. Quit it first or enable “Restart Claude if needed”.');
      let config = previous;
      if (!unchanged) {
        config = await this.build(selection, port, previous);
        if (previous) await this.gateway.stop(previous);
        await withLock(this.directory, async () => {
          if (await readJSON(journalPath(this.directory))) throw new Error('A connection was changed by another process. Refresh before continuing.');
          await atomicJSON(configPath(this.directory), config);
        });
      }
      if (!config) throw new Error('No gateway configuration is available.');
      const prefs = await this.preferences();
      await atomicJSON(join(this.directory, 'preferences.json'), { ...prefs, selectedClient: clientId, port, selections: { ...prefs.selections, [clientId]: selection } });
      await this.gateway.start(config);
      await client.launch(config, restart);
      return this.state();
    });
  }
  async disconnect(clientId: string, restart: boolean): Promise<DesktopState> {
    return this.exclusive(async () => {
      const config = await this.config(); await this.assertIdle(config);
      await this.clients.get(clientId).disconnect(restart);
      if (config) await this.gateway.stop(config);
      return this.state();
    });
  }
  async apply(clientId: string, selection: Selection, port: number, restart: boolean): Promise<DesktopState> {
    return this.exclusive(async () => {
      if (!restart) throw new Error('Applying model mappings requires an explicit Claude restart.');
      this.validate(clientId, selection, port);
      const client = this.clients.get(clientId);
      if (!client.apply) throw new Error('This application does not support model configuration yet.');
      const previous = await this.config();
      if (!(await client.inspect(previous)).installed) throw new Error(`${client.descriptor.name} is not installed in Applications.`);
      const config = await this.build(selection, port, previous);
      await this.assertIdle(previous);
      await client.apply(config, restart, async () => {
        if (previous) await this.gateway.stop(previous);
        await withLock(this.directory, async () => {
          if (await readJSON(journalPath(this.directory))) throw new Error('The connection changed in another process. Refresh before applying models.');
          await atomicJSON(configPath(this.directory), config);
        });
        await this.gateway.start(config);
      });
      const prefs = await this.preferences();
      await atomicJSON(join(this.directory, 'preferences.json'), { ...prefs, selectedClient: clientId, port, selections: { ...prefs.selections, [clientId]: selection } });
      return this.state();
    });
  }
  async stop(): Promise<DesktopState> {
    return this.exclusive(async () => {
      if (await readJSON(journalPath(this.directory))) throw new Error('Restore your Desktop connection before stopping the gateway.');
      const config = await this.config(); if (config) await this.gateway.stop(config);
      return this.state();
    });
  }
}
