import { randomUUID } from 'node:crypto';
import { BridgeError, invalid, isObject, type Route, type Wire } from './types.js';

// Desktop session history can contain inline system notices. Messages API
// providers require these in the top-level system field, outside turn history.
export function normalizeSystemMessages(body: Wire): Wire {
  if (!Array.isArray(body.messages) || !body.messages.some(message => message?.role === 'system')) return body;
  const blocks = (value: unknown): Wire[] => {
    if (value === undefined) return [];
    if (typeof value === 'string') return [{ type: 'text', text: value }];
    if (!Array.isArray(value) || value.some(block => !isObject(block) || block.type !== 'text' || typeof block.text !== 'string')) invalid('System messages must contain text blocks.');
    return value;
  };
  const system = [...blocks(body.system)];
  const messages = body.messages.filter(message => {
    if (message?.role !== 'system') return true;
    system.push(...blocks(message.content)); return false;
  });
  return { ...body, system, messages };
}

export function validateRequest(body: unknown, route: Route): asserts body is Wire {
  if (!isObject(body) || !Array.isArray(body.messages) || !body.messages.length) invalid('messages must be a nonempty array.');
  if (!Number.isSafeInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > route.maxOutputTokens) invalid(`max_tokens must be between 1 and ${route.maxOutputTokens} for ${route.ref}.`);
  if (body.stream !== undefined && typeof body.stream !== 'boolean') invalid('stream must be boolean.');
  for (const message of body.messages) {
    if (!isObject(message) || !['user', 'assistant'].includes(message.role)) invalid('Each message must have user or assistant role.');
    if (typeof message.content !== 'string' && !Array.isArray(message.content)) invalid('Message content must be a string or block array.');
    if (Array.isArray(message.content)) for (const block of message.content) {
      if (!isObject(block) || typeof block.type !== 'string') invalid('Invalid content block.');
      if (block.type === 'image' && !route.vision) invalid(`${route.ref} does not support image input.`);
      if (block.type === 'tool_use' && (!route.tools || typeof block.id !== 'string' || typeof block.name !== 'string' || !isObject(block.input))) invalid('Invalid or unsupported tool_use block.');
      if (block.type === 'tool_result' && typeof block.tool_use_id !== 'string') invalid('tool_result requires tool_use_id.');
    }
  }
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) invalid('tools must be an array.');
    if (body.tools.length && !route.tools) invalid(`${route.ref} does not support tools.`);
    for (const tool of body.tools) {
      if (!isObject(tool) || typeof tool.name !== 'string') invalid('Each tool needs a name.');
      if (route.protocol === 'chat' && tool.type && tool.type !== 'custom') invalid(`Server tool ${tool.type} is unsupported on translated routes.`);
      if ((!tool.type || tool.type === 'custom') && !isObject(tool.input_schema)) invalid('Client tool requires an input_schema.');
    }
  }
  if (estimateTokens(body) > Math.min(route.inputTokens || route.contextTokens, route.contextTokens - body.max_tokens)) invalid('Input exceeds the route’s conservative estimated context budget. Token estimates are approximate.');
}
export function estimateTokens(body: Wire): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify({ system: body.system, messages: body.messages, tools: body.tools })) / 3));
}
export function stopReason(reason: string | null): string {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  return 'end_turn';
}
export function usage(value: Wire = {}): Wire {
  const cached = value.prompt_tokens_details?.cached_tokens || 0;
  return { input_tokens: Math.max(0, (value.prompt_tokens || 0) - cached), output_tokens: value.completion_tokens || 0, cache_read_input_tokens: cached };
}

// Some chat providers require their own reasoning_content during a tool round trip.
// Keep it in bounded process memory, keyed by route and opaque tool IDs, not fake
// Anthropic thinking blocks/signatures. Nothing is logged or written to disk.
export class ReasoningReplay {
  private items = new Map<string, { entry: { text: string; size: number }; expires: number }>();
  private bytes = 0;
  private remove(key: string): void {
    const item = this.items.get(key);
    this.items.delete(key);
    if (item && ![...this.items.values()].some(i => i.entry === item.entry)) {
      this.bytes -= item.entry.size;
    }
  }
  remember(route: Route, calls: Wire[], text: string): void {
    if (!text || !route.reasoningField) return;
    const size = Buffer.byteLength(text);
    if (size > 4 * 1024 * 1024) throw new BridgeError(502, 'api_error', 'Upstream reasoning output exceeds the size limit.');
    const entry = { text, size };
    let added = false;
    for (const call of calls) {
      const key = `${route.ref}:${call.id}`; this.remove(key);
      this.items.set(key, { entry, expires: Date.now() + 3_600_000 });
      added = true;
    }
    if (added) this.bytes += size;
    while (this.items.size > 256 || this.bytes > 16 * 1024 * 1024) this.remove(this.items.keys().next().value!);
  }
  get(route: Route, calls: Wire[]): string | undefined {
    for (const call of calls) {
      const key = `${route.ref}:${call.id}`; const item = this.items.get(key);
      if (item && item.expires > Date.now()) return item.entry.text;
      if (item) this.remove(key);
    }
    return undefined;
  }
}
function textBlocks(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) invalid('Expected text or content blocks.');
  return value.map(block => {
    if (block.type !== 'text' || typeof block.text !== 'string') invalid(`Unsupported content type ${block.type}.`);
    return block.text;
  }).join('\n');
}
export function toChat(body: Wire, route: Route, replay: ReasoningReplay): Wire {
  const effort = body.output_config?.effort;
  const supportedEffort = route.effort?.mode === 'chat' && route.effort.levels.includes(effort);
  if (effort !== undefined && !supportedEffort && effort !== 'low') invalid('This model does not advertise the requested effort level.');
  if (body.thinking && body.thinking.type !== 'disabled' && !(body.thinking.type === 'adaptive' && supportedEffort)) invalid('Explicit Anthropic thinking is not supported on this translated Chat route. Use an advertised effort level or disable thinking.');
  const messages: Wire[] = [];
  if (body.system) messages.push({ role: 'system', content: textBlocks(body.system) });
  for (const message of body.messages) {
    if (typeof message.content === 'string') { messages.push({ role: message.role, content: message.content }); continue; }
    const blocks: Wire[] = message.content;
    if (message.role === 'assistant') {
      const texts: string[] = []; const calls: Wire[] = [];
      for (const block of blocks) {
        if (block.type === 'text') texts.push(block.text);
        else if (block.type === 'tool_use') calls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } });
        else invalid(`Assistant ${block.type} is not supported on Chat routes. Use a native Anthropic route for signed thinking.`);
      }
      const out: Wire = { role: 'assistant', content: texts.join('\n') || null };
      if (calls.length) out.tool_calls = calls;
      const reasoning = replay.get(route, calls);
      if (reasoning && route.reasoningField) out[route.reasoningField] = reasoning;
      messages.push(out);
    } else {
      let content: Wire[] = [];
      const flush = () => { if (content.length) messages.push({ role: 'user', content }); content = []; };
      for (const block of blocks) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text });
        else if (block.type === 'image') {
          if (block.source?.type !== 'base64' || typeof block.source.data !== 'string' || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(block.source.media_type)) invalid('Chat routes accept only base64 image blocks with a supported media type.');
          content.push({ type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } });
        } else if (block.type === 'tool_result') {
          flush();
          messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: `${block.is_error ? '[Tool error] ' : ''}${textBlocks(block.content || '')}` });
        } else invalid(`User ${block.type} is unsupported on Chat routes.`);
      }
      flush();
    }
  }
  const result: Wire = { model: route.model, messages, max_tokens: body.max_tokens, stream: !!body.stream };
  if (supportedEffort) result.reasoning_effort = effort;
  for (const key of ['temperature', 'top_p']) if (body[key] !== undefined) result[key] = body[key];
  if (body.stop_sequences) result.stop = body.stop_sequences;
  if (body.stream) result.stream_options = { include_usage: true };
  if (body.tools?.length) {
    result.tools = body.tools.map((tool: Wire) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }));
    const choice = body.tool_choice;
    if (choice) {
      if (choice.type === 'auto' || choice.type === 'none') result.tool_choice = choice.type;
      else if (choice.type === 'any') result.tool_choice = 'required';
      else if (choice.type === 'tool' && typeof choice.name === 'string') result.tool_choice = { type: 'function', function: { name: choice.name } };
      else invalid('Unsupported tool_choice.');
      if (choice.disable_parallel_tool_use !== undefined) result.parallel_tool_calls = !choice.disable_parallel_tool_use;
    }
  }
  return result;
}
export function fromChat(data: Wire, route: Route, replay: ReasoningReplay): Wire {
  const choice = data.choices?.[0];
  if (!choice?.message) throw new BridgeError(502, 'api_error', 'Upstream returned no completion.');
  const content: Wire[] = [];
  const message = choice.message;
  if (message.content) content.push({ type: 'text', text: message.content });
  for (const call of message.tool_calls || []) {
    let input: unknown;
    try { input = JSON.parse(call.function.arguments); } catch { throw new BridgeError(502, 'api_error', 'Upstream returned malformed tool arguments.'); }
    if (!isObject(input) || !call.id || !call.function.name) throw new BridgeError(502, 'api_error', 'Upstream returned an invalid tool call.');
    content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
  }
  replay.remember(route, message.tool_calls || [], message[route.reasoningField || 'reasoning_content'] || '');
  if (!content.length) content.push({ type: 'text', text: '' });
  return { id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', role: 'assistant', model: route.id, content, stop_reason: stopReason(choice.finish_reason), stop_sequence: null, usage: usage(data.usage) };
}
export interface SSEEvent { event: string; data: string }
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader(); const decoder = new TextDecoder();
  let buffer = ''; let event = ''; let data: string[] = []; let frameSize = 0;
  const line = (text: string): SSEEvent | undefined => {
    if (!text) { const value = data.length ? { event: event || 'message', data: data.join('\n') } : undefined; event = ''; data = []; frameSize = 0; return value; }
    frameSize += text.length;
    if (frameSize > 4 * 1024 * 1024) throw new BridgeError(502, 'api_error', 'Upstream SSE frame exceeds the size limit.');
    if (text.startsWith('event:')) event = text.slice(6).trimStart();
    if (text.startsWith('data:')) data.push(text.slice(5).trimStart());
    return undefined;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > 4 * 1024 * 1024) throw new BridgeError(502, 'api_error', 'Upstream SSE frame exceeds the size limit.');
      let n: number;
      while ((n = buffer.indexOf('\n')) >= 0) { const text = buffer.slice(0, n).replace(/\r$/, ''); buffer = buffer.slice(n + 1); const item = line(text); if (item) yield item; }
      if (done) break;
    }
    if (buffer) { const item = line(buffer); if (item) yield item; }
    const last = line(''); if (last) yield last;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export type Emit = (event: string, data: Wire) => Promise<void>;
export async function translateChatStream(body: ReadableStream<Uint8Array>, route: Route, replay: ReasoningReplay, emit: Emit): Promise<void> {
  const id = `msg_${randomUUID().replaceAll('-', '')}`;
  await emit('message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: route.id, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } });
  let textOpen = false; let finish: string | null = null; let measured: Wire = {}; let reasoning = ''; let complete = false;
  const calls = new Map<number, Wire>(); let size = 0;
  for await (const item of parseSSE(body)) {
    if (item.data === '[DONE]') { complete = true; break; }
    let chunk: Wire;
    try { chunk = JSON.parse(item.data); } catch { throw new BridgeError(502, 'api_error', 'Invalid upstream stream JSON.'); }
    if (chunk.error) throw new BridgeError(502, 'api_error', 'Upstream reported a stream error.');
    if (chunk.usage) measured = chunk.usage;
    const choice = chunk.choices?.[0]; if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta || {};
    if (delta.content) {
      if (!textOpen) { textOpen = true; await emit('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }); }
      await emit('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: delta.content } });
    }
    reasoning += delta[route.reasoningField || 'reasoning_content'] || '';
    for (const part of delta.tool_calls || []) {
      if (!Number.isSafeInteger(part.index) || part.index < 0 || part.index > 127) throw new BridgeError(502, 'api_error', 'Invalid upstream tool index.');
      const call = calls.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      call.id += part.id || ''; call.function.name += part.function?.name || ''; call.function.arguments += part.function?.arguments || '';
      calls.set(part.index, call);
      size += (part.function?.arguments || '').length;
    }
    if (size + reasoning.length > 4 * 1024 * 1024) throw new BridgeError(502, 'api_error', 'Upstream tool/reasoning output exceeds the size limit.');
  }
  if (!complete && !finish) throw new BridgeError(502, 'api_error', 'Upstream stream ended before completion.');
  if (textOpen) await emit('content_block_stop', { type: 'content_block_stop', index: 0 });
  else if (calls.size === 0) {
    await emit('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    await emit('content_block_stop', { type: 'content_block_stop', index: 0 });
  }
  let index = textOpen || calls.size === 0 ? 1 : 0;
  // Buffer tool metadata to tolerate split names/IDs and interleaved parallel calls.
  for (const [, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
    let parsed: unknown;
    try { parsed = JSON.parse(call.function.arguments || '{}'); } catch { throw new BridgeError(502, 'api_error', 'Upstream returned malformed tool arguments.'); }
    if (!call.id || !call.function.name || !isObject(parsed)) throw new BridgeError(502, 'api_error', 'Upstream returned an invalid tool call.');
    await emit('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: call.id, name: call.function.name, input: {} } });
    await emit('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: call.function.arguments || '{}' } });
    await emit('content_block_stop', { type: 'content_block_stop', index }); index++;
  }
  replay.remember(route, [...calls.values()], reasoning);
  await emit('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason(finish), stop_sequence: null }, usage: usage(measured) });
  await emit('message_stop', { type: 'message_stop' });
}
