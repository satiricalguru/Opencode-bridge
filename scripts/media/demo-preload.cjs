// Demo bridge for README media: the real renderer with reproducible sample data.
const { contextBridge } = require('electron');
// ?theme=light|dark is applied before the app reads its saved theme.
try { const theme = new URLSearchParams(location.search).get('theme'); if (theme) localStorage.setItem('bridge-theme', theme); } catch {}
const m = (ref, name, provider, extra = {}) => ({ ref, name, provider, source: provider === 'ollama-local' ? 'ollama' : provider === 'lmstudio' ? 'lmstudio' : 'opencode', protocol: 'chat', via: 'direct', efforts: [], tools: true, vision: false, context: 200000, free: false, enabled: true, ...extra });
let models = [
  m('ollama-local/qwen3.6', 'qwen3.6', 'ollama-local', { protocol: 'anthropic', efforts: ['low', 'medium', 'high'], free: true, context: 32768 }),
  m('ollama-local/gemma4', 'gemma4', 'ollama-local', { protocol: 'anthropic', free: true, context: 32768, vision: true }),
  m('lmstudio/qwen/qwen3-coder-30b', 'Qwen3 Coder 30B', 'lmstudio', { protocol: 'anthropic', free: true, context: 131072 }),
  m('opencode/deepseek-v4.1-flash-free', 'DeepSeek V4.1 Flash Free', 'opencode', { protocol: 'opencode', via: 'agent', free: true, efforts: ['low', 'high', 'max'] }),
  m('opencode/big-pickle', 'Big Pickle', 'opencode', { protocol: 'opencode', via: 'agent', free: true }),
  m('opencode/glm-5.3-flash-free', 'GLM-5.3-Flash Free', 'opencode', { protocol: 'opencode', via: 'agent', free: true, efforts: ['low', 'high', 'max'] }),
  m('nvidia/deepseek-ai/deepseek-v4.1-flash', 'DeepSeek V4.1 Flash', 'nvidia', { free: true, efforts: ['low', 'high', 'max'], context: 1000000 }),
  m('nvidia/moonshotai/kimi-k3', 'Kimi K3', 'nvidia', { free: true, context: 262144 }),
  m('openrouter/nvidia/nemotron-3-super-120b-a12b:free', 'Nemotron 3 Super (free)', 'openrouter', { free: true, context: 262144 }),
  m('opencode/claude-sonnet-5', 'Claude Sonnet 5', 'opencode', { protocol: 'anthropic', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], context: 1000000, vision: true }),
  m('opencode/gpt-5.5', 'GPT-5.5', 'opencode', { efforts: ['low', 'medium', 'high', 'xhigh'] }),
  m('github-copilot/gpt-5.5', 'GPT-5.5', 'github-copilot', { protocol: 'opencode', via: 'agent', efforts: ['low', 'medium', 'high', 'xhigh'] }),
  m('google/gemini-3.5-flash', 'Gemini 3.5 Flash', 'google', { protocol: 'opencode', via: 'agent' }),
  m('openrouter/qwen/qwen3.6-coder', 'Qwen3.6 Coder', 'openrouter', { context: 262144 }),
  m('openrouter/mistralai/devstral-3', 'Devstral 3', 'openrouter', { context: 262144 }),
];
const selections = { claude: { model: 'opencode/deepseek-v4.1-flash-free', opus: 'opencode/claude-sonnet-5', haiku: 'ollama-local/qwen3.6', fable: 'nvidia/moonshotai/kimi-k3', effort: { sonnet: 'high', opus: 'max' } }, codex: { model: 'opencode/deepseek-v4.1-flash-free', names: { 'gpt-5.6-terra': 'openrouter/nvidia/nemotron-3-super-120b-a12b:free', 'gpt-5.6-luna': 'ollama-local/qwen3.6' }, effort: { sonnet: 'high' } } };
const codexNames = [{ slug: 'gpt-6-luna', label: 'GPT-6-Luna' }, { slug: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' }, { slug: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' }];
const state = () => ({
  version: '0.4.0', models, notices: [], codexNames,
  preferences: { version: 1, selectedClient: 'claude', port: 41415, agent: { workspace: '/Users/you/OpenCode Bridge', permission: 'read-only' }, selections },
  clients: [
    { id: 'claude', name: 'Claude Desktop', description: 'Chat, Code & Cowork', availability: 'available', protocol: 'anthropic-messages', status: { installed: true, running: true, connected: false, recoveryNeeded: false } },
    { id: 'codex', name: 'Codex', description: 'Codex CLI & app', availability: 'available', protocol: 'openai-responses', status: { installed: true, running: false, connected: true, recoveryNeeded: false, targets: { cli: true, app: true }, appConnected: false } },
  ],
  gateway: { ready: true, active: 0, routed: 128, port: 41415 },
  savedRoutes: [['sonnet', 'opencode/deepseek-v4.1-flash-free', 'high'], ['opus', 'opencode/claude-sonnet-5', 'max'], ['haiku', 'ollama-local/qwen3.6'], ['fable', 'nvidia/moonshotai/kimi-k3'], ['sonnet46', 'opencode/deepseek-v4.1-flash-free']].map(([slot, ref, effort]) => ({ id: slot, tier: slot === 'sonnet46' ? 'sonnet' : slot, slot, ref, label: ref, protocol: 'chat', ...(effort ? { effort } : {}) })),
  codexRoutes: [['gpt-6-luna', 'GPT-6-Luna', 'opencode/deepseek-v4.1-flash-free', 'high'], ['gpt-5.6-terra', 'GPT-5.6-Terra', 'openrouter/nvidia/nemotron-3-super-120b-a12b:free'], ['gpt-5.6-luna', 'GPT-5.6-Luna', 'ollama-local/qwen3.6']].map(([id, displayName, ref, effort]) => ({ id, displayName, tier: 'sonnet', slot: 'sonnet', ref, label: ref, protocol: 'chat', ...(effort ? { effort } : {}) })),
});
let listener;
contextBridge.exposeInMainWorld('desktop', {
  request: async value => { await new Promise(r => setTimeout(r, value.action === 'refresh' ? 600 : 60)); return { ok: true, state: state() }; },
  onChange: l => { listener = l; return () => { listener = undefined; }; },
});
contextBridge.exposeInMainWorld('demo', {
  arrive: () => { const added = m('ollama-local/llama4-scout', 'llama4-scout', 'ollama-local', { protocol: 'anthropic', free: true, context: 32768 }); models = [added, ...models]; listener?.({ state: state(), added: [added], removed: [] }); },
});
