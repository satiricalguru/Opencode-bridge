import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { LMSTUDIO_URL } from './catalog.js';

// Cheap change detection for model sources. A tick costs one Ollama tags call,
// one LM Studio call (or two directory listings) and a few stat() calls; the
// expensive discovery runs only when a fingerprint actually changes.
export interface Fingerprint { local: string; opencode: string }
export type ChangeKind = 'local' | 'opencode';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
export function openCodeFiles(): string[] {
  const config = process.env.OPENCODE_CONFIG_DIR || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode');
  const data = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode');
  const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'opencode');
  return [join(cache, 'models.json'), process.env.OPENCODE_AUTH_FILE || join(data, 'auth.json'), join(config, 'opencode.json'), join(config, 'opencode.jsonc'), ...(process.env.OPENCODE_CONFIG ? [process.env.OPENCODE_CONFIG] : [])];
}
async function mtimes(paths: string[]): Promise<Array<number | null>> {
  return Promise.all(paths.map(path => stat(path).then(s => s.mtimeMs, () => null)));
}
async function ollamaTags(fetcher: typeof fetch): Promise<unknown> {
  try {
    const response = await fetcher('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (!response.ok) return 'down';
    const data = await response.json() as any;
    return (data.models || []).map((m: any) => [m.name, m.digest]).sort();
  } catch { return 'down'; }
}
async function lmStudioModels(fetcher: typeof fetch, root: string): Promise<unknown> {
  try {
    const response = await fetcher(`${LMSTUDIO_URL}/api/v1/models`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (response.ok) return ['up', ((await response.json() as any).models || []).map((m: any) => m.key).sort()];
  } catch {}
  // Server off: downloaded models live in <root>/<publisher>/<model>.
  try {
    const publishers = await readdir(root, { withFileTypes: true });
    const names = await Promise.all(publishers.filter(p => p.isDirectory() && !p.name.startsWith('.')).map(async p => (await readdir(join(root, p.name))).filter(n => !n.startsWith('.')).map(n => `${p.name}/${n}`)));
    return ['down', names.flat().sort()];
  } catch { return 'none'; }
}
export async function fingerprint(fetcher: typeof fetch = fetch, lmStudioRoot = join(homedir(), '.lmstudio', 'models'), files = openCodeFiles()): Promise<Fingerprint> {
  const [ollama, lmstudio, times] = await Promise.all([ollamaTags(fetcher), lmStudioModels(fetcher, lmStudioRoot), mtimes(files)]);
  return { local: hash([ollama, lmstudio]), opencode: hash(times) };
}
export class ModelWatcher {
  private timer?: NodeJS.Timeout;
  private last?: Fingerprint;
  private running = false;
  constructor(private onChange: (kinds: ChangeKind[]) => Promise<void>, private probe: () => Promise<Fingerprint> = () => fingerprint(), private interval = 4000) {}
  async start(): Promise<void> {
    if (this.timer) return;
    this.last = await this.probe();
    this.timer = setInterval(() => { void this.tick(); }, this.interval);
    this.timer.unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  // Exposed for tests; overlapping ticks are skipped.
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const next = await this.probe();
      const kinds: ChangeKind[] = [];
      if (this.last && next.local !== this.last.local) kinds.push('local');
      if (this.last && next.opencode !== this.last.opencode) kinds.push('opencode');
      if (kinds.length) {
        await this.onChange(kinds);
      }
      // A failed refresh leaves the old fingerprint so the next tick retries.
      this.last = next;
    } catch {} finally { this.running = false; }
  }
}
