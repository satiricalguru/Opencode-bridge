# Build status

Updated 17 September 2026. Initial implementation: `opencode-claude-bridge` 0.1.0.

## Delivered

- TypeScript gateway that binds to authenticated native loopback clients on a separate configurable port.
- OpenCode CLI model discovery and a limited v1 provider/configuration/API-key importer, including local unauthenticated model connections.
- Stable Sonnet/Opus/Haiku route mapping with visible actual backend names.
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
| `npm test` | 27 passed, 0 failed | Protocol/recovery tests plus GUI orchestration, local discovery, action serialization, client registry gating, and IPC validation |
| `npm run check:ui` and `npm run build:app` | Passed | Typed React renderer and compiled app assets |
| `npm run build` | Passed | Compiled CLI/gateway with declarations and source maps |
| `npm run smoke:launcher` | Passed | Real background subprocess start/reuse, one local fixture inference request, status/preview, stop, isolated state |
| `opencode/union-alpha` live request | HTTP 403 `FreeTierError` | Native Anthropic access restricted to OpenCode itself |
| `opencode/big-pickle` live request | HTTP 403 `FreeTierError` | Chat Completions access restricted to OpenCode itself |
| `bridge-local/ornith:9b` live smoke | Passed | Installed Ollama model, temporary OpenCode connection, streamed client-tool call/result/final answer, Anthropic SDK client |
| `bridge-local/ornith:9b` native Anthropic live smoke | Passed | Ollama Messages endpoint, streamed client-tool round trip, 376 input tokens and 108 output tokens; slow run of approximately 205 seconds |
| Packaged desktop interface | Opened and inspected | Model picker displayed 622 discovered models, 119 credential/protocol-compatible choices, and installed Claude status |
| Installed application | Opened and inspected | `/Applications/OpenCode Bridge.app`; model search and application registry checked, saved local selection preserved |
| Packaged gateway runtime | Passed | Bundled Electron runtime started/reused the detached gateway, completed fixture inference, previewed a profile, and stopped using disposable state without changing Desktop settings |
| Actual Claude launch from GUI | Profile loaded | Actual Desktop showed OpenCode Bridge and the selected `ornith:9b` model in its picker; initial connectivity checks on the Chat route cancelled around 10 seconds |

The local tool round trip completed in approximately 28 seconds, reporting 418 total input tokens and 179 output tokens. Its test tool only adds two numbers; no external tool action was executed. The temporary OpenCode connection was removed afterward. `.bridge/live-smoke-results.json` contains metadata for the latest live run and is ignored by source control.

No upstream API keys were copied into project artifacts, and no existing OpenCode auth/configuration file was rewritten. Initial fixture/SDK tests used temporary Desktop config trees. During GUI inspection the user activated the actual local model connection from the app. That active selection was preserved; the local gateway was updated to use Ollama's native Messages endpoint without changing its selected backend or Desktop profile. Background fixture processes were stopped and disposable state removed. The user's active integration gateway remains running.

## Remaining work

The implementation establishes the gateway/launcher foundation. **The original Phase 0 Desktop exit gate has not passed.** SDK tests are not proof of actual Desktop Chat, Code, or Cowork behavior.

1. Connect the actual Desktop app to an accessible native Anthropic route and a translated route. Record its auxiliary requests and automatic thinking/output/server-tool fields, verify a real Desktop permission/tool/result cycle, and restore its prior connection.
2. Adjust version-specific aliases and capabilities based on those observations. Chat's current rejection of explicit Anthropic thinking may need a product-level model capability setting or a validated adapter extension.
3. Verify a hosted API-key route and applicable provider headers/options; Zen free-tier catalog visibility cannot be treated as permission to use those routes externally.
4. Complete end-to-end packaged UI/client validation and inference-level access checks. The model picker and save/launch/restore interface now exist; catalog/auth availability is distinct from verified upstream connectivity.
5. Complete provider option semantics, managed-policy checks, crash supervision, credential-helper/Keychain integration, signed packaging, and supported-version regression coverage before release.

OAuth/Go/Responses/Google provider runtimes remain deferred as described in the implementation plan. A route appearing in discovery is metadata, not a compatibility certification.
