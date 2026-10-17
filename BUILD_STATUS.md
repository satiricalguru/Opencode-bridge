# Build status

Updated 17 October 2026: `opencode-claude-bridge` 0.2.0. See [VERIFICATION.md](VERIFICATION.md) for live results.

## 0.4.0

- **Codex names, your models.** Mirrors the Claude feature: Bridge reads Codex's own visible model names from `models_cache.json` (falling back to a default list), maps each to a backend with its own pinned effort, and writes them into the Codex catalog. Codex's picker shows its usual names while your models answer. You can choose the default name with **Make default**, and launchpad picks move the names that follow the default. Verified live with Codex CLI 0.153.4: `gpt-6-luna` → DeepSeek V4.1 Flash Free (agent), `gpt-5.6-terra` → Nemotron 3 Super (OpenRouter).
- **Minor improvements.** An update notice in the sidebar (a GitHub release check every 6 h in the main process, which opens the release page). A copy button for `codex --profile opencode-bridge` (clipboard via the main process). <kbd>⌘1</kbd>–<kbd>⌘3</kbd> switch pages.
- `npm test`: 67 passed.

## 0.3.0

- **Final audit fixes.** Background polls no longer swallow clicks. Restarts and quit now ask for confirmation. Arrow keys, Home and End move through the model list, and ⌘K or `/` focuses search. Errors also appear as toasts. Status dots have readable labels, and decorative logos are hidden from screen readers. The "Connected" label has its own background so it stays readable over the launcher glow. There is a new night-sky app icon, also used as the Dock icon in dev (`npm run app`) and in the About panel.
- **README media** come from real code: `npm run media` renders the real renderer offscreen with demo data (stills, GIFs, MP4), and `npm run media:codex` records a real Codex CLI session through a disposable gateway.

- **Redesign.** Inspired by the Air design system (Refero): an atmospheric drifting-sky backdrop, hairline glass panels, Inter with one handwritten (Caveat) accent word per headline, and a single blue accent. Light, dark and system themes are synced to macOS (`nativeTheme`, window vibrancy). Motion includes a spring-sliding nav indicator and segmented thumbs, staggered row entry, shimmer skeletons, a count-up model total, a glow and "New" tag for arrivals, toasts, and a launcher orb tinted per app. All motion respects reduced-motion preferences. Fonts and icons are bundled locally to satisfy the CSP.
- **Real brand icons.** Provider logos lead (Ollama, LM Studio, OpenCode, NVIDIA, OpenRouter, GitHub Copilot, Google…), with a model-family badge (DeepSeek, Qwen, GLM, Kimi, Gemma, Llama, Nemotron…). Provider filter chips carry logos too. Marks come from `@lobehub/icons-static-svg` (MIT).
- **LM Studio.** Downloaded models are discovered through its REST API, or via `lms ls` when its server is off. They use LM Studio's Anthropic-compatible `/v1/messages`, like Ollama. On launch the bridge starts LM Studio's server and loads the selected model if needed. Models that aren't trained for tool use are shown but disabled.
- **Live model updates.** A watcher fingerprints Ollama tags, LM Studio models and OpenCode's model cache, auth and config every 4 s. A pull, download, removal or new OpenCode model refreshes the library automatically and shows a toast. Local-only changes reuse the cached OpenCode inventory.

| Check | Result |
| --- | --- |
| `npm test` | 65 passed, 0 failed (adds LM Studio discovery and preparation, watcher fingerprints and retry, change reporting, theme IPC) |
| Live: `ollama pull gemma4:31b-cloud` / `ollama rm` with the real watcher | Arrival detected in about 4 s, removal in about 2 s, no manual refresh |
| Live: LM Studio 0.4.24 server | `/v1/messages` answers in Anthropic format; REST listing parsed; the RVC and embedding models are correctly not offered |
| UI in browser with mocked bridge, light and dark | Launchpad, Applications, Settings, theme switching and the simulated model arrival inspected |
| Electron app from source | Window opened (1240×820) with no errors and quit cleanly |

## 0.2.0

- **OpenCode free models.** A bridge-owned, password-protected `opencode serve` agent runs OpenCode Zen free models, OAuth logins (for example GitHub Copilot) and SDKs without a bridge adapter (Google, Responses). Streaming, tool notes, a permission policy (read-only, edit & run, full), session reuse, project working directory detection, cancellation, and usage are supported. No client-identity spoofing.
- **Codex.** An OpenAI Responses endpoint (`/v1/responses`) translates to every bridge route, including function and custom (freeform) tools, reasoning effort, usage, `incomplete` and `failed` states. The Codex adapter mirrors `ollama launch codex`: a private `opencode-bridge` profile plus model catalog (`codex --profile opencode-bridge`, opened in Terminal), or a journaled, reversible model selection for the Codex app. Claude and Codex share one gateway and token, and disconnecting one keeps the other served.
- **Effort control.** Each Claude slot and the Codex model can pin an effort level the backend advertises. Requests for unadvertised levels map to the nearest level. Fixed: models whose levels had gaps (for example only high/max) were capped at Low in Claude, and their effort was silently dropped.
- **Fixes.** OpenRouter (`@openrouter/ai-sdk-provider`) now gets direct routes. Request paths with `//` are normalized. Chat routes drop adaptive thinking instead of failing when no effort is advertised. Disconnect & Quit restores every connected app, not only Claude. The CLI `init` falls back to the agent for free/OAuth models, and `models` reports agent eligibility.
- **UI/UX.** Claude/Codex switcher on the Launchpad. Per-slot effort pickers. Codex card. OpenCode agent settings with workspace and permission controls. Free and OpenCode-agent badges. Live Applications count. No text below 10px. Muted text raised to about 5:1 contrast. Model rows use `radiogroup`/`radio` semantics. Fixed the launch panel overlapping the footer, the sidebar clipping at the minimum window height, success banners leaking across pages, NaN port input, and the stale "Zen unavailable" note.

| Check | Result |
| --- | --- |
| `npm run check`, `npm run check:ui`, `npm run build:app` | Passed |
| `npm test` | 60 passed, 0 failed (adds Responses translation/streaming, agent engine against a fake OpenCode server, Codex config edit/restore, Claude+Codex service orchestration, effort resolution, IPC validation) |
| `npm run smoke:launcher` | Passed |
| `npm run smoke` (OpenRouter free, direct client-tool round trip) | Passed |
| `npm run smoke:agent` (DeepSeek V4.1 Flash Free, Big Pickle) | Passed ×2 |
| Electron app from source, isolated state | Started, renderer loaded, clean quit |

## 0.1.0 (18 September 2026)

## Delivered

- TypeScript gateway that binds to authenticated native loopback clients on a separate configurable port.
- OpenCode CLI model discovery and a limited v1 provider/configuration/API-key importer, including local unauthenticated model connections.
- Stable Sonnet/Opus/Haiku route mapping, distinct Claude family labels in Desktop, and visible actual backend names in the companion app.
- Capability-based Desktop effort menus, native effort forwarding, and explicit Chat reasoning-effort translation.
- Ollama-style Applications panel with independent Fable 5, Opus 5, Sonnet 5, Haiku 4.5, and Sonnet 4.6 model assignments, staged changes, Apply & Restart, and Auto mode settings.
- Explicit Disconnect & Quit controls and full-Quit connection choices. Closing the window hides to the menu bar; restoring the profile precedes gateway shutdown.
- Native Anthropic forwarding and Chat Completions translation, including streamed text and client tool round trips, parallel tool calls, usage, cancellation, and normalized errors.
- Command-line initialization, preview, foreground/background serving, status, connect, launch, restore, and stop.
- Dedicated Claude Desktop profile with atomic writes, a recovery journal written before mutation, conflict checks, interrupted-application recovery, and preservation of unrelated settings/profile entries.
- Repeat launch can reuse an unchanged active profile without losing its original restore state.
- README, optional local OpenCode configuration example, protocol/profile tests, and reproducible smoke scripts.
- Electron desktop app with a searchable/provider-filtered model library, automatic installed Ollama discovery, primary/auxiliary model selection, save/launch/restore controls, settings, and a menu bar tray.
- Sandboxed renderer, restrictive custom application protocol/CSP, sender-checked and validated IPC with credential-free public DTOs.
- Shared gateway supervisor, desktop service, per-client saved selections, and a desktop client adapter registry. Claude and Codex are implemented (0.2.0).
- macOS Apple Silicon `.app` packaging and app icon assets; bundled gateway runtime avoids requiring a separate Node install for the packaged app.

## Validation evidence

| Check | Result | Scope |
| --- | --- | --- |
| `npm run check` | Passed | Strict TypeScript checking of production code |
| `npm test` | 45 passed, 0 failed | Protocol/recovery, GUI orchestration, local discovery, action serialization, registry gating, IPC, beta SDK queries, five-backend slot dispatch, output caps, inline system normalization, effort capabilities, IPv6 loopback host, thinking budget clamping, empty turn block fallback, launch failure gateway cleanup, and model parsing resilience |
| `npm run check:ui` and `npm run build:app` | Passed | Typed React renderer and compiled app assets |
| `npm run build` | Passed | Compiled CLI/gateway with declarations and source maps |
| `npm run smoke:launcher` | Passed | Real background subprocess start/reuse, one local fixture inference request, status/preview, stop, isolated state |
| `opencode/union-alpha` live request | Latest HTTP 401; earlier HTTP 403 `FreeTierError` | Not an accessible native route in the latest verification; absent from the current zero-cost snapshot |
| `opencode/big-pickle` live request | HTTP 403 `FreeTierError` | Chat Completions access restricted to OpenCode itself |
| `bridge-local/ornith:9b` live smoke | Passed | Installed Ollama model, temporary OpenCode connection, streamed client-tool call/result/final answer, Anthropic SDK client |
| `bridge-local/ornith:9b` native Anthropic live smoke | Passed | Ollama Messages endpoint, streamed client-tool round trip, 376 input tokens and 108 output tokens; slow run of approximately 205 seconds |
| Packaged desktop interface | Opened and inspected | Model picker displayed 622 discovered models, 119 credential/protocol-compatible choices, and installed Claude status |
| Installed application | Opened and inspected | `/Applications/OpenCode Bridge.app`; model search and application registry checked, saved local selection preserved |
| Packaged gateway runtime | Passed | Bundled Electron runtime started/reused the detached gateway, completed fixture inference, previewed a profile, and stopped using disposable state without changing Desktop settings |
| Actual Claude launch from GUI | Profile loaded | Actual Desktop showed OpenCode Bridge and the selected `ornith:9b` model in its picker; initial connectivity checks on the Chat route cancelled around 10 seconds |
| Three active family aliases | Passed | Each returned HTTP 200 and `BRIDGE_OK` through the selected local backend; actual profile labels matched the bridge configuration |
| Current supported Zen free models | Five live HTTP 403 `FreeTierError` | Big Pickle, Ling, MiMo, and both Nemotron routes; two Muse free models remain disabled for unsupported Responses protocol |
| Actual Desktop basic chat after compatibility fixes | Passed on retry | Completed `BRIDGE_OK` and two subsequent chat turns; first cold request exceeded the five-minute upstream timeout |
| Actual Desktop model/effort picker | Passed | Distinct Claude Sonnet/Opus/Haiku labels and Low/Medium/High choices; selected backend and Medium preference preserved |
| Genuine OpenCode free-model session | HTTP 403 | Latest official CLI v1.18.31, Big Pickle, isolated workspace with tools denied; Zen free-model integration remains blocked |
| Apps model panel | Applied and inspected | Five independent selectors, actual Apply & Restart, five entries in Claude's picker, original disconnect state retained, Auto mode off |
| Full Quit choices | Inspected; Cancel passed | Disconnect & Quit, Keep Connected & Quit, Cancel; final quit paths were left unexercised while the user edited a model and had active inference |

The five-model Applications panel and Quit choices are installed. The final build in `release-verified/mac-arm64/OpenCode Bridge.app` also includes the connection-action Quit guard and lifecycle test seam; it is staged without restarting the user's active companion or losing their model-selection draft. Its packaged-runtime smoke passed on retry. An initial attempt exceeded the 30-second startup deadline; independent runtime/CLI controls passed, but the cause of that isolated timeout is not established.

The local tool round trip completed in approximately 28 seconds, reporting 418 total input tokens and 179 output tokens. Its test tool only adds two numbers; no external tool action was executed. The temporary OpenCode connection was removed afterward. `.bridge/live-smoke-results.json` contains metadata for the latest live run and is ignored by source control.

No upstream API keys were copied into project artifacts, and no existing OpenCode auth/configuration file was rewritten. Initial fixture/SDK tests used temporary Desktop config trees. During GUI inspection the user activated the actual local model connection from the app. That active selection was preserved; the local gateway was updated to use Ollama's native Messages endpoint without changing its selected backend or Desktop profile. Background fixture processes were stopped and disposable state removed. The user's active integration gateway remains running.

## Remaining work

The implementation establishes the gateway/launcher foundation. **The original Phase 0 Desktop exit gate has not passed.** SDK tests are not proof of actual Desktop Chat, Code, or Cowork behavior.

1. Connect the actual Desktop app to an accessible native Anthropic route and a translated route. Record its auxiliary requests and automatic thinking/output/server-tool fields, verify a real Desktop permission/tool/result cycle, and restore its prior connection.
2. Adjust version-specific aliases and capabilities based on those observations. Chat's current rejection of explicit Anthropic thinking may need a product-level model capability setting or a validated adapter extension.
3. Verify a hosted API-key route and applicable provider headers/options; Zen free-tier catalog visibility cannot be treated as permission to use those routes externally.
4. Complete actual client inference/tool validation. Packaged UI and bundled-runtime launcher checks pass; catalog/auth availability is distinct from verified upstream connectivity. The latest Desktop test exposed beta query-string routing, oversized output budgets, and inline system notices; those cases now have regression coverage.
5. Complete provider option semantics, managed-policy checks, crash supervision, credential-helper/Keychain integration, signed packaging, and supported-version regression coverage before release.

OAuth/Responses/Google provider runtimes are served through the OpenCode agent route since 0.2.0; OpenCode Go remains deferred. A route appearing in discovery is metadata, not a compatibility certification.
