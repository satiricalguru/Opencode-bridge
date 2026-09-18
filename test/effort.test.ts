import test from 'node:test';
import assert from 'node:assert/strict';
import { effortCapability, maxEffort } from '../src/effort.js';
import { toChat, ReasoningReplay } from '../src/protocol.js';
import { route, request } from './helpers.js';

test('effort comes from explicit provider variants or native local thinking support', () => {
  const variants = { low: { reasoningEffort: 'low' }, medium: { reasoningEffort: 'medium' }, high: { reasoningEffort: 'high' } };
  assert.deepEqual(effortCapability({ variants }, 'chat'), { mode: 'chat', levels: ['low', 'medium', 'high'] });
  assert.equal(effortCapability({ capabilities: { reasoning: true }, variants: {} }, 'chat'), undefined);
  assert.equal(maxEffort({ mode: 'native', levels: ['low', 'high'] }), 'low');
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
