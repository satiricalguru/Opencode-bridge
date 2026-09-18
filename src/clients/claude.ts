import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { activateProfile, isProfileActive, journalPath, previewProfile, restoreProfile } from '../profile.js';
import { readJSON, stateDir } from '../storage.js';
import type { BridgeConfig } from '../types.js';
import type { DesktopClient } from './types.js';

const exec = promisify(execFile);
export async function desktopRunning(): Promise<boolean> {
  if (process.platform !== 'darwin') throw new Error('Desktop lifecycle integration currently requires macOS.');
  try { const { stdout } = await exec('/usr/bin/pgrep', ['-f', 'Claude.app/Contents/MacOS/Claude']); return !!stdout.trim(); }
  catch (err: any) { if (err.code === 1) return false; throw err; }
}
export async function quitIfNeeded(restart: boolean): Promise<boolean> {
  const running = await desktopRunning(); if (!running) return false;
  if (!restart) throw new Error('Claude Desktop is running. Quit it first or enable “Restart Claude if needed”.');
  await exec('/usr/bin/osascript', ['-e', 'tell application "Claude" to quit']);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { if (!await desktopRunning()) return true; await delay(200); }
  throw new Error('Claude Desktop did not quit. Quit it manually; no profile change was applied.');
}
export async function openDesktop(): Promise<void> { await exec('/usr/bin/open', ['-a', 'Claude']); }

export class ClaudeClient implements DesktopClient {
  descriptor = { id: 'claude', name: 'Claude Desktop', description: 'Chat, Code & Cowork', availability: 'available' as const, protocol: 'anthropic-messages' as const };
  constructor(private directory = stateDir(), private supportRoot?: string) {}
  async inspect(config?: BridgeConfig) {
    const paths = ['/Applications/Claude.app', join(homedir(), 'Applications', 'Claude.app')];
    const installed = process.platform === 'darwin' && (await Promise.all(paths.map(p => access(p).then(() => true, () => false)))).some(Boolean);
    const journal = await readJSON(journalPath(this.directory));
    const connected = !!config && await isProfileActive(config, this.directory, this.supportRoot);
    return { installed, running: process.platform === 'darwin' ? await desktopRunning() : false, connected, recoveryNeeded: !!journal && !connected };
  }
  preview(config: BridgeConfig) { return previewProfile(config, this.supportRoot); }
  async launch(config: BridgeConfig, restart: boolean): Promise<void> {
    if (await isProfileActive(config, this.directory, this.supportRoot)) { await openDesktop(); return; }
    if (await readJSON(journalPath(this.directory))) throw new Error('An incomplete or different profile exists. Restore the previous connection before reconnecting.');
    const reopen = await quitIfNeeded(restart);
    try { await activateProfile(config, this.directory, this.supportRoot); }
    catch (err) { if (reopen) await openDesktop(); throw err; }
    await openDesktop();
  }
  async disconnect(restart: boolean): Promise<boolean> {
    if (!await readJSON(journalPath(this.directory))) return false;
    const reopen = await quitIfNeeded(restart);
    try { return await restoreProfile(this.directory); } finally { if (reopen) await openDesktop(); }
  }
}
