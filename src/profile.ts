import { join } from 'node:path';
import { homedir } from 'node:os';
import { unlink } from 'node:fs/promises';
import { atomicJSON, readJSON, stateDir, withLock } from './storage.js';
import { modelCatalog } from './gateway.js';
import { type BridgeConfig, type Wire } from './types.js';

export const PROFILE_ID = '58971f0b-7944-4c2a-8d49-3039f2bd104b';
export const PROFILE_NAME = 'OpenCode Bridge';
interface Change { path: string; key: string; exists: boolean; before?: unknown; after: unknown; kind?: 'entries'; entriesExisted?: boolean }
interface Journal { version: 1; state: 'pending' | 'active'; changes: Change[]; created: string[] }
export const journalPath = (dir = stateDir()) => join(dir, 'profile-journal.json');
const equals = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const supportRoot = () => join(homedir(), 'Library', 'Application Support');
export async function profileChanges(config: BridgeConfig, root = supportRoot()): Promise<Journal> {
  const profile = join(root, 'Claude-3p', 'configLibrary', `${PROFILE_ID}.json`);
  const meta = join(root, 'Claude-3p', 'configLibrary', '_meta.json');
  const values: Record<string, Wire> = {
    [profile]: {
      inferenceProvider: 'gateway', inferenceGatewayBaseUrl: `http://127.0.0.1:${config.port}`,
      inferenceGatewayApiKey: config.token, inferenceGatewayAuthScheme: 'bearer',
      deploymentDisplayName: PROFILE_NAME, chatTabEnabled: true, coworkTabEnabled: true,
      isClaudeCodeForDesktopEnabled: true, disableDeploymentModeChooser: true,
      disableEssentialTelemetry: true, disableNonessentialTelemetry: true,
      autoModeEnabled: false, modelCatalogEnabled: false, inferenceModelPricingEnabled: false,
      inferenceModels: modelCatalog(config).data.map((m: Wire) => ({ name: m.id, labelOverride: m.display_name, anthropicFamilyTier: m.anthropic_family_tier, isFamilyDefault: true, maxEffort: 'low' })),
    },
    [meta]: { appliedId: PROFILE_ID },
    [join(root, 'Claude-3p', 'claude_desktop_config.json')]: { deploymentMode: '3p' },
    [join(root, 'Claude', 'claude_desktop_config.json')]: { deploymentMode: '3p' },
  };
  const changes: Change[] = []; const created: string[] = [];
  for (const [path, desired] of Object.entries(values)) {
    const existing = await readJSON(path); if (!existing) created.push(path);
    const before = existing || {};
    for (const [key, after] of Object.entries(desired)) changes.push({ path, key, exists: Object.hasOwn(before, key), before: before[key], after });
    if (path === meta) {
      const entries: Wire[] = before.entries || [];
      if (!Array.isArray(entries)) throw new Error('Desktop profile entries are not an array.');
      const previous = entries.find(e => e.id === PROFILE_ID);
      changes.push({ path, key: 'entries', kind: 'entries', exists: !!previous, before: previous, after: { id: PROFILE_ID, name: PROFILE_NAME }, entriesExisted: Object.hasOwn(before, 'entries') });
    }
  }
  return { version: 1, state: 'pending', changes, created };
}
export async function previewProfile(config: BridgeConfig, root?: string): Promise<Wire> {
  const journal = await profileChanges(config, root);
  return { profile: PROFILE_NAME, files: [...new Set(journal.changes.map(c => c.path))], gateway: `http://127.0.0.1:${config.port}`, models: config.routes.map(r => ({ id: r.id, backend: r.ref })), previous: journal.changes.filter(c => c.key === 'appliedId' || c.key === 'deploymentMode').map(c => ({ file: c.path, key: c.key, value: c.before ?? null })) };
}
export async function isProfileActive(config: BridgeConfig, dir = stateDir(), root?: string): Promise<boolean> {
  const journal = await readJSON(journalPath(dir));
  if (!journal || journal.version !== 1 || journal.state !== 'active' || !Array.isArray(journal.changes)) return false;
  const desired = await profileChanges(config, root);
  for (const change of desired.changes) {
    const saved = journal.changes.find((c: Change) => c.path === change.path && c.key === change.key);
    if (!saved || !equals(saved.after, change.after)) return false;
    const doc = await readJSON(change.path) || {};
    const current = change.kind === 'entries' ? (doc.entries || []).find((e: Wire) => e.id === PROFILE_ID) : doc[change.key];
    if (!equals(current, change.after)) return false;
  }
  return true;
}
async function applyJournal(journal: Journal): Promise<void> {
  for (const path of [...new Set(journal.changes.map(c => c.path))]) {
    const doc = await readJSON(path) || {};
    for (const change of journal.changes.filter(c => c.path === path)) {
      if (change.kind === 'entries') doc.entries = [...(doc.entries || []).filter((e: Wire) => e.id !== PROFILE_ID), change.after];
      else doc[change.key] = change.after;
    }
    await atomicJSON(path, doc);
  }
}
async function restoreJournal(journal: Journal): Promise<void> {
  const documents = new Map<string, Wire>();
  // Preflight all conflicts before changing any file. Keep unrelated fields/entries.
  for (const change of journal.changes) {
    if (!documents.has(change.path)) documents.set(change.path, await readJSON(change.path) || {});
    const doc = documents.get(change.path)!;
    const current = change.kind === 'entries' ? (doc.entries || []).find((e: Wire) => e.id === PROFILE_ID) : doc[change.key];
    const prior = change.exists ? change.before : undefined;
    if (!equals(current, change.after) && !equals(current, prior)) throw new Error(`Restore conflict in ${change.path} (${change.key}). The value was changed externally; the recovery journal has been retained.`);
  }
  for (const change of [...journal.changes].reverse()) {
    const doc = documents.get(change.path)!;
    if (change.kind === 'entries') {
      const kept = (doc.entries || []).filter((e: Wire) => e.id !== PROFILE_ID);
      if (change.exists) kept.push(change.before);
      if (!kept.length && !change.entriesExisted) delete doc.entries;
      else doc.entries = kept;
    } else if (change.exists) doc[change.key] = change.before;
    else delete doc[change.key];
  }
  for (const [path, doc] of documents) {
    if (!Object.keys(doc).length && journal.created.includes(path)) await unlink(path).catch((e: any) => { if (e.code !== 'ENOENT') throw e; });
    else await atomicJSON(path, doc);
  }
}
export async function activateProfile(config: BridgeConfig, dir = stateDir(), root?: string): Promise<void> {
  await withLock(dir, async () => {
    if (await readJSON(journalPath(dir))) throw new Error('A profile journal already exists. Restore the previous connection before applying a new profile.');
    const journal = await profileChanges(config, root);
    // Write before touching Desktop. Pending journals support recovery after interruption.
    await atomicJSON(journalPath(dir), journal);
    try { await applyJournal(journal); journal.state = 'active'; await atomicJSON(journalPath(dir), journal); }
    catch (err) { await restoreJournal(journal); await unlink(journalPath(dir)); throw err; }
  });
}
export async function restoreProfile(dir = stateDir()): Promise<boolean> {
  return withLock(dir, async () => {
    const value = await readJSON(journalPath(dir)); if (!value) return false;
    if (value.version !== 1 || !Array.isArray(value.changes) || !Array.isArray(value.created)) throw new Error('Invalid recovery journal.');
    await restoreJournal(value as Journal); await unlink(journalPath(dir)); return true;
  });
}
