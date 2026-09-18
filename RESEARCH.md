# OpenCode models inside Claude Desktop: research

Research date: 17 September 2026. Companion: [high-level implementation plan](IMPLEMENTATION_PLAN.md).

## Finding

The requested experience is technically credible: select a model available through OpenCode, launch the actual Claude Desktop application, and use that model for inference. Build a local **Anthropic-compatible inference gateway plus a Claude Desktop profile manager**, following Ollama’s pattern.

Claude Desktop now has a native third-party deployment mode covering Chat, Cowork, and Code, with a bundled web application and local conversation storage. This is materially different from merely configuring the Claude Code CLI. Anthropic’s gateway documentation is written around Claude models; arbitrary non-Claude models still require model-by-model compatibility testing. Ollama’s current integration demonstrates the latter approach. [Anthropic deployment overview](https://claude.com/docs/third-party/claude-desktop/overview), [Ollama announcement, 25 August 2026](https://ollama.com/blog/claude-desktop).

**OpenCode is an agent application and provider client, rather than a model inference engine.** “OpenCode models” means either its hosted Zen/Go models or models reached through its configured providers. The bridge should reuse those connections while Claude Desktop continues to own the conversation and tool execution. [OpenCode providers](https://opencode.ai/docs/providers/).

## What I inspected

- Official Anthropic, Ollama, OpenCode, Cloudflare, and LiteLLM documentation.
- Public Ollama implementation: desktop launcher, gateway, model routing, app status, and Anthropic request/stream conversion.
- Public OpenCode implementation: provider resolution, auth storage, message transformations, LLM execution, and provider HTTP routes.
- The installed Ollama desktop UI, navigating its Apps page, settings, and a model picker without changing selections or connections.
- Installed app metadata. Claude Desktop: **2.110.1**; Ollama: **0.34.1**; OpenCode Desktop: **1.18.29**. All three CLIs are also present.

This workspace was empty. No live inference request, credential inspection, profile modification, or integration implementation was performed. The source review used exact revisions: [Ollama `5ed8dde`](https://github.com/ollama/ollama/commit/5ed8dde3a7a5bf4c9047a8a91906b4f6788f60b9) and [OpenCode `5a83358`](https://github.com/anomalyco/opencode/commit/5a8335857b0ebec44ef6aa1d52b339cf25c329ca). Source package metadata identifies the inspected OpenCode code as 1.18.31, slightly ahead of the installed desktop app. See [source inventory](research-source-inventory.json).

## How Ollama’s desktop application does it

### Visible user experience

On this machine, Apps showed the Claude connection enabled and four routed requests for the session. Its card was labelled “Claude Code,” while Settings → Apps contained a separate “Claude” section. That section offered one Ollama model picker for each of Fable 5, Opus 5, Sonnet 5, Haiku 4.5, and Sonnet 4.6, a Start Claude control, and an auto-mode toggle. The toggle was off. Opening a picker exposed model search; no model was selected during inspection.

Ollama’s documentation describes connecting Claude from Apps, selecting models in settings, and restarting Claude. It lists Cowork, subagents, web search, and auto mode among supported features. Its documented desktop integration currently targets macOS, with Windows support coming later. Those statements describe Ollama’s tested integration, not guaranteed support for every OpenCode provider. [Ollama desktop integration guide](https://docs.ollama.com/integrations/claude-desktop).

### Profile configuration and application lifecycle

The launcher writes a dedicated third-party profile, sets the gateway endpoint, updates profile-library metadata, and switches deployment mode. On macOS it handles the normal `Claude` directory and the `Claude-3p/configLibrary` directory under Application Support. It preserves unrelated JSON fields, supports restoration, checks gateway availability, and coordinates quitting/reopening Claude. It also accounts for Claude saving settings during shutdown. These are implementation details, not a promised stable public file API. [Inspected launcher](https://github.com/ollama/ollama/blob/5ed8dde3a7a5bf4c9047a8a91906b4f6788f60b9/cmd/launch/claude_desktop.go).

For our first experiment, use the official in-app configuration window. It validates configuration, tests a connection, applies locally, and exports deployment artifacts. Automating profile files should come only after establishing a working exported configuration for the installed version. [Anthropic in-app configuration](https://claude.com/docs/third-party/claude-desktop/in-app-configuration).

### Local gateway and inference backend

Ollama’s desktop gateway listens on `127.0.0.1:11435`, separately from its usual inference server. It exposes model discovery, messages, and token counting; rewrites the requested model to the selected Ollama model; and proxies inference to Ollama. It checks loopback hosts, rejects requests carrying a browser Origin, removes incoming credentials before forwarding, and includes readiness and health handling. Its image fallback can retry after replacing unsupported image content with an explanatory notice. [Inspected gateway](https://github.com/ollama/ollama/blob/5ed8dde3a7a5bf4c9047a8a91906b4f6788f60b9/internal/proxy/claude_desktop.go).

Ollama’s separate Anthropic layer converts request content, tool definitions/results, and response events. Its token-count estimate is deliberately approximate. It also contains special handling for built-in web search, which is more involved than forwarding an ordinary user-defined function. [Inspected Anthropic adapter](https://github.com/ollama/ollama/blob/5ed8dde3a7a5bf4c9047a8a91906b4f6788f60b9/anthropic/anthropic.go), [API compatibility guide](https://docs.ollama.com/api/anthropic-compatibility).

### Model IDs are a compatibility contract

Ollama assigns selected backend models to five predefined Claude-facing model slots. Its catalog advertises the actual backend model as the display name and supplies fields including family tier, default status, and output limit. An explicit mapping can route multiple slots to the same backend model. The five-slot limit belongs to this Ollama implementation; it should not be assumed to be Claude Desktop’s universal limit. [Inspected model mapping](https://github.com/ollama/ollama/blob/5ed8dde3a7a5bf4c9047a8a91906b4f6788f60b9/internal/proxy/claude_desktop_models.go).

Historical reports show why discovery deserves an early test: a May integration discovered models but filtered all of them out. A September report describes problems advertising larger context windows. Treat these as regression scenarios, not proof that current builds universally fail. [Discovery report](https://github.com/ollama/ollama/issues/16025), [extended-context report](https://github.com/ollama/ollama/issues/18180).

## What OpenCode supplies—and what it does not

| OpenCode surface | Useful contribution | Integration consequence |
| --- | --- | --- |
| Configured providers | Catalog, model IDs, endpoints, options | Import selected connections through a versioned adapter |
| API-key authentication | Credentials for supported upstream APIs | Keep upstream keys inside the gateway |
| Provider runtime | SDK/native model resolution and provider-specific behavior | Candidate for shared inference infrastructure |
| Zen | Hosted model APIs in several protocols | Strong first target for a standalone bridge |
| Go | Hosted coding-model APIs and subscription routing | Support only after its usage/session requirements are satisfied |
| `opencode serve` | Agent sessions, messages, events, provider management | Useful for discovery; does not replace `/v1/messages` |
| Plugins/ACP/MCP | Agent extensibility and tool/editor integration | Separate from replacement of Claude Desktop inference |

OpenCode’s reviewed provider service merges configuration, environment, credentials, plugin auth loaders, endpoint overrides, and model metadata before resolving an SDK language model. Reproducing every provider by reading a key file would miss important behavior. [Inspected provider service](https://github.com/anomalyco/opencode/blob/5a8335857b0ebec44ef6aa1d52b339cf25c329ca/packages/opencode/src/provider/provider.ts).

The reviewed LLM execution path prepares requests in an agent/session context and supports SDK and optional native-runtime paths. Directly calling that whole path could inject OpenCode-specific behavior. The gateway needs a narrower inference service that receives Claude’s supplied messages and tool schemas without running OpenCode’s agent loop. [Inspected LLM execution](https://github.com/anomalyco/opencode/blob/5a8335857b0ebec44ef6aa1d52b339cf25c329ca/packages/opencode/src/session/llm.ts).

Auth records can represent API keys, OAuth access/refresh tokens, and other mechanisms. Sharing a stored OAuth access token does not establish compatible refresh, provider authorization, or endpoint behavior. API-key providers are the appropriate starting scope. [Inspected auth service](https://github.com/anomalyco/opencode/blob/5a8335857b0ebec44ef6aa1d52b339cf25c329ca/packages/opencode/src/auth/index.ts).

OpenCode configuration also varies by generation: the standard documentation uses a `provider` section, while v2 documentation describes `providers` and runtime packages. Detect versions and schemas instead of merging examples from both. [Standard configuration](https://opencode.ai/docs/config/), [v2 configuration](https://opencode.ai/v2/docs/config/).

## Hosted OpenCode models are the easiest starting point

Zen exposes per-model endpoints using Anthropic Messages, OpenAI Chat Completions, or OpenAI Responses, and offers model metadata. A gateway can preserve Anthropic-compatible traffic on matching routes and translate other routes. Consequently, a standalone bridge does not need an OpenCode agent process in the inference path. [Zen API documentation](https://opencode.ai/docs/zen/).

Go similarly exposes multiple protocols. Its documentation asks other clients to send typical coding-agent traffic, identify themselves with their own user agent, and maintain session information; Claude Code’s native session header is recognized. Claude Desktop is not explicitly listed as a validated client. Preserve session identity through the bridge and validate suitability before enabling Go for general Chat or Cowork research. Its retention policies also vary by model. [Go client and API documentation](https://opencode.ai/docs/go/).

## The protocol requirements that determine feasibility

Anthropic requires streaming and tool use on `POST /v1/messages`. Model discovery is optional when models are explicitly configured. Prompt-cache breakpoints should be preserved or mapped to upstream caching rather than silently discarded. [Official gateway contract](https://claude.com/docs/third-party/claude-desktop/gateway).

An Anthropic stream has message lifecycle events, indexed content blocks, text/tool argument deltas, usage/stop updates, and a final stop event. This requires an event translator for OpenAI-style upstream streams, rather than forwarding their SSE bytes unchanged. [Streaming specification](https://platform.claude.com/docs/en/build-with-claude/streaming).

Client tools return structured calls for the client to execute and send back as results. Server tools have different execution semantics. Our gateway should preserve client tools for Claude Desktop and handle server tools only through an explicitly supported provider or separate feature. [Tool-use documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview).

A model alias can influence assumptions about effort, context, and pricing. Explicit model entries support labels, tier mappings, and confirmed extended-context capabilities. Compatibility aliases must be presented as routing choices, with actual model identity visible. Avoid inheriting Claude list-price estimates for non-Claude backends. [Model configuration reference](https://claude.com/docs/third-party/claude-desktop/configuration).

## Alternatives and recommendation

| Approach | Assessment |
| --- | --- |
| Standalone gateway importing selected OpenCode connections | Recommended first build: controllable scope and no agent nesting |
| Add a gateway directly to OpenCode and share provider resolution | Best long-term fit if an upstream change or maintained fork is acceptable |
| Use LiteLLM for initial translation | Useful experiment/accelerator; still needs Desktop discovery, session, profile, and feature testing |
| Route every Desktop request into an OpenCode agent session | Poor inference replacement: two agents own tools, prompts, and conversation state |
| Add an OpenCode MCP tool to Claude Desktop | Useful delegation feature, but leaves the primary inference model unchanged |
| Replace Claude with a custom desktop UI | Different product; does not satisfy launching the actual Claude Desktop app |

LiteLLM documents an Anthropic-compatible messages interface across providers. Cloudflare independently documents Claude Desktop’s gateway setup. These establish reusable gateway infrastructure, but neither demonstrates complete compatibility with all OpenCode providers and Desktop workflows. [LiteLLM interface](https://docs.litellm.ai/docs/anthropic_unified), [Cloudflare Desktop integration](https://developers.cloudflare.com/ai-gateway/integrations/coding-agents/claude-desktop/).

## Limits of the conclusion

**Verified:** the native deployment mode exists; Ollama’s UI and public code implement the requested pattern; OpenCode exposes usable hosted APIs and provider-resolution infrastructure.

**Inferred:** a dedicated gateway can reuse selected OpenCode connections to reproduce that experience.

**Unproven until the implementation spike:** end-to-end non-Claude inference in this exact Desktop build, arbitrary-ID acceptance, tool loops, thinking replay, session-header propagation, and feature parity for each backend.

Local inference does not automatically imply a fully offline desktop app. Runtime downloads, updates, telemetry, catalog metadata, connectors, and search have independent network paths. Document those paths and test the chosen settings rather than claiming universal zero egress or universal zero retention. [Anthropic telemetry and egress](https://claude.com/docs/third-party/claude-desktop/telemetry).

The first development milestone should be a working Desktop conversation and tool round trip through one Anthropic-compatible OpenCode route, followed by one translated OpenAI-compatible route. Build the launcher UX after those tests establish the contract.
