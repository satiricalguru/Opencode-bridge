#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { inventory, makeRoute, supportedProtocol, credentials } from './opencode.js';
import { configPath, initialize, loadConfig, publicConfig } from './config.js';
import { atomicJSON, readJSON, stateDir } from './storage.js';
import { SERVICE, VERSION, startGateway } from './gateway.js';
import { activateProfile, isProfileActive, journalPath, previewProfile, restoreProfile } from './profile.js';
import { type Tier } from './types.js';
import { GatewaySupervisor, probeGateway as probe } from './runtime.js';
import { quitIfNeeded, openDesktop } from './clients/claude.js';

const supervisor = new GatewaySupervisor();
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
const help = `OpenCode Claude Bridge ${VERSION}

  models [--provider ID]                 List models and protocol support
  init --model PROVIDER/MODEL            Map all three Claude tiers to this model
       [--opus REF] [--haiku REF]        Override auxiliary tiers
       [--port 41415]                    Local gateway port
  serve                                 Run gateway in this terminal
  start                                 Run compiled gateway in the background
  status                                Show gateway/profile status
  profile                               Preview Desktop setup (no changes)
  connect --apply [--restart]            Apply recoverable profile; gateway must run
  launch [--restart]                    Start gateway, connect, and open Claude
  restore [--restart]                   Restore the captured previous connection
  stop [--restart]                      Restore if needed and stop background gateway

Environment: BRIDGE_STATE_DIR, OPENCODE_BIN, OPENCODE_AUTH_FILE,
OPENCODE_CONFIG_DIR. Keys are resolved from OpenCode or provider env at runtime.
--restart allows a graceful Desktop restart, which can interrupt active work.
`;
async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    model: { type: 'string' }, opus: { type: 'string' }, haiku: { type: 'string' },
    provider: { type: 'string' }, port: { type: 'string' }, apply: { type: 'boolean' }, restart: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  const command = positionals[0] || 'help';
  if (values.help || command === 'help') { console.log(help); return; }
  if (command === 'models') {
    const models = await inventory();
    print([...models.entries()].filter(([, m]) => !values.provider || m.providerID === values.provider).map(([ref, m]) => ({ ref, name: m.name, protocol: supportedProtocol(m) || 'unsupported', tools: m.capabilities?.toolcall, context: m.limit?.context, free: m.cost?.input === 0 && m.cost?.output === 0 })));
    return;
  }
  if (command === 'init') {
    if (!values.model) throw new Error('Specify --model PROVIDER/MODEL.');
    const models = await inventory(); const routes = [];
    for (const tier of ['sonnet', 'opus', 'haiku'] as Tier[]) routes.push(await makeRoute(tier === 'opus' ? values.opus || values.model : tier === 'haiku' ? values.haiku || values.model : values.model, tier, models));
    // Check auth without making an inference request or persisting upstream keys.
    for (const route of routes) await credentials(route);
    const config = await initialize(routes, values.port ? Number(values.port) : 41415);
    print({ configFile: configPath(), ...publicConfig(config) }); return;
  }
  if (command === 'restore') {
    if (!await readJSON(journalPath())) { print({ restored: false, reason: 'No bridge profile journal.' }); return; }
    const reopen = await quitIfNeeded(!!values.restart);
    try { print({ restored: await restoreProfile() }); } finally { if (reopen) await openDesktop(); }
    return;
  }
  const config = await loadConfig();
  if (command === 'serve') {
    const gateway = await startGateway(config, { log: record => console.log(JSON.stringify(record)) });
    print({ service: SERVICE, version: VERSION, url: gateway.url, routes: publicConfig(config).routes });
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await gateway.close(); process.exitCode = 0; };
    process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); }); return;
  }
  if (command === 'profile') { print(await previewProfile(config)); return; }
  if (command === 'status') {
    let health: unknown;
    try { health = await probe(config); } catch (err: any) { health = { ready: false, reason: err.cause?.code === 'ECONNREFUSED' ? 'Gateway not running.' : 'Gateway unavailable or mismatched.' }; }
    print({ configFile: configPath(), ...publicConfig(config), gateway: health, profileJournal: (await readJSON(journalPath()))?.state || null }); return;
  }
  if (command === 'start') { await supervisor.start(config); print({ started: true, url: `http://127.0.0.1:${config.port}` }); return; }
  if (command === 'connect' || command === 'launch') {
    if (command === 'connect' && !values.apply) { print(await previewProfile(config)); console.log('Use connect --apply to apply this profile.'); return; }
    const existing = await readJSON(journalPath());
    const alreadyConnected = existing && await isProfileActive(config);
    if (existing && !alreadyConnected) throw new Error('An incomplete or different profile journal exists. Run restore before reconnecting.');
    if (command === 'launch') await supervisor.start(config); else await probe(config);
    if (alreadyConnected) {
      if (command === 'launch') await openDesktop();
      print({ connected: true, reusedProfile: true, profile: 'OpenCode Bridge', backends: config.routes.map(r => r.ref) }); return;
    }
    const reopen = await quitIfNeeded(!!values.restart);
    try { await activateProfile(config); }
    catch (err) { if (reopen) await openDesktop(); throw err; }
    if (command === 'launch' || reopen) await openDesktop();
    print({ connected: true, profile: 'OpenCode Bridge', backends: config.routes.map(r => r.ref) }); return;
  }
  if (command === 'stop') {
    const record = await readJSON(join(stateDir(), 'gateway-process.json'));
    const health = await probe(config);
    if (!record || !Number.isSafeInteger(record.pid) || health.pid !== record.pid) throw new Error('No matching background process record. Stop a foreground server with Ctrl+C.');
    if (await readJSON(journalPath())) {
      const reopen = await quitIfNeeded(!!values.restart);
      try { await restoreProfile(); } finally { if (reopen) await openDesktop(); }
    }
    await supervisor.stop(config);
    print({ stopped: true }); return;
  }
  throw new Error(`Unknown command: ${command}. Run help.`);
}
main().catch(err => { console.error(err instanceof Error ? err.message : 'Bridge command failed.'); process.exitCode = 1; });
