import type { Effort, EffortCapability, Protocol, Wire } from './types.js';

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort);
export function effortCapability(model: Wire, protocol: Protocol): EffortCapability | undefined {
  if (protocol === 'anthropic' && model._bridgeSource === 'ollama' && model.capabilities?.reasoning === true) {
    return { mode: 'native', levels: ['low', 'medium', 'high'] };
  }
  // Reasoning support alone does not imply adjustable effort. Only import
  // variants that explicitly advertise the provider's effort control.
  const variants = Object.entries(model.variants || {});
  const levels = EFFORTS.filter(level => variants.some(([name, variant]: [string, any]) =>
    protocol === 'anthropic' ? variant?.effort === level
      : protocol === 'opencode' ? name === level
        : variant?.reasoningEffort === level));
  return levels.length ? { mode: protocol === 'anthropic' ? 'native' : protocol, levels } : undefined;
}
// Desktop offers every level up to this cap. Requests for a level the backend
// lacks are mapped to the nearest advertised level by resolveEffort.
export function maxEffort(capability?: EffortCapability): Effort {
  return capability?.levels.length ? capability.levels.reduce((a, b) => EFFORTS.indexOf(b) > EFFORTS.indexOf(a) ? b : a) : 'low';
}
// Nearest advertised level, preferring the lower one on ties so a request never
// silently escalates cost.
export function resolveEffort(requested: unknown, capability?: EffortCapability): Effort | undefined {
  if (!isEffort(requested) || !capability?.levels.length) return undefined;
  if (capability.levels.includes(requested)) return requested;
  const target = EFFORTS.indexOf(requested);
  return [...capability.levels].sort((a, b) => Math.abs(EFFORTS.indexOf(a) - target) - Math.abs(EFFORTS.indexOf(b) - target) || EFFORTS.indexOf(a) - EFFORTS.indexOf(b))[0];
}
