import { randomBytes } from 'node:crypto';
import { invalid, isObject, type Route, type Wire } from './types.js';
import type { Emit } from './protocol.js';

// OpenAI Responses (Codex) ⇄ Anthropic Messages. Codex talks Responses; every
// bridge route already speaks Messages events, so translation happens at the edge.

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;
function text(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(part => typeof part?.text === 'string' ? part.text : typeof part?.refusal === 'string' ? part.refusal : '').join('');
}
function image(part: Wire): Wire | undefined {
  const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
  const match = typeof url === 'string' ? /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/s.exec(url) : null;
  return match ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } } : undefined;
}
function userContent(content: unknown, vision: boolean): Wire[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks: Wire[] = [];
  for (const part of content) {
    if (!isObject(part)) continue;
    if (part.type === 'input_image') {
      const block = vision ? image(part) : undefined;
      blocks.push(block || { type: 'text', text: '[image omitted: this model does not accept images]' });
    } else if (typeof part.text === 'string' && part.text) blocks.push({ type: 'text', text: part.text });
  }
  return blocks;
}
function output(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => typeof part?.text === 'string' ? part.text : part?.type ? `[${part.type}]` : '').join('\n');
  if (isObject(value) && typeof value.content === 'string') return value.content;
  return JSON.stringify(value ?? '');
}
const CUSTOM_SCHEMA = { type: 'object', properties: { input: { type: 'string', description: 'The raw tool input, exactly as the tool format requires.' } }, required: ['input'] };

export interface ResponsesRequest { anthropic: Wire; custom: Set<string>; echo: Wire }
export function toMessages(body: Wire, route: Route): ResponsesRequest {
  if (!isObject(body)) invalid('Request body must be a JSON object.');
  const system: string[] = [];
  if (typeof body.instructions === 'string' && body.instructions) system.push(body.instructions);
  const messages: Wire[] = [];
  const push = (role: 'user' | 'assistant', blocks: Wire[]) => {
    if (!blocks.length) return;
    const last = messages[messages.length - 1];
    // Messages providers expect alternating roles; consecutive items merge.
    if (last?.role === role) last.content.push(...blocks); else messages.push({ role, content: blocks });
  };
  const input = typeof body.input === 'string' ? [{ type: 'message', role: 'user', content: body.input }] : body.input;
  if (!Array.isArray(input)) invalid('input must be a string or an array.');
  for (const item of input) {
    if (!isObject(item)) continue;
    const type = item.type || (item.role ? 'message' : undefined);
    if (type === 'message') {
      if (item.role === 'system' || item.role === 'developer') { const t = text(item.content); if (t) system.push(t); }
      else if (item.role === 'assistant') { const t = text(item.content); if (t) push('assistant', [{ type: 'text', text: t }]); }
      else push('user', userContent(item.content, route.vision));
    } else if (type === 'function_call' || type === 'custom_tool_call') {
      let args: unknown = {};
      if (type === 'custom_tool_call') args = { input: typeof item.input === 'string' ? item.input : '' };
      else { try { args = JSON.parse(item.arguments || '{}'); } catch { args = { raw: String(item.arguments) }; } }
      push('assistant', [{ type: 'tool_use', id: item.call_id, name: item.name, input: isObject(args) ? args : { value: args } }]);
    } else if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      push('user', [{ type: 'tool_result', tool_use_id: item.call_id, content: output(item.output) || '(no output)' }]);
    } else if (type === 'local_shell_call') {
      push('assistant', [{ type: 'tool_use', id: item.call_id, name: 'local_shell', input: isObject(item.action) ? item.action : {} }]);
    } else if (type === 'local_shell_call_output') {
      push('user', [{ type: 'tool_result', tool_use_id: item.call_id, content: output(item.output) || '(no output)' }]);
    }
    // reasoning, web_search_call and other provider-owned items carry no portable state.
  }
  if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: [{ type: 'text', text: '(continue)' }] });
  const tools: Wire[] = []; const custom = new Set<string>();
  for (const tool of Array.isArray(body.tools) ? body.tools : []) {
    if (!isObject(tool)) continue;
    if (tool.type === 'function' && typeof tool.name === 'string') tools.push({ name: tool.name, description: tool.description || '', input_schema: isObject(tool.parameters) ? { type: 'object', ...tool.parameters } : { type: 'object', properties: {} } });
    else if (tool.type === 'custom' && typeof tool.name === 'string') {
      custom.add(tool.name);
      const grammar = isObject(tool.format) && typeof tool.format.definition === 'string' ? `\n\nInput format (${tool.format.syntax || 'grammar'}):\n${tool.format.definition.slice(0, 6000)}` : '';
      tools.push({ name: tool.name, description: `${tool.description || ''}${grammar}`, input_schema: CUSTOM_SCHEMA });
    }
    // Hosted tools (web_search, file_search, image_generation) have no bridge backend.
  }
  const anthropic: Wire = { model: route.id, max_tokens: Number.isSafeInteger(body.max_output_tokens) && body.max_output_tokens > 0 ? Math.min(body.max_output_tokens, route.maxOutputTokens) : route.maxOutputTokens, messages, stream: true };
  if (system.length) anthropic.system = system.join('\n\n');
  if (tools.length && route.tools) {
    anthropic.tools = tools;
    const choice = body.tool_choice;
    if (choice === 'required') anthropic.tool_choice = { type: 'any' };
    else if (choice === 'none') anthropic.tool_choice = { type: 'none' };
    else if (isObject(choice) && typeof choice.name === 'string') anthropic.tool_choice = { type: 'tool', name: choice.name };
    if (body.parallel_tool_calls === false) anthropic.tool_choice = { type: 'auto', ...anthropic.tool_choice, disable_parallel_tool_use: true };
  }
  if (typeof body.reasoning?.effort === 'string' && ['low', 'medium', 'high', 'xhigh', 'max'].includes(body.reasoning.effort)) {
    anthropic.output_config = { effort: body.reasoning.effort };
    if (route.protocol !== 'chat') anthropic.thinking = { type: 'adaptive' };
  }
  for (const key of ['temperature', 'top_p']) if (typeof body[key] === 'number') anthropic[key] = body[key];
  const echo = { model: typeof body.model === 'string' ? body.model : route.id, ...(isObject(body.reasoning) ? { reasoning: body.reasoning } : {}), tool_choice: body.tool_choice ?? 'auto', tools: Array.isArray(body.tools) ? body.tools : [], parallel_tool_calls: body.parallel_tool_calls ?? true, ...(body.previous_response_id ? { previous_response_id: body.previous_response_id } : {}) };
  return { anthropic, custom, echo };
}

// Consumes Anthropic stream events and emits the equivalent Responses events.
export class ResponsesTranslator {
  readonly id = id('resp');
  private created = Math.floor(Date.now() / 1000);
  private sequence = 0;
  private items: Wire[] = [];
  private blocks = new Map<number, { item: Wire; index: number; kind: string; buffer: string }>();
  private usage: Wire = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  private stop: string | null = null;
  constructor(private request: ResponsesRequest, private emit: (event: string, data: Wire) => Promise<void>) {}
  private send(type: string, data: Wire) { return this.emit(type, { type, sequence_number: this.sequence++, ...data }); }
  private response(status: string, extra: Wire = {}): Wire {
    const input = this.usage.input_tokens + this.usage.cache_read_input_tokens;
    return { id: this.id, object: 'response', created_at: this.created, status, error: null, incomplete_details: null, instructions: null, max_output_tokens: null, ...this.request.echo, output: this.items.filter(Boolean),
      usage: status === 'in_progress' ? null : { input_tokens: input, input_tokens_details: { cached_tokens: this.usage.cache_read_input_tokens }, output_tokens: this.usage.output_tokens, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: input + this.usage.output_tokens }, ...extra };
  }
  async start(): Promise<void> {
    await this.send('response.created', { response: this.response('in_progress') });
    await this.send('response.in_progress', { response: this.response('in_progress') });
  }
  readonly handle: Emit = async (event, data) => {
    if (event === 'message_start') { Object.assign(this.usage, filterUsage(data.message?.usage)); return; }
    if (event === 'content_block_start') {
      const block = data.content_block || {}; const index = this.items.length;
      let item: Wire;
      if (block.type === 'text') item = { id: id('msg'), type: 'message', role: 'assistant', status: 'in_progress', content: [] };
      else if (block.type === 'tool_use') item = this.request.custom.has(block.name) ? { id: id('ctc'), type: 'custom_tool_call', status: 'in_progress', call_id: block.id, name: block.name, input: '' } : { id: id('fc'), type: 'function_call', status: 'in_progress', call_id: block.id, name: block.name, arguments: '' };
      else if (block.type === 'thinking') item = { id: id('rs'), type: 'reasoning', summary: [] };
      else return;
      this.items.push(item);
      this.blocks.set(data.index, { item, index, kind: block.type, buffer: block.type === 'thinking' ? block.thinking || '' : '' });
      await this.send('response.output_item.added', { output_index: index, item: item.type === 'reasoning' ? item : { ...item } });
      if (block.type === 'text') await this.send('response.content_part.added', { item_id: item.id, output_index: index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      return;
    }
    if (event === 'content_block_delta') {
      const open = this.blocks.get(data.index); if (!open) return;
      const delta = data.delta || {};
      if (delta.type === 'text_delta' && typeof delta.text === 'string') { open.buffer += delta.text; await this.send('response.output_text.delta', { item_id: open.item.id, output_index: open.index, content_index: 0, delta: delta.text, logprobs: [] }); }
      else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        open.buffer += delta.partial_json;
        if (open.item.type === 'function_call') await this.send('response.function_call_arguments.delta', { item_id: open.item.id, output_index: open.index, delta: delta.partial_json });
      } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') open.buffer += delta.thinking;
      return;
    }
    if (event === 'content_block_stop') {
      const open = this.blocks.get(data.index); if (!open) return;
      this.blocks.delete(data.index);
      const item = open.item;
      if (open.kind === 'text') {
        item.status = 'completed'; item.content = [{ type: 'output_text', text: open.buffer, annotations: [] }];
        await this.send('response.output_text.done', { item_id: item.id, output_index: open.index, content_index: 0, text: open.buffer, logprobs: [] });
        await this.send('response.content_part.done', { item_id: item.id, output_index: open.index, content_index: 0, part: item.content[0] });
      } else if (item.type === 'function_call') {
        item.status = 'completed'; item.arguments = open.buffer || '{}';
        await this.send('response.function_call_arguments.done', { item_id: item.id, output_index: open.index, arguments: item.arguments });
      } else if (item.type === 'custom_tool_call') {
        item.status = 'completed';
        let parsed: Wire = {}; try { parsed = JSON.parse(open.buffer || '{}'); } catch {}
        item.input = typeof parsed.input === 'string' ? parsed.input : open.buffer;
      } else if (item.type === 'reasoning') {
        if (open.buffer) item.summary = [{ type: 'summary_text', text: open.buffer }];
        else { this.items[open.index] = undefined as any; return; }
      }
      await this.send('response.output_item.done', { output_index: open.index, item });
      return;
    }
    if (event === 'message_delta') { Object.assign(this.usage, filterUsage(data.usage)); if (data.delta?.stop_reason) this.stop = data.delta.stop_reason; return; }
  };
  async finish(): Promise<Wire> {
    if (this.stop === 'max_tokens') {
      const response = this.response('incomplete', { incomplete_details: { reason: 'max_output_tokens' } });
      await this.send('response.incomplete', { response }); return response;
    }
    const response = this.response('completed');
    await this.send('response.completed', { response }); return response;
  }
  async fail(code: string, message: string): Promise<void> {
    await this.send('response.failed', { response: this.response('failed', { error: { code, message } }) });
  }
}
function filterUsage(usage: unknown): Wire {
  if (!isObject(usage)) return {};
  return Object.fromEntries(['input_tokens', 'output_tokens', 'cache_read_input_tokens'].filter(key => Number.isFinite(usage[key]) && usage[key] > 0).map(key => [key, usage[key]]));
}
