import test from 'node:test';
import assert from 'node:assert/strict';
import { effortCapability, maxEffort, resolveEffort } from '../src/effort.js';
import { applyEffort } from '../src/gateway.js';
import { toChat, ReasoningReplay } from '../src/protocol.js';
import { route, request } from './helpers.js';

test('effort comes from explicit provider variants or native local thinking support', () => {
  const variants = { low: { reasoningEffort: 'low' }, medium: { reasoningEffort: 'medium' }, high: { reasoningEffort: 'high' } };
  assert.deepEqual(effortCapability({ variants }, 'chat'), { mode: 'chat', levels: ['low', 'medium', 'high'] });
  assert.equal(effortCapability({ capabilities: { reasoning: true }, variants: {} }, 'chat'), undefined);
  // A gap in advertised levels no longer caps Desktop at Low; requests map to the nearest level.
  assert.equal(maxEffort({ mode: 'native', levels: ['low', 'high'] }), 'high');
  assert.equal(maxEffort({ mode: 'chat', levels: ['high', 'max'] }), 'max');
  assert.equal(maxEffort(undefined), 'low');
  assert.deepEqual(effortCapability({ variants: { low: {}, high: {}, max: {}, none: {} } }, 'opencode'), { mode: 'opencode', levels: ['low', 'high', 'max'] });
  assert.deepEqual(effortCapability({ _bridgeSource: 'ollama', capabilities: { reasoning: true } }, 'anthropic'), { mode: 'native', levels: ['low', 'medium', 'high'] });
});
test('Chat routes translate advertised effort into the provider reasoning field and reject unsupported levels', () => {
  const selected = route(); selected.effort = { mode: 'chat', levels: ['low', 'medium', 'high'] };
  for (const effort of selected.effort.levels) {
    const translated = toChat(request({ thinking: { type: 'adaptive' }, output_config: { effort } }), selected, new ReasoningReplay());
    assert.equal(translated.reasoning_effort, effort); assert.equal(translated.thinking, undefined);
  }
  assert.throws(() => toChat(request({ output_config: { effort: 'max' } }), selected, new ReasoningReplay()), /effort/i);
  assert.throws(() => toChat(request({ thinking: { type: 'enabled', budget_tokens: 1024 } }), selected, new ReasoningReplay()), /thinking/i);
});
test('requested effort resolves to the nearest advertised level and user overrides win', () => {
  const capability = { mode: 'chat' as const, levels: ['low' as const, 'high' as const, 'max' as const] };
  assert.equal(resolveEffort('medium', capability), 'low');
  assert.equal(resolveEffort('xhigh', capability), 'high');
  assert.equal(resolveEffort('max', capability), 'max');
  assert.equal(resolveEffort('bogus', capability), undefined);
  assert.equal(resolveEffort('high', undefined), undefined);
  const selected = route(); selected.effort = capability;
  assert.deepEqual(applyEffort(request({ output_config: { effort: 'medium' } }), selected).output_config, { effort: 'low' });
  selected.effortOverride = 'max';
  assert.deepEqual(applyEffort(request({ output_config: { effort: 'low' } }), selected).output_config, { effort: 'max' });
  assert.deepEqual(applyEffort(request(), selected).output_config, { effort: 'max' });
  const plain = route();
  const stripped = applyEffort(request({ thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }), plain);
  assert.equal(stripped.thinking, undefined); assert.deepEqual(stripped.output_config, {});
  assert.equal(toChat(stripped, plain, new ReasoningReplay()).reasoning_effort, undefined);
});
