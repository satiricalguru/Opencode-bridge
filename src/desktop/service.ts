import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { atomicJSON, readJSON, stateDir, withLock } from '../storage.js';
import { configPath, loadConfig, validateConfig } from '../config.js';
import { makeRoute, credentials } from '../opencode.js';
import { journalPath } from '../profile.js';
import { probeGateway } from '../runtime.js';
import { VERSION } from '../gateway.js';
import { defaultAgentSettings } from '../agent.js';
import type { BridgeConfig, Effort, OpenCodeAgentSettings, Route, Slot } from '../types.js';
import { CLAUDE_SLOTS, routeSlot } from '../slots.js';
import type { ClientRegistry } from '../clients/registry.js';
import type { LaunchOptions } from '../clients/types.js';
import { discoverCatalog, ensureLmStudio, type Catalog } from './catalog.js';
import { readCodexNames, type CodexName } from '../clients/codex-names.js';
import { codexHome } from '../clients/codex.js';
import { ModelWatcher, type ChangeKind, type Fingerprint } from './watch.js';
import type { DesktopState, ModelItem, Preferences, Selection } from './contracts.js';

export interface GatewayControl { start(config: BridgeConfig): Promise<void>; stop(config: BridgeConfig): Promise<boolean> }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export class DesktopService {
  private catalog: Catalog = { metadata: new Map(), items: [], notices: [] };
  private mutating = false;
  get actionInProgress(): boolean { return this.mutating; }
  private watcher?: ModelWatcher;
  private loaded = false;
  constructor(private clients: ClientRegistry, private gateway: GatewayControl, private directory = stateDir(), private discover: (reuse?: Map<string, any>) => Promise<Catalog> = discoverCatalog, private probe = probeGateway, private prepareLocal: (keys: string[]) => Promise<void> = ensureLmStudio, private codexNames: () => Promise<CodexName[]> = () => readCodexNames(codexHome())) {}
  // Set by the app after a background release check.
  update?: { version: string; url: string };
  // Re-discovers when Ollama, LM Studio or OpenCode change and reports newly ready models.
  // Local-only changes reuse the cached OpenCode inventory.
  async refreshFor(kinds: ChangeKind[]): Promise<{ state: DesktopState; added: ModelItem[]; removed: ModelItem[] }> {
    const first = !this.loaded;
    const before = new Map(this.catalog.items.filter(m => m.enabled).map(m => [m.ref, m]));
    this.catalog = await this.discover(kinds.includes('opencode') ? undefined : this.catalog.openCode);
    this.loaded = true;
    // The first discovery is a baseline, not a list of new arrivals.
    if (first) return { state: await this.state(), added: [], removed: [] };
    const after = new Map(this.catalog.items.filter(m => m.enabled).map(m => [m.ref, m]));
    return { state: await this.state(), added: [...after.values()].filter(m => !before.has(m.ref)), removed: [...before.values()].filter(m => !after.has(m.ref)) };
  }
  async watch(listener: (change: { state: DesktopState; added: ModelItem[]; removed: ModelItem[] }) => void, probe?: () => Promise<Fingerprint>, interval?: number): Promise<void> {
    this.watcher?.stop();
    this.watcher = new ModelWatcher(async kinds => {
      // Never swap the catalog underneath a connection action; the next tick retries.
      if (this.mutating) throw new Error('busy');
      listener(await this.refreshFor(kinds));
    }, probe, interval);
    await this.watcher.start();
  }
  unwatch(): void { this.watcher?.stop(); }
  private async prepare(config: BridgeConfig): Promise<void> {
    const keys = [...config.routes, ...(config.codexRoutes || [])].filter(r => r.ref.startsWith('lmstudio/')).map(r => r.ref.slice('lmstudio/'.length));
    await this.prepareLocal(keys);
  }
  private async config(): Promise<BridgeConfig | undefined> {
    if (!await readJSON(configPath(this.directory))) return undefined;
    return loadConfig(this.directory);
  }
  private async preferences(): Promise<Preferences> {
    const saved = await readJSON(join(this.directory, 'preferences.json'));
    const config = await this.config();
    const effort = (routes: Route[]) => Object.fromEntries(routes.filter(r => r.effortOverride).map(r => [routeSlot(r), r.effortOverride]));
    const fromConfig: Record<string, Selection> = {};
    if (config?.routes.length) {
      const primary = config.routes.find(r => routeSlot(r) === 'sonnet') || config.routes[0];
      fromConfig.claude = { model: primary.ref, ...Object.fromEntries(config.routes.filter(r => routeSlot(r) !== 'sonnet').map(r => [routeSlot(r), r.ref])), autoMode: config.autoMode === true, ...(Object.keys(effort(config.routes)).length ? { effort: effort(config.routes) } : {}) };
    }
    if (config?.codexRoutes?.length) {
      const [primary, ...rest] = config.codexRoutes;
      const names = Object.fromEntries(rest.filter(r => r.ref !== primary.ref).map(r => [r.id, r.ref]));
      const nameEffort = Object.fromEntries(rest.filter(r => r.effortOverride).map(r => [r.id, r.effortOverride!])) as Record<string, Effort>;
      fromConfig.codex = { model: primary.ref, ...(primary.displayName ? { primary: primary.id } : {}), ...(Object.keys(names).length ? { names } : {}), ...(Object.keys(nameEffort).length ? { nameEffort } : {}), ...(primary.effortOverride ? { effort: { sonnet: primary.effortOverride } } : {}) };
    }
    return { version: 1, selectedClient: saved?.selectedClient || 'claude', selections: { ...fromConfig, ...saved?.selections }, port: saved?.port || config?.port || 41415, agent: saved?.agent || config?.opencode || defaultAgentSettings() };
  }
  async refresh(): Promise<DesktopState> { this.catalog = await this.discover(); this.loaded = true; return this.state(); }
  async state(): Promise<DesktopState> {
    const config = await this.config();
    const preferences = await this.preferences();
    let health: any;
    if (config) { try { health = await this.probe(config); } catch {} }
    const clients = await Promise.all(this.clients.descriptors().map(async descriptor => descriptor.availability === 'available' ? { ...descriptor, status: await this.clients.get(descriptor.id).inspect(config) } : descriptor));
    const summary = (r: Route) => ({ id: r.id, tier: r.tier, slot: routeSlot(r), ref: r.ref, label: r.label, protocol: r.protocol, ...(r.effortOverride ? { effort: r.effortOverride } : {}), ...(r.displayName ? { displayName: r.displayName } : {}) });
    const codexNames = await this.codexNames();
    return { version: VERSION, models: this.catalog.items, notices: this.catalog.notices, preferences, clients, gateway: { ready: !!health, active: health?.active || 0, routed: health?.routed || 0, port: config?.port || preferences.port }, savedRoutes: config?.routes.map(summary) || [], codexRoutes: config?.codexRoutes?.map(summary) || [], codexNames, ...(this.update ? { update: this.update } : {}) };
  }
  private refsOf(clientId: string, selection: Selection): string[] {
    return clientId === 'codex' ? [selection.model, ...Object.values(selection.names || {})] : [selection.model, selection.opus, selection.haiku, selection.fable, selection.sonnet46].filter((ref): ref is string => !!ref);
  }
  private validate(client: string, selection: Selection, port: number): void {
    this.clients.get(client);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535.');
    if (!selection.model) throw new Error('Choose a primary model.');
    for (const ref of this.refsOf(client, selection)) {
      const item = this.catalog.items.find(m => m.ref === ref);
      if (!item?.enabled) throw new Error(item?.reason || 'Choose an available model from the current list.');
    }
    if (selection.autoMode !== undefined && typeof selection.autoMode !== 'boolean') throw new Error('Auto mode must be boolean.');
  }
  private refs(selection: Selection): Record<Slot, string> {
    return { sonnet: selection.model, opus: selection.opus || selection.model, haiku: selection.haiku || selection.model, fable: selection.fable || selection.model, sonnet46: selection.sonnet46 || selection.model };
  }
  private async route(ref: string, slot: Slot | 'codex', effort?: Effort): Promise<Route> {
    const item = this.catalog.items.find(m => m.ref === ref);
    // A pinned level must be one the backend advertises; otherwise follow the client.
    const pinned = effort && item?.efforts.includes(effort) ? effort : undefined;
    const route = await makeRoute(ref, slot, this.catalog.metadata, { via: item?.via, effort: pinned });
    await credentials(route);
    return route;
  }
  // Each client owns its own routes; changing one never rewrites the other's.
  private async build(clientId: string, selection: Selection, port: number, previous?: BridgeConfig, agent?: OpenCodeAgentSettings): Promise<BridgeConfig> {
    const base: BridgeConfig = previous ? { ...previous, port } : { version: 1, token: randomBytes(32).toString('hex'), port, routes: [] };
    if (clientId === 'codex') {
      // Codex keeps its own names; each is answered by the chosen backend. The default
      // name comes first: it becomes Codex's selected model.
      const names = await this.codexNames();
      const primary = names.find(n => n.slug === selection.primary) || names[0];
      const ordered = [primary, ...names.filter(n => n.slug !== primary.slug)];
      base.codexRoutes = await Promise.all(ordered.map(async name => {
        const own = name.slug === primary.slug;
        const ref = own ? selection.model : selection.names?.[name.slug] || selection.model;
        const effort = own ? selection.effort?.sonnet : selection.nameEffort?.[name.slug] ?? (ref === selection.model ? selection.effort?.sonnet : undefined);
        return { ...await this.route(ref, 'codex', effort), id: name.slug, displayName: name.label };
      }));
    }
    else {
      const refs = this.refs(selection);
      base.routes = await Promise.all(CLAUDE_SLOTS.map(slot => this.route(refs[slot.key], slot.key, selection.effort?.[slot.key])));
      base.autoMode = selection.autoMode === true;
    }
    base.opencode = agent || (await this.preferences()).agent;
    validateConfig(base); return base;
  }
  private async assertIdle(config?: BridgeConfig): Promise<void> {
    if (!config) return;
    try { if ((await this.probe(config)).active) throw new Error('A connected app has an active request. Wait for it to finish before changing or disconnecting the connection.'); }
    catch (error: any) { if (error.cause?.code !== 'ECONNREFUSED') throw error; }
  }
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.mutating) throw new Error('Another connection action is in progress.');
    this.mutating = true; try { return await fn(); } finally { this.mutating = false; }
  }
  private async claudeConnected(): Promise<boolean> { return !!await readJSON(journalPath(this.directory)); }
  private async otherClientsConnected(except: string, config?: BridgeConfig): Promise<boolean> {
    for (const descriptor of this.clients.descriptors()) {
      if (descriptor.id === except || descriptor.availability !== 'available') continue;
      const status = await this.clients.get(descriptor.id).inspect(config);
      if (status.connected || status.recoveryNeeded) return true;
    }
    return false;
  }
  private async savePreferences(clientId: string, selection: Selection, port: number): Promise<void> {
    const prefs = await this.preferences();
    await atomicJSON(join(this.directory, 'preferences.json'), { ...prefs, selectedClient: clientId, port, selections: { ...prefs.selections, [clientId]: selection } });
  }
  // Swaps the running gateway for one serving the new configuration.
  private async replace(previous: BridgeConfig | undefined, config: BridgeConfig): Promise<void> {
    if (previous) await this.gateway.stop(previous);
    await withLock(this.directory, async () => { await atomicJSON(configPath(this.directory), config); });
  }
  async save(client: string, selection: Selection, port: number): Promise<DesktopState> {
    return this.exclusive(async () => {
      this.validate(client, selection, port);
      const config = await this.config();
      if (await this.claudeConnected() && (client === 'claude' || port !== config?.port)) throw new Error('Restore the current connection before changing models or the gateway port.');
      await this.savePreferences(client, selection, port);
      return this.state();
    });
  }
  async launch(clientId: string, selection: Selection, port: number, restart: boolean, options: LaunchOptions = {}): Promise<DesktopState> {
    return this.exclusive(async () => {
      this.validate(clientId, selection, port);
      const client = this.clients.get(clientId);
      const previous = await this.config();
      const status = await client.inspect(previous);
      if (!status.installed) throw new Error(`${client.descriptor.name} is not installed.`);
      if (status.recoveryNeeded) throw new Error('Restore the previous connection before launching again.');
      const claudeJournal = await this.claudeConnected();
      if (claudeJournal && previous && port !== previous.port) throw new Error('Disconnect Claude before changing the gateway port.');
      if (clientId === 'claude' && status.running && !status.connected && !restart) throw new Error('Claude is running. Quit it first or enable “Restart Claude if needed”.');
      const desired = await this.build(clientId, selection, port, previous);
      const unchanged = !!previous && same(previous, desired);
      if (!unchanged && clientId === 'claude' && claudeJournal) throw new Error('Disconnect before changing a connected model or gateway port.');
      if (!unchanged) { await this.assertIdle(previous); await this.replace(previous, desired); }
      await this.savePreferences(clientId, selection, port);
      await this.prepare(desired);
      await this.gateway.start(desired);
      try {
        await client.launch(desired, restart, options);
      } catch (err) {
        if (!await this.otherClientsConnected(clientId, desired) && !(clientId !== 'claude' && claudeJournal)) await this.gateway.stop(desired).catch(() => {});
        throw err;
      }
      return this.state();
    });
  }
  async disconnect(clientId: string, restart: boolean): Promise<DesktopState> {
    return this.exclusive(async () => {
      const config = await this.config(); await this.assertIdle(config);
      await this.clients.get(clientId).disconnect(restart);
      // The gateway keeps running while another app still uses it.
      if (config && !await this.otherClientsConnected(clientId, config)) await this.gateway.stop(config);
      return this.state();
    });
  }
  async apply(clientId: string, selection: Selection, port: number, restart: boolean): Promise<DesktopState> {
    return this.exclusive(async () => {
      if (!restart) throw new Error('Applying model mappings requires an explicit app restart.');
      this.validate(clientId, selection, port);
      const client = this.clients.get(clientId);
      if (!client.apply) throw new Error('This application does not support model configuration yet.');
      const previous = await this.config();
      if (!(await client.inspect(previous)).installed) throw new Error(`${client.descriptor.name} is not installed.`);
      if (clientId !== 'claude' && await this.claudeConnected() && previous && port !== previous.port) throw new Error('Disconnect Claude before changing the gateway port.');
      const config = await this.build(clientId, selection, port, previous);
      await this.assertIdle(previous);
      await this.prepare(config);
      let startedNewGateway = false;
      try {
        await client.apply(config, restart, async () => {
          await this.replace(previous, config);
          await this.gateway.start(config);
          startedNewGateway = true;
        });
      } catch (err) {
        if (startedNewGateway) await this.gateway.stop(config).catch(() => {});
        throw err;
      }
      await this.savePreferences(clientId, selection, port);
      return this.state();
    });
  }
  async settings(agent: OpenCodeAgentSettings): Promise<DesktopState> {
    return this.exclusive(async () => {
      const prefs = await this.preferences();
      await atomicJSON(join(this.directory, 'preferences.json'), { ...prefs, agent });
      const previous = await this.config();
      if (previous && !same(previous.opencode, agent)) {
        const config = { ...previous, opencode: agent }; validateConfig(config);
        let running = false;
        try { await this.probe(previous); running = true; } catch {}
        if (running) { await this.assertIdle(previous); await this.replace(previous, config); await this.gateway.start(config); }
        else await withLock(this.directory, async () => { await atomicJSON(configPath(this.directory), config); });
      }
      return this.state();
    });
  }
  async stop(): Promise<DesktopState> {
    return this.exclusive(async () => {
      const config = await this.config();
      if (await this.claudeConnected()) throw new Error('Restore your Desktop connection before stopping the gateway.');
      if (await this.otherClientsConnected('claude', config)) throw new Error('Disconnect Codex before stopping the gateway.');
      if (config) await this.gateway.stop(config);
      return this.state();
    });
  }
}
