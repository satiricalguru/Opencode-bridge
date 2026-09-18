# Build status

Updated 18 September 2026. Initial implementation: `opencode-claude-bridge` 0.1.0. See [VERIFICATION.md](VERIFICATION.md) for current live model mapping and free-route checks.

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
- Shared gateway supervisor, desktop service, per-client saved selections, and a desktop client adapter registry. Claude is implemented; ChatGPT is a disabled planned descriptor.
- macOS Apple Silicon `.app` packaging and app icon assets; bundled gateway runtime avoids requiring a separate Node install for the packaged app.

## Validation evidence

| Check | Result | Scope |
| --- | --- | --- |
| `npm run check` | Passed | Strict TypeScript checking of production code |
| `npm test` | 41 passed, 0 failed | Protocol/recovery, GUI orchestration, local discovery, action serialization, registry gating, IPC, beta SDK queries, five-backend slot dispatch, output caps, inline system normalization, effort capabilities, and real client recovery with isolated lifecycle hooks |
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

OAuth/Go/Responses/Google provider runtimes remain deferred as described in the implementation plan. A route appearing in discovery is metadata, not a compatibility certification.
