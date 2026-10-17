import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isObject } from '../types.js';

// The model names Codex itself offers. Like Claude's family names, Codex keeps
// showing these while a backend of the user's choice answers each one.
export interface CodexName { slug: string; label: string }
export const DEFAULT_CODEX_NAMES: CodexName[] = [
  { slug: 'gpt-5.5', label: 'GPT-5.5' },
  { slug: 'gpt-5.5-codex', label: 'GPT-5.5-Codex' },
  { slug: 'gpt-5.5-mini', label: 'GPT-5.5-Mini' },
];
const SLUG = /^[a-z0-9][a-z0-9._:-]{0,63}$/i;
export const validCodexSlug = (slug: unknown): slug is string => typeof slug === 'string' && SLUG.test(slug);
// Reads the visible models from Codex's own cache (<CODEX_HOME>/models_cache.json),
// in Codex's priority order. Falls back to a stable default list.
export async function readCodexNames(home: string): Promise<CodexName[]> {
  try {
    const data = JSON.parse(await readFile(join(home, 'models_cache.json'), 'utf8'));
    const models = Array.isArray(data?.models) ? data.models : [];
    const names = models
      .filter((m: unknown) => isObject(m) && validCodexSlug(m.slug) && m.visibility !== 'hide')
      .sort((a: any, b: any) => (a.priority ?? 99) - (b.priority ?? 99))
      .slice(0, 8)
      .map((m: any) => ({ slug: m.slug, label: typeof m.display_name === 'string' && m.display_name ? m.display_name.slice(0, 48) : m.slug }));
    return names.length ? names : DEFAULT_CODEX_NAMES;
  } catch { return DEFAULT_CODEX_NAMES; }
}
