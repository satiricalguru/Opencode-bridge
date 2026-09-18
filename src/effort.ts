import type { Effort, EffortCapability, Protocol, Wire } from './types.js';

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export function effortCapability(model: Wire, protocol: Protocol): EffortCapability | undefined {
  if (protocol === 'anthropic' && model._bridgeSource === 'ollama' && model.capabilities?.reasoning === true) {
    return { mode: 'native', levels: ['low', 'medium', 'high'] };
  }
  // Reasoning support alone does not imply adjustable effort. Only import
  // variants that explicitly advertise the provider's effort control.
  const levels = EFFORTS.filter(level => Object.values(model.variants || {}).some((variant: any) =>
    protocol === 'anthropic' ? variant?.effort === level : variant?.reasoningEffort === level));
  return levels.length ? { mode: protocol === 'anthropic' ? 'native' : 'chat', levels } : undefined;
}
export function maxEffort(capability?: EffortCapability): Effort {
  let max: Effort = 'low';
  for (const level of EFFORTS) {
    if (!capability?.levels.includes(level)) break;
    max = level;
  }
  return max;
}
