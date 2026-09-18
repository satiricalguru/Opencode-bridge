import type { Route, Slot, Tier } from './types.js';

export const CLAUDE_SLOTS: Array<{ key: Slot; id: string; label: string; tier: Tier; familyDefault: boolean }> = [
  { key: 'sonnet', id: 'claude-sonnet-5', label: 'Sonnet 5', tier: 'sonnet', familyDefault: true },
  { key: 'opus', id: 'claude-opus-5', label: 'Opus 5', tier: 'opus', familyDefault: true },
  { key: 'haiku', id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', tier: 'haiku', familyDefault: true },
  { key: 'fable', id: 'claude-fable-5', label: 'Fable 5', tier: 'fable', familyDefault: true },
  { key: 'sonnet46', id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', tier: 'sonnet', familyDefault: false },
];
export function routeSlot(route: Route): Slot {
  return route.slot || CLAUDE_SLOTS.find(slot => slot.id === route.id)?.key || route.tier;
}
export function routePresentation(route: Route) {
  const slot = CLAUDE_SLOTS.find(slot => slot.key === routeSlot(route));
  return { label: `Claude ${slot?.label || route.tier}`, familyDefault: slot?.familyDefault ?? true };
}
