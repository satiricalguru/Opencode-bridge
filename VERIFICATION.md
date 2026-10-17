# Model mapping and free-route verification

## 17 October 2026 — v0.3.0: redesign, LM Studio, live model updates

- Real watcher + real Ollama 0.35.1: `ollama pull gemma4:31b-cloud` was detected and listed about 4 s later; `ollama rm` was reflected about 2 s later. Ollama was left with its original empty model list.
- LM Studio 0.4.24: with its server started, `POST /v1/messages` returned an Anthropic-format error ("No models loaded"), confirming the Messages endpoint; `/api/v1/models` lists capabilities. This machine has only an RVC voice model and an embedding model, so no LM Studio chat inference was run. Load and start behaviour is covered by fixture tests. The server was stopped afterwards.
- The UI was inspected in light and dark themes against a mocked bridge. The Electron app booted from source and quit cleanly. macOS screen recording isn't permitted for the verifying shell, so the native window itself (vibrancy) was not screenshotted.

## 17 October 2026 — v0.2.0: OpenCode free models, Codex, effort control

Checked on this macOS installation with OpenCode CLI 1.18.34, Codex CLI 0.153.4 and the Codex app (`com.openai.codex`).

### Why the free models previously failed, and what changed

OpenCode Zen's free tier answers non-OpenCode clients with HTTP 403 `FreeTierError` ("can only be used from within OpenCode"). That is still true for direct API calls, with or without an API key. Probing the genuine `opencode serve` API showed that the restriction also applies when OpenCode's own tools are disabled or denied for a session. It passes only for OpenCode's real agent with its tool set. The bridge does **not** imitate OpenCode's client identity. Instead, v0.2.0 runs these models inside a bridge-owned, password-protected `opencode serve` session (the `opencode` route protocol):

- Claude Desktop or Codex → gateway → OpenCode session (`prompt_async` + `/event` stream) → the model.
- OpenCode runs the model with its own tools. Its permission prompts are answered by the bridge policy: **read-only** by default, with optional **edit & run commands** or **full access**. Interactive questions and doom-loop prompts are always declined.
- Text deltas stream back as Anthropic events; each OpenCode tool use appears as a short `> ⚙︎ tool · title` note. Follow-up turns resume the same OpenCode session (keyed by a hash of the visible transcript), so history is not resent.
- The working directory follows Claude Code's `Working directory:` line or Codex's `<cwd>`, otherwise the configured workspace (default `~/OpenCode Bridge`).
- Effort maps to the model's OpenCode `variant`.

Trade-off: with agent routes the *app's* client tools (Claude Code's Bash/Edit, Codex's shell/apply_patch) are not executed; OpenCode's are. Direct routes (API-key providers, Ollama, OpenRouter) keep full client-side tool round trips.

### Live results

| Check | Result |
| --- | --- |
| Direct Zen free API call (key and no key) | HTTP 403 `FreeTierError` (expected; not used) |
| `opencode serve` session with OpenCode tools disabled/denied | HTTP 403 (so tools must stay enabled) |
| Engine alone, `deepseek-v4.1-flash-free` | Read a file, read-only policy declined a write, resumed session answered turn 2 from memory |
| Anthropic SDK → gateway, four Claude slots on four free models (Claude Code-shaped request, tools + adaptive thinking + effort) | All correct: DeepSeek V4.1 Flash Free 10 s, Big Pickle 11 s, GLM-5.3 Flash Free 44 s, Nemotron 3.5 Lightning Free 139 s |
| `npm run smoke:agent` (DeepSeek Free, Big Pickle), run twice | 4/4 passed: file read via OpenCode, streamed answer, resumed follow-up |
| Codex CLI `codex --profile opencode-bridge exec` → OpenCode agent (DeepSeek Free) | Correct answer in about 9 s; OpenCode used Codex's working directory |
| Codex CLI → direct OpenRouter free model (Nemotron 3 Super) | Codex executed its own shell tool twice through Responses↔Messages translation; correct final answer over 3 turns |
| `npm run smoke` (client-tool round trip, OpenRouter free, direct) | Passed |
| NVIDIA DeepSeek V4.1 Flash via Codex | Not completed: NVIDIA's API itself did not answer (a direct `curl` also timed out), so this was an upstream outage |
| Catalog on this machine | 594 discovered, 471 ready (up from 119), including 12 OpenCode Zen free models through the agent |

Not exercised live, to avoid disrupting active apps: switching the real Claude Desktop profile, which would restart the Claude app hosting the verifying session, and connecting the real Codex app's root `config.toml`. Both paths are covered by isolated tests with temporary config trees. The Codex app connection is a journaled, text-preserving edit that restores the user's original lines exactly.

---

## 18 September 2026 — v0.1.0

Checked 18 September 2026 on this macOS installation. Availability is separated from catalog visibility and fixture protocol coverage.

## Claude names and routing

The five-slot profile applied from the installed app matched its recovery journal. Claude's picker now displays **Claude Sonnet 5**, **Claude Opus 5**, **Claude Haiku 4.5**, **Claude Fable 5**, and **Claude Sonnet 4.6** through `labelOverride`. The companion app and gateway catalog retain the actual backend names. Its underlying family IDs remain compatibility aliases. The following three live results predate the five-slot update:

| Claude alias | Selected upstream | Live result |
| --- | --- | --- |
| `claude-sonnet-5` | `ollama-local/ornith:9b` | HTTP 200, `BRIDGE_OK` |
| `claude-opus-5` | `ollama-local/ornith:9b` | HTTP 200, `BRIDGE_OK` |
| `claude-haiku-4-5-20251001` | `ollama-local/ornith:9b` | HTTP 200, `BRIDGE_OK` |

Each request sent the actual upstream model ID, while responses retained the client-facing alias. The HTTP/SDK regression now assigns five distinct backends and checks each slot dispatches independently and advertises its actual backend label. Sonnet 4.6 shares the Sonnet family but is not its default; bare `sonnet` resolves to Sonnet 5. These are routing aliases; changing a label does not grant model access or make another model a Claude model.

Ollama was initially stopped. Starting the installed Ollama app restored its local endpoint and Claude's setup check succeeded. The bridge does not yet supervise the Ollama service.

Claude's actual Effort submenu was inspected after a graceful restart: **Low, Medium, High** are present, with the existing Medium selection preserved. Each level was also accepted by Ornith's native Messages endpoint (HTTP 200, approximately 0.9–1.9 seconds for an eight-token probe). Acceptance proves the control is passed and recognized, not a quality or performance difference between levels. The profile cap derives from explicit OpenCode effort variants or installed Ollama thinking capability, instead of a hardcoded Low. Chat routes translate advertised `reasoningEffort` variants to `reasoning_effort`; unsupported explicit thinking budgets and unadvertised higher levels still fail. Signed Anthropic thinking history is not translated.

## OpenCode free models

All seven currently advertised zero-cost OpenCode Zen models appear in discovery and the GUI's unfiltered list. The **Ready to connect** filter hides unavailable models.

| Model | Result |
| --- | --- |
| Big Pickle | Live HTTP 403 `FreeTierError` |
| Ling 3.0 Flash Fin Free | Live HTTP 403 `FreeTierError` |
| MiMo V2.5 Free | Live HTTP 403 `FreeTierError` |
| Nemotron 3 Ultra Free | Live HTTP 403 `FreeTierError` |
| Nemotron 3.5 Lightning Free | Live HTTP 403 `FreeTierError` |
| Muse Spark 1.2 Free | Discovered, disabled: Responses adapter not implemented; inference not tested |
| Muse Spark 1.3 Free | Discovered, disabled: Responses adapter not implemented; inference not tested |

The five tested free endpoints restrict usage to OpenCode itself. The GUI disables them with an explanation, and the gateway classifies the restriction without echoing provider bodies or secrets. No bypass is implemented. `opencode/union-alpha` was also checked separately and returned HTTP 401; it was absent from the current zero-cost catalog snapshot.

**The main goal of Zen free models in Claude Desktop remains blocked.** Big Pickle also failed with HTTP 403 when run through the genuine installed OpenCode CLI v1.18.31 in an isolated directory with tools denied. The official latest release is also v1.18.31. Similar failures in the official client are reported in [OpenCode issue 49431](https://github.com/anomalyco/opencode/issues/49431) and [49438](https://github.com/anomalyco/opencode/issues/49438); these reports do not establish a supported external integration or a vendor resolution. OpenCode's documented SDK exposes agent sessions, rather than a drop-in Anthropic inference API. An execution adapter would first need a successful genuine free-model session and then validation of Claude's history, cancellation, and client tool/result lifecycle. That prerequisite did not pass, so no unverified execution adapter or client-header spoof is shipped.

Local Ollama models are a separate zero-cost source. Two installed tool-capable models were discovered. Three simple live requests to the selected `ornith:9b` backend completed in roughly 0.6–2.4 seconds with thinking disabled. This does not measure Desktop's much larger agent prompt or verify every advertised provider connection.

## Desktop compatibility fixes

The actual Desktop test found issues that the original SDK smoke did not exercise:

1. Anthropic's beta SDK posts to `/v1/messages?beta=true`. Routing now matches the path independently of query parameters, including beta token counting and model listing. Individual `/v1/models/<id>` lookup is implemented.
2. Desktop requested `max_tokens: 64000` for a backend configured for 4096 output tokens. The gateway now caps this upper bound to the selected backend budget, reports the effective cap in `x-bridge-max-tokens`, and adjusts an oversized explicit native thinking budget to remain below that cap. Invalid/nonpositive budgets still fail. Input/context limits remain enforced; no prompt is truncated.
3. Desktop's retry history contained inline `system` notices. Text and cache metadata are preserved in the top-level Anthropic system field; user/assistant turns remain in their original order.

Safe operational logs contain route/backend, status, timing, requested/effective output budgets, estimated input size, tool count, and recognized thinking mode. Message text, tool inputs, provider bodies, and credentials are not logged. Temporary role tracing was removed.

## Checks and limits

### Apps panel and lifecycle

- The installed Applications panel was visually inspected with all five selectors and the Auto mode switch. Apply & Restart completed through its real UI, and the actual Claude picker displayed all five entries. Existing Ornith assignments and the saved Opus High preference were preserved; Auto mode remained off.
- The full Quit dialog displayed Disconnect & Quit, Keep Connected & Quit, and Cancel. Cancel was exercised and kept the application and connection active. Closing a window hides the companion; it does not change Claude's saved profile or stop the detached gateway.
- Disconnect & Quit restores the original profile, gracefully restarts Claude, stops the owned gateway, and quits only after success. Restore conflicts or an active gateway request keep Bridge open. Actual final Disconnect & Quit and Keep Connected & Quit were not exercised in this check because the user began editing a model assignment and had an active inference request. Their session and draft were left intact; recovery and shutdown behavior are covered by isolated tests and the packaged gateway smoke.
- Applying changed mappings restores the old Bridge profile before creating a new journal, so the next Disconnect still restores the original connection. Tests cover original-state retention, a single restart, external-edit conflicts, gateway-preparation failure, and refusal to mutate while inference is active.
- Auto mode configures Claude's documented `autoModeEnabled` setting; availability depends on model safety-classifier support and Desktop version. It does not certify that a substituted model supports Auto mode. See the [Claude configuration reference](https://claude.com/docs/third-party/claude-desktop/configuration).
- A fresh 15-second native Sonnet marker probe timed out during this check, before the new Fable/Sonnet 4.6 live probes ran. Their routing is verified with fixture HTTP/SDK requests and their listing with the actual UI; successful live inference through those two aliases is not claimed.

- Production TypeScript checks and the automated test suite cover protocol, recovery, five-slot mappings, effort capabilities, and client lifecycle. The latest totals are recorded in BUILD_STATUS.md.
- Renderer checks and application compilation passed.
- The installed bundled runtime passed background start/reuse, fixture inference, profile preview, and shutdown using disposable state without changing actual Desktop settings.
- The final packaged build in `release-verified/mac-arm64/OpenCode Bridge.app` passed the same isolated runtime smoke on retry. An initial attempt hit its 30-second startup deadline. Separate system Node, bundled Electron-as-Node, and packaged CLI help controls completed successfully (approximately 1.0, 8.1, and 7.1 seconds); they do not establish the cause of the timeout. The final package adds a Quit guard during connection actions and an injectable lifecycle test seam. It remains staged to preserve the user's active chat and unsaved model assignment; the installed build already contains the five-selector panel and Quit choices.
- Actual Desktop basic chat passed on automatic retry: the verification conversation visibly completed `BRIDGE_OK`, followed by two completed user chat turns. The first large cold request exceeded the five-minute upstream deadline (300,033 ms; 28 tools, adaptive thinking, estimated 24,663 input tokens, effective 4,096-token output cap). Cold latency remains a limitation. Code, Cowork, and a real Desktop permission/tool/result cycle remain unverified.
- The rebuilt app was installed to `/Applications/OpenCode Bridge.app` and opened with the saved local selection preserved. Its packaged source was checked for the beta-path, output-cap, model-lookup, and system-notice fixes, and absence of temporary role tracing. Its bundled-runtime smoke passed again.
- Hosted API-key routes, OAuth, Responses, Google, Go, signed packaging, and provider-specific options are not certified by these checks.
