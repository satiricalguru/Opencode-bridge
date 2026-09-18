import { mkdir, readFile, rename, writeFile, unlink, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { parse, type ParseError } from 'jsonc-parser';
import { isObject, type Wire } from './types.js';

export function stateDir(): string {
  return process.env.BRIDGE_STATE_DIR || join(homedir(), 'Library', 'Application Support', 'OpenCode Claude Bridge');
}
export async function readJSON(path: string): Promise<Wire | undefined> {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (err: any) { if (err.code === 'ENOENT') return undefined; throw err; }
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !isObject(value)) throw new Error(`Invalid JSON object in ${path}`);
  return value;
}
export async function atomicJSON(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
}
export async function withLock<T>(directory: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'profile.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await writeFile(path, String(process.pid), { flag: 'wx', mode: 0o600 }); break; }
    catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      const pid = Number(await readFile(path, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Profile lock is invalid; inspect it before retrying.');
      try { process.kill(pid, 0); throw new Error('Another bridge process is changing the Desktop profile.'); }
      catch (e: any) { if (e.code !== 'ESRCH') throw e; }
      if (attempt === 1) throw new Error('Could not acquire profile lock.');
      await unlink(path);
    }
  }
  try { return await fn(); } finally { await unlink(path); }
}
