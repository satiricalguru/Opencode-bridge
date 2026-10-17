import { spawn } from 'node:child_process';
import { open, access, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { SERVICE, VERSION, healthRoutes } from './gateway.js';
import { atomicJSON, readJSON, stateDir } from './storage.js';
import type { BridgeConfig } from './types.js';

export async function probeGateway(config: BridgeConfig): Promise<any> {
  const url = `http://127.0.0.1:${config.port}`;
  const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
  const health = await response.json() as any;
  if (!response.ok || health.service !== SERVICE || health.version !== VERSION) throw new Error('Port is occupied by a different or incompatible service.');
  const models = await fetch(`${url}/v1/models`, { headers: { authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(1500), redirect: 'error' });
  if (!models.ok) throw new Error('The running gateway does not match this bridge credential.');
  if (JSON.stringify(health.routes) !== JSON.stringify(healthRoutes(config))) throw new Error('Gateway routes differ from the current configuration. Stop it before changing routes.');
  return health;
}
export class GatewaySupervisor {
  constructor(private directory = stateDir(), private executable = process.execPath, private environment: NodeJS.ProcessEnv = process.env) {}
  async start(config: BridgeConfig): Promise<void> {
    try { await probeGateway(config); return; }
    catch (err: any) { if (err.cause?.code !== 'ECONNREFUSED') throw err; }
    const compiled = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
    await access(compiled).catch(() => { throw new Error('Build the gateway before starting it.'); });
    const log = await open(join(this.directory, 'gateway.log'), 'a', 0o600);
    let child;
    try {
      child = spawn(this.executable, [compiled, 'serve'], { detached: true, stdio: ['ignore', log.fd, log.fd], env: { ...this.environment, BRIDGE_STATE_DIR: this.directory } });
      await new Promise<void>((resolve, reject) => { child!.once('spawn', resolve); child!.once('error', reject); });
    } finally { await log.close(); }
    child.unref();
    await atomicJSON(join(this.directory, 'gateway-process.json'), { pid: child.pid, started: new Date().toISOString() });
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      try { await probeGateway(config); return; } catch {}
      await delay(150);
    }
    if (child.pid) { try { process.kill(child.pid, 'SIGTERM'); } catch {} }
    await unlink(join(this.directory, 'gateway-process.json')).catch(() => {});
    throw new Error('Background gateway did not become ready. Inspect gateway.log in the bridge state directory.');
  }
  async stop(config: BridgeConfig): Promise<boolean> {
    let health;
    try { health = await probeGateway(config); }
    catch (err: any) { if (err.cause?.code === 'ECONNREFUSED') { await unlink(join(this.directory, 'gateway-process.json')).catch(() => {}); return false; } throw err; }
    const record = await readJSON(join(this.directory, 'gateway-process.json'));
    if (!record || !Number.isSafeInteger(record.pid) || health.pid !== record.pid) throw new Error('No matching background process record. Stop a foreground server with Ctrl+C.');
    process.kill(record.pid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try { await probeGateway(config); } catch (err: any) {
        if (err.cause?.code === 'ECONNREFUSED') { await unlink(join(this.directory, 'gateway-process.json')).catch(() => {}); return true; }
        // Keep-alive sockets can reset while an owned process is shutting down.
        if (!['ECONNRESET', 'UND_ERR_SOCKET'].includes(err.cause?.code)) throw err;
      }
      await delay(100);
    }
    throw new Error('The background gateway did not stop. Its process record has been retained.');
  }
}
