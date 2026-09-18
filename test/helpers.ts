import { type BridgeConfig, type Protocol, type Route } from '../src/types.js';
export function route(protocol: Protocol = 'chat'): Route {
  return { id: 'claude-sonnet-5', tier: 'sonnet', ref: 'test/model', label: 'Test Model', protocol, baseURL: 'http://127.0.0.1:54321/v1', model: 'actual-model', auth: { none: true }, contextTokens: 200000, maxOutputTokens: 4096, vision: false, tools: true };
}
export function config(protocol: Protocol = 'chat'): BridgeConfig {
  return { version: 1, port: 41415, token: 'bridge-test-token-that-is-at-least-32-characters', routes: [route(protocol)] };
}
export function request(extra: Record<string, any> = {}) {
  return { model: 'claude-sonnet-5', max_tokens: 128, messages: [{ role: 'user', content: 'Hello' }], ...extra };
}
export function stream(events: { event?: string; data: unknown }[], splitBytes = 3): Response {
  const text = events.map(item => `${item.event ? `event: ${item.event}\r\n` : ''}data: ${typeof item.data === 'string' ? item.data : JSON.stringify(item.data)}\r\n\r\n`).join('');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += splitBytes) controller.enqueue(bytes.slice(i, i + splitBytes)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
