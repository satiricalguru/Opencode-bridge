// Brand marks from @lobehub/icons-static-svg (MIT). Only the marks imported here
// are bundled. Mono marks use currentColor and follow the theme.
import alibaba from '@lobehub/icons-static-svg/icons/alibaba-color.svg?raw';
import azure from '@lobehub/icons-static-svg/icons/azure-color.svg?raw';
import baidu from '@lobehub/icons-static-svg/icons/baidu-color.svg?raw';
import baseten from '@lobehub/icons-static-svg/icons/baseten.svg?raw';
import bedrock from '@lobehub/icons-static-svg/icons/bedrock-color.svg?raw';
import cerebras from '@lobehub/icons-static-svg/icons/cerebras-color.svg?raw';
import chutes from '@lobehub/icons-static-svg/icons/chutes.svg?raw';
import claude from '@lobehub/icons-static-svg/icons/claude-color.svg?raw';
import cloudflare from '@lobehub/icons-static-svg/icons/cloudflare-color.svg?raw';
import codex from '@lobehub/icons-static-svg/icons/codex-color.svg?raw';
import cohere from '@lobehub/icons-static-svg/icons/cohere-color.svg?raw';
import deepinfra from '@lobehub/icons-static-svg/icons/deepinfra-color.svg?raw';
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg?raw';
import dots from '@lobehub/icons-static-svg/icons/dotsstudio.svg?raw';
import doubao from '@lobehub/icons-static-svg/icons/doubao-color.svg?raw';
import fireworks from '@lobehub/icons-static-svg/icons/fireworks-color.svg?raw';
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg?raw';
import gemma from '@lobehub/icons-static-svg/icons/gemma-color.svg?raw';
import copilot from '@lobehub/icons-static-svg/icons/githubcopilot.svg?raw';
import grok from '@lobehub/icons-static-svg/icons/grok.svg?raw';
import groq from '@lobehub/icons-static-svg/icons/groq.svg?raw';
import huggingface from '@lobehub/icons-static-svg/icons/huggingface-color.svg?raw';
import hunyuan from '@lobehub/icons-static-svg/icons/hunyuan-color.svg?raw';
import kimi from '@lobehub/icons-static-svg/icons/kimi-color.svg?raw';
import liquid from '@lobehub/icons-static-svg/icons/liquid.svg?raw';
import lmstudio from '@lobehub/icons-static-svg/icons/lmstudio.svg?raw';
import longcat from '@lobehub/icons-static-svg/icons/longcat-color.svg?raw';
import meta from '@lobehub/icons-static-svg/icons/meta-color.svg?raw';
import microsoft from '@lobehub/icons-static-svg/icons/microsoft-color.svg?raw';
import mimo from '@lobehub/icons-static-svg/icons/xiaomimimo.svg?raw';
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg?raw';
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg?raw';
import morph from '@lobehub/icons-static-svg/icons/morph-color.svg?raw';
import nebius from '@lobehub/icons-static-svg/icons/nebius.svg?raw';
import nvidia from '@lobehub/icons-static-svg/icons/nvidia-color.svg?raw';
import ollama from '@lobehub/icons-static-svg/icons/ollama.svg?raw';
import openai from '@lobehub/icons-static-svg/icons/openai.svg?raw';
import opencode from '@lobehub/icons-static-svg/icons/opencode.svg?raw';
import openrouter from '@lobehub/icons-static-svg/icons/openrouter.svg?raw';
import perplexity from '@lobehub/icons-static-svg/icons/perplexity-color.svg?raw';
import poolside from '@lobehub/icons-static-svg/icons/poolside-color.svg?raw';
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg?raw';
import stepfun from '@lobehub/icons-static-svg/icons/stepfun-color.svg?raw';
import together from '@lobehub/icons-static-svg/icons/together-color.svg?raw';
import venice from '@lobehub/icons-static-svg/icons/venice-color.svg?raw';
import vercel from '@lobehub/icons-static-svg/icons/vercel.svg?raw';
import vertex from '@lobehub/icons-static-svg/icons/vertexai-color.svg?raw';
import yi from '@lobehub/icons-static-svg/icons/yi-color.svg?raw';
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg?raw';

// Inline attributes are dropped: sizing comes from CSS, and the CSP disallows inline styles.
const clean = (svg: string) => svg.replace(/\s(?:style|width|height)="[^"]*"/g, '').replace(/<title>[^<]*<\/title>/, '');
const MARKS: Record<string, string> = Object.fromEntries(Object.entries({
  alibaba, azure, baidu, baseten, bedrock, cerebras, chutes, claude, cloudflare, codex, cohere, deepinfra, deepseek, dots, doubao, fireworks, gemini, gemma,
  copilot, grok, groq, huggingface, hunyuan, kimi, liquid, lmstudio, longcat, meta, microsoft, mimo, minimax, mistral, morph, nebius, nvidia, ollama,
  openai, opencode, openrouter, perplexity, poolside, qwen, stepfun, together, venice, vercel, vertex, yi, zhipu,
}).map(([key, svg]) => [key, clean(svg)]));
export const MARK_LABEL: Record<string, string> = { ollama: 'Ollama', lmstudio: 'LM Studio', opencode: 'OpenCode', nvidia: 'NVIDIA', openrouter: 'OpenRouter', copilot: 'GitHub Copilot', gemini: 'Google', claude: 'Anthropic', openai: 'OpenAI', deepseek: 'DeepSeek', kimi: 'Moonshot', zhipu: 'Zhipu', qwen: 'Qwen', mistral: 'Mistral', grok: 'xAI' };

const PROVIDERS: Array<[RegExp, string]> = [
  [/^ollama/, 'ollama'], [/^lmstudio$/, 'lmstudio'], [/^opencode/, 'opencode'], [/^nvidia/, 'nvidia'], [/^openrouter/, 'openrouter'],
  [/^github-copilot/, 'copilot'], [/^google-vertex/, 'vertex'], [/^google/, 'gemini'], [/^anthropic/, 'claude'], [/^(openai|azure-openai)$/, 'openai'],
  [/^azure/, 'azure'], [/^amazon-bedrock|^bedrock/, 'bedrock'], [/^deepseek/, 'deepseek'], [/^moonshot|^kimi/, 'kimi'], [/^(zai|zhipu)/, 'zhipu'],
  [/^(alibaba|dashscope|qwen)/, 'alibaba'], [/^mistral/, 'mistral'], [/^xai/, 'grok'], [/^groq/, 'groq'], [/^together/, 'together'], [/^fireworks/, 'fireworks'],
  [/^cerebras/, 'cerebras'], [/^deepinfra/, 'deepinfra'], [/^huggingface/, 'huggingface'], [/^perplexity/, 'perplexity'], [/^minimax/, 'minimax'],
  [/^cohere/, 'cohere'], [/^baseten/, 'baseten'], [/^chutes/, 'chutes'], [/^cloudflare/, 'cloudflare'], [/^nebius/, 'nebius'], [/^venice/, 'venice'],
  [/^vercel/, 'vercel'], [/^morph/, 'morph'], [/^inception/, 'opencode'],
];
// Model families, matched on the model name/ID (after the provider prefix).
const FAMILIES: Array<[RegExp, string]> = [
  [/deepseek/, 'deepseek'], [/\b(glm|chatglm|zhipu)/, 'zhipu'], [/kimi|moonshot/, 'kimi'], [/qwen|qwq/, 'qwen'], [/gemma/, 'gemma'], [/gemini/, 'gemini'],
  [/claude|\bfable\b|\bopus\b|\bsonnet\b|\bhaiku\b/, 'claude'], [/\bgpt|\bo[134]\b|codex|openai/, 'openai'], [/llama/, 'meta'],
  [/mistral|codestral|devstral|magistral|ministral|pixtral/, 'mistral'], [/nemotron/, 'nvidia'], [/grok/, 'grok'], [/minimax/, 'minimax'],
  [/longcat/, 'longcat'], [/mimo/, 'mimo'], [/\bphi-?\d/, 'microsoft'], [/command|cohere/, 'cohere'], [/\blfm|liquid/, 'liquid'],
  [/laguna|poolside/, 'poolside'], [/dots/, 'dots'], [/step-?\d|stepfun/, 'stepfun'], [/hunyuan/, 'hunyuan'], [/doubao|seed/, 'doubao'],
  [/ernie/, 'baidu'], [/\byi-/, 'yi'], [/big-?pickle/, 'opencode'],
];
export function providerMark(provider: string, source?: string): string | undefined {
  if (source === 'ollama') return 'ollama';
  if (source === 'lmstudio') return 'lmstudio';
  return PROVIDERS.find(([pattern]) => pattern.test(provider))?.[1];
}
export function familyMark(ref: string, name: string): string | undefined {
  const text = `${ref.slice(ref.indexOf('/') + 1)} ${name}`.toLowerCase();
  return FAMILIES.find(([pattern]) => pattern.test(text))?.[1];
}
export function Mark({ name, className = '', label }: { name?: string; className?: string; label?: string }) {
  const svg = name ? MARKS[name] : undefined;
  if (!svg) return <span className={`mark mark-fallback ${className}`} aria-hidden={!label} aria-label={label}>{(label || '?').slice(0, 1).toUpperCase()}</span>;
  return <span className={`mark ${className}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={!label} dangerouslySetInnerHTML={{ __html: svg }} />;
}
// Provider tile with an optional model-family badge, e.g. NVIDIA + DeepSeek.
export function ModelMark({ provider, source, id, name, size = 'md' }: { provider: string; source: string; id: string; name: string; size?: 'md' | 'lg' }) {
  const main = providerMark(provider, source);
  const family = familyMark(id, name);
  const lead = main || family;
  const badge = family && family !== lead ? family : undefined;
  return <span className={`model-mark ${size}`} aria-hidden="true">
    <Mark name={lead} label={lead ? undefined : provider} className="lead" />
    {badge && <span className="family-badge"><Mark name={badge} /></span>}
  </span>;
}
