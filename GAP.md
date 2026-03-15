# SDK Feature Parity Gap

This file compares the current public surfaces of:

- `ts-sdk` (`@hypercli.com/sdk`)
- `sdk` (`hypercli-sdk`)

Scope:

- public exports
- major client namespaces
- notable helper methods that affect user-facing capability

Non-goals:

- private helpers
- purely idiomatic naming differences like `snake_case` vs `camelCase`
- implementation quality differences unless they change what a user can do

## Summary

The Python SDK is still broader in end-user capability. The biggest missing areas in `ts-sdk` are:

- x402 support
- async helper classes and shell session helpers
- HyperAgent convenience chat/OpenAI client helpers
- advanced ComfyUI execution and node-management helpers
- higher-level deployment streaming helpers

The TypeScript SDK is ahead in a few areas:

- exported configuration helpers and defaults
- public deployment config builder
- gateway trusted pairing/browser-oriented features
- a constructor-level HTTP timeout option

## Present In `ts-sdk` But Not In `sdk`

### Public configuration exports

Available in `ts-sdk`, not exported by `sdk`:

- `getApiKey()`
- `getApiUrl()`
- `getWsUrl()`
- `DEFAULT_API_URL`
- `DEFAULT_WS_URL`

Python has equivalent internals in `hypercli.config`, but they are not part of the package's public export surface.

### Public `HTTPClient` export

Available in `ts-sdk`:

- `HTTPClient`

Python exports `AsyncHTTPClient`, but not the sync `HTTPClient` class.

### Client timeout option

Available in `ts-sdk`:

- `new HyperCLI({ timeout })`

Python `HyperCLI(...)` does not expose a client-level timeout argument.

### Public deployment config builder

Available in `ts-sdk`:

- `buildAgentConfig()`

Python has `_build_agent_config(...)`, but it is private and not exported.

### Gateway trusted pairing and browser/client identity surface

Available in `ts-sdk`, not present in Python's public gateway client:

- `GatewayPairingState`
- `onPairing`
- `autoApprovePairing`
- `deploymentId`
- `apiKey`
- `apiBase`
- browser/client identity fields such as `clientDisplayName`, `platform`, `instanceId`, `caps`
- persistent pairing storage behavior for pending approvals

This is a meaningful TS-only capability, especially for browser-facing or control-panel integrations.

### Gateway session convenience methods

Available in `ts-sdk`, not currently present in Python's `GatewayClient`:

- `sessionsPreview(sessionKey, limit)`
- `sessionsReset(sessionKey)`
- `sendChat(...)` as a direct RPC-style helper

Python has `chat_send(...)` and `sessions_list(...)`, but not these exact convenience methods.

### Typed deployment and gateway export surface

Available as public TS types, not mirrored as public Python equivalents:

- `AgentListResponse`
- `AgentRouteConfig`
- `RegistryAuth`
- `BuildAgentConfigOptions`
- `CreateAgentOptions`
- `StartAgentOptions`
- `AgentExecOptions`
- `GatewayOptions`
- `GatewayEvent`
- `GatewayEventHandler`
- `ChatAttachment`
- `OpenClawConfigSchemaResponse`

Python has runtime objects and dicts here, but not exported typed schema objects.

## Present In `sdk` But Not In `ts-sdk`

### x402 client and response models

Python-only today:

- `X402Client`
- `X402JobLaunch`
- `X402FlowCreate`
- `X402RenderCreate` alias
- `FlowCatalogItem`

This is the largest product gap. TypeScript users currently have no first-party x402 SDK surface.

### Async file upload client

Python-only:

- `AsyncFiles`
- `AsyncHTTPClient`

The TS SDK supports async by default via promises, but it does not expose a parallel async-only helper surface or async HTTP client abstraction comparable to Python's public exports.

### Shell session helper abstraction

Python-only:

- `ShellSession`
- `shell_connect`

TypeScript users can open raw WebSockets for job and deployment shells, but there is no higher-level shell session wrapper.

### HyperAgent convenience helpers

Python-only on `client.agent`:

- `openai()`
- `chat(...)`

The TS SDK exposes plan/key/model discovery only. It does not provide a first-party OpenAI client wrapper or chat convenience method.

### Jobs tag support

Python-only in the jobs namespace:

- `client.jobs.create(..., tags={...})`
- `client.jobs.list(tags={...})`

`ts-sdk` jobs currently expose:

- `list(state?)`
- `create(...)` without `tags`

This is a real feature gap, not just naming.

### Advanced ComfyUI helper surface

Python-only capabilities on `ComfyUIJob` and related exports:

- `load_template` export
- `expand_subgraphs` export
- `ComfyUIJob.get_instance(...)`
- `ComfyUIJob.get_or_create_for_template(...)`
- `ComfyUIJob.get_available_node_types()`
- `ComfyUIJob.get_workflow_node_types(...)`
- `ComfyUIJob.get_missing_node_types(...)`
- `ComfyUIJob.get_node_mappings()`
- `ComfyUIJob.lookup_packages_for_nodes(...)`
- `ComfyUIJob.get_custom_node_list()`
- `ComfyUIJob.install_packages_by_url(...)`
- `ComfyUIJob.auto_install_workflow_nodes(...)`
- `ComfyUIJob.get_installed_nodes()`
- `ComfyUIJob.install_node(...)`
- `ComfyUIJob.install_nodes(...)`
- `ComfyUIJob.reboot(...)`
- `ComfyUIJob.ensure_nodes_installed(...)`
- `ComfyUIJob.queue_prompt(...)`
- `ComfyUIJob.get_history(...)`
- `ComfyUIJob.wait_for_completion(...)`
- `ComfyUIJob.download_output(...)`
- `ComfyUIJob.run(...)`
- `ComfyUIJob.run_template(...)`
- `ComfyUIJob.get_output_images(...)`

`ts-sdk` currently covers only the lighter workflow-conversion side plus image/audio upload and object-info access.

### Functional Gradio client integration

Python `GradioJob.connect()` returns a working client.

TypeScript `GradioJob.connect()` is intentionally unimplemented and throws.

### Deployment streaming and chat helpers

Python-only on `Deployments`:

- `chat_stream(...)`
- `logs_stream(...)`
- `logs_stream_ws(...)`

TypeScript exposes:

- `logsConnect(...)` returning a raw WebSocket
- no `chat_stream(...)` executor helper
- no SSE log stream convenience wrapper

### OpenClawAgent convenience wrappers

Python `OpenClawAgent` exposes more high-level helpers than the TS version:

- `config_patch(...)`
- `models_list(...)`
- `workspace_files(...)`
- `file_get(...)`
- `file_set(...)`
- `chat_history(...)`
- `chat_send_message(...)`
- `cron_list(...)`

TypeScript `OpenClawAgent` currently exposes a smaller subset:

- `gatewayStatus()`
- `configGet()`
- `configSchema()`
- `sessionsList()`
- `chatSend()`

Users can still drop down to `GatewayClient`, but parity is not there on the agent wrapper.

### Gateway event iteration and extra RPC helpers

Python-only on `GatewayClient`:

- `config_apply(...)`
- `agent_get(...)`
- `cron_run(...)`
- `next_event(...)`
- `events(...)`

TS has overlapping functionality in other forms, but these exact user-facing helpers are missing.

## Shared Areas With Shape Or Behavior Differences

These are not strictly "missing" on one side, but they are not yet parity-equivalent.

### Main deployment list response

`ts-sdk`:

- `client.deployments.list()` returns `AgentListResponse`
- includes `items`
- may include `budget`

`sdk`:

- `client.deployments.list()` returns `list[Agent]`

The shape differs, which matters for shared examples and adapters.

### Config helper exposure

Both SDKs support:

- environment variable resolution
- shared config file resolution
- `configure(...)`

But only TS exports the config getters and defaults as first-class public API.

### Gateway surface emphasis

`ts-sdk` is more control-plane/browser oriented:

- pairing state
- typed events
- client identity metadata

`sdk` is more operations/script oriented:

- async iterator event loops
- `cron_run`
- direct `agent_get`

### Shell ergonomics

Both SDKs can reach job and deployment shells.

Python gives users:

- a shell session abstraction
- more obvious async shell helpers

TypeScript gives users:

- raw WebSocket access
- less built-in ergonomics above the wire format

### Workflow helper maturity

Both SDKs have:

- `BaseJob`
- `ComfyUIJob`
- `GradioJob`
- graph parameter helpers

Python goes much further into:

- full execution lifecycle
- template loading
- custom node inspection/install
- output download helpers

TS is currently better suited to:

- graph transformation
- standing up the service
- making raw HTTP calls to the job once ready

## Suggested Parity Work Order

If the goal is practical parity rather than identical APIs, the highest-value backlog is:

1. Add x402 support to `ts-sdk`
2. Add job tag support to `ts-sdk`
3. Add HyperAgent `chat()` and `openai()`-style convenience helpers to `ts-sdk`
4. Add higher-level deployment log/chat helpers to `ts-sdk`
5. Bring core ComfyUI execution helpers to `ts-sdk`
6. Decide whether Python should also export config getters/defaults and a public deployment config builder
7. Normalize `deployments.list()` response shape across both SDKs

## Notes

- This document compares what is publicly available today, not what may already exist privately in module internals.
- It also does not attempt to force naming parity between Python and TypeScript idioms.
