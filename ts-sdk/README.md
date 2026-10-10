# @hypercli.com/sdk

TypeScript SDK for HyperCLI API - GPU cloud compute made simple.

## Installation

```bash
npm install @hypercli.com/sdk
```

**Dependencies:**
- `ws` - WebSocket client for log streaming
- Node.js 18+ (uses native `fetch`)

## Vanilla ACP v1 (breaking API change)

ACP permission callbacks (`onPermissionRequest`, `setPermissionHandler`) and the
exported `RequestPermissionRequest` use the upstream v1 shape: `request.toolCall`.
All offered permission options reach the callback, including unfamiliar kinds.
Without a handler,
the SDK answers `cancelled`; it never chooses a permission automatically.

Session setup and configuration retain native v1 shapes, including
`configOptions[].id` and native `modes`. `setConfigOption(sessionId, option.id, value)`
sends the standard v1 request. Optional runtime capabilities are not guaranteed.

Concurrent `prompt` calls each own their correlated native terminal result.
They do not require REST receipts, and uncertain input is never resent.
Use `AcpTurnDriver` when the consumer wants serialized turns.

## Quick Start

```typescript
import { HyperCLI } from '@hypercli.com/sdk';

// Initialize client (uses HYPER_API_KEY from env or ~/.hypercli/config)
const client = new HyperCLI();

// Or pass API key directly
const client = new HyperCLI({ apiKey: 'your_key' });

// Check balance
const balance = await client.billing.balance();
console.log(`Balance: $${balance.total}`);

// Launch a GPU job
const job = await client.jobs.create({
  image: 'nvidia/cuda:12.0-runtime-ubuntu22.04',
  gpuType: 'l40s',
  gpuCount: 1,
  command: 'python train.py',
  dryRun: true,
  env: { MODEL: 'llama-3' },
});

console.log(`Job started: ${job.jobId}`);
console.log(`Hostname: ${job.hostname}`);
```

## Configuration

Set your API key via:
1. Environment variable: `export HYPER_API_KEY=your_key`
2. Config file: `~/.hypercli/config`
3. Constructor: `new HyperCLI({ apiKey: 'your_key' })`

```typescript
import { configure } from '@hypercli.com/sdk';

// Save to ~/.hypercli/config
configure('your_api_key');
```

## Examples

### Platform session metadata

```typescript
// The platform ID returned by /ws/acp session/new or the REST session catalog.
const session = await client.sessions.getSession(platformSessionId);
console.log(session.source, session.summaryText, session.participants);
```

Returns the `AcpSessionState` shape — the `AcpSessionRecord` catalog record
extended with `importOutcome` and platform history state (`lastMessageId`,
`messageCount`, `headSeq`, per-message `receipts`). This calls
`GET /agents/sessions/{id}` with the current caller's credentials;
runtime/leg IDs are not resolved. `source` is `string | null` and unknown values
are preserved. It reads stored metadata even while the agent is offline, without
connecting to the runtime. It advances the caller's user read receipt to the
session head; transcript pages use `getMessages` independently of ACP.
HTTP errors propagate as
`APIError`: 404 unknown session, 403 outside participation scope, 422 invalid UUID.

### Complete history pages

```typescript
const page = await client.sessions.getMessages(platformSessionId, { limit: 20 });
// { items: AcpSessionMessage[], nextCursor: string | null,
//   hasMore: boolean, importOutcome: SessionImportOutcome | null }
const older = page.hasMore
  ? await client.sessions.getMessages(platformSessionId, { cursor: page.nextCursor })
  : null;
```

This canonical helper normalizes platform DTO fields only. Native v1 ACP payloads,
message/tool IDs, complete non-binary tool fields, and separate platform identities
are retained. Rows are descending by sequence; readers fold ascending. The default
limit is 20, a target the server may extend for chunk runs and transitive tool
creation dependencies. The opaque cursor reads strictly older rows.

A page is delivered as one coherent result; it is not a transaction with a live
subscription and promises no zero-gap boundary. Keep fetched history and live
notifications independently owned. No SDK renderer, compatibility decoder, replay
cache, or ACP pagination extension is involved.

### Billing

```typescript
const balance = await client.billing.balance();
const txs = await client.billing.transactions(limit: 10);
```

### Jobs

```typescript
// List running jobs
const jobs = await client.jobs.list('running');

// Get job details
const job = await client.jobs.get(jobId);

// Cancel job
await client.jobs.cancel(jobId);

// Get logs
const logs = await client.jobs.logs(jobId);

// Get metrics
const metrics = await client.jobs.metrics(jobId);

// Non-interactive exec
const execResult = await client.jobs.exec(jobId, ['nvidia-smi']);

// Interactive shell WebSocket
const ws = await client.jobs.shellConnect(jobId, '/bin/bash');
ws.close();
```

### Agents Exec/Shell

```typescript
const models = await client.agent.models();
const activation = await client.agent.redeemGrantCode('PROMO123');
const renewal = await client.agent.redeemGrantCode('PROMO123', { extendExisting: true });

// Execute command in a hypercli-openclaw agent container
const agentExec = await client.agents.exec(agentId, ['ls', '-la']);

// One live Reef metrics sample
const agentMetrics = await client.agents.metrics(agentId);

// Interactive shell for a hypercli-openclaw agent
const agentWs = await client.agents.shellConnect(agentId);
agentWs.close();
```

### Account Avatar and Per-Agent Usage

```typescript
const currentAvatar = await client.user.getProfileImage();
const updatedAvatar = await client.user.uploadProfileImage(imageBlob);
await client.user.deleteProfileImage();

const dailyByAgent = await client.agent.agentUsage(1);
```

Agent payloads also carry per-agent identity media: `Agent.avatarUrl` and, when
a voice reference has been uploaded, `Agent.avatarAudioUrl` (hydrated from the
backend's `avatar_audio_url`, mirroring `avatarUrl`; `null` when unset).

Plan IDs remain open strings so future and historical IDs keep parsing.
`plan.canonicalId` recognizes the current `solo`, `team`, and `pro` IDs.
Use the agents entitlement summary—not Orchestra `auth_me`—for plan access:

```typescript
import { hasActivePlan } from '@hypercli.com/sdk';

const summary = await client.agent.subscriptionSummary();
if (hasActivePlan(summary)) { // subscription OR direct entitlement
  console.log(summary.agentSlots);
}
```

A `401` or `403` from the summary means the selected key cannot determine plan
state. Consumers should represent that as unknown, never as an explicit no.

### OpenClaw Agents

OpenClaw uses the generic deployment launch surface. `registryUrl`,
`registryAuth`, and `syncRoot` are generic deployment options. A nonblank
`syncRoot` enables Reef persistence. On generic create, no include/exclude
policy means the complete root; `syncExclude: []` also excludes nothing.
`syncInclude: []` and root-wide excludes such as `syncExclude: ["*"]` are
invalid.
Steady Reef synchronization is PVC-to-object-storage upload/overwrite, not a
two-way mirror: ordinary filesystem deletes are not propagated, and
remote-to-PVC copying occurs only during explicit cold restore. Files API
operations obtain a fresh files-scoped credential from Backend and then call
the retained Reef server directly; Backend never carries file bytes.
Per-file writes are limited to 100 MiB (`AGENT_FILE_WRITE_MAX_BYTES`, the
Cloudflare edge request-body cap on the agent hostname); split larger data
across files or sync it via the agent's own tooling. File
paths are relative to `syncRoot`, and `filesList("")` lists the complete root, including
dot-directories. The OpenClaw helpers add concrete
image, `syncRoot: "/home/node"`, and cache/Workspace exclusions by default;
there is no public `openclaw` route (the pod gateway binds loopback with auth
mode `none` as an ACP hop only; pro adds the protected `desktop` route).
Regular OpenClaw defaults to `ghcr.io/hypercli/hypercli-openclaw:prod`;
desktop/pro OpenClaw defaults to `ghcr.io/hypercli/hypercli-openclaw:pro-prod`.
Coding helpers instead inject the runtime-specific include defaults
documented in
[`coding-runtimes.mdx`](../docs/agents/coding-runtimes.mdx); pass an explicit
nullable policy at create time to select the whole root.
Both helper families default `HYPER_WORKSPACES_DIR` to `/home/node/shared` and
preserve an explicit value supplied in the launch `env`.

```typescript
const launchConfig = buildAgentConfig({}, {
  image: 'ghcr.io/example/agent:latest',
  registryUrl: 'registry.example.com',
  registryAuth: { username: 'ci', password: 'token' },
}).config;
const agent = await client.deployments.create({
  name: 'docs-demo',
  image: launchConfig.image,
  registryUrl: launchConfig.registry_url,
  registryAuth: launchConfig.registry_auth,
});
await client.deployments.waitForState(agent.id, ['STOPPED'], 330_000);
await client.deployments.update(agent.id, { launchConfig });
await client.deployments.start(agent.id);
const running = await client.deployments.waitForState(
  agent.id,
  ['RUNNING'],
  300_000,
  ['FAILED'],
);

const capacity = await client.deployments.listWithCapacity();
console.log(capacity.maxAgentsPerAccount, capacity.runningAgents);
for (const slot of capacity.agentSlots) {
  console.log(slot.size, slot.planId, slot.agentId);
}
```

`start()` starts the Backend-stored launch config. Change
launch settings through `update(..., { launchConfig })` before starting.
`start()` does not accept launch mutation options such as
`launchConfig`, `controlUiAllowedOrigins`, or `trustedProxies`.

`archive()` returns the accepted `ARCHIVING` Agent projection. `delete()` uses
HTTP 200 to accept a durable soft delete; cluster-local cleanup continues in
the background, so that response is not cleanup completion.

`list()` remains the compatibility array. `listWithCapacity()` preserves the
full deployment response: saved/running account limits, pooled TPD, aggregate
slot inventory, and individual entitlement-backed agent slots.

Deployment lifecycle snapshots use an open-string `state`. `reason` is the
stable cause of a transition, such as `start`,
`api_stop`, `runtime_exit`, `timeout`, or `delete`; `error` is populated for a
failed transition, while `message` is human-readable context. Consumers should
not bind these strings to a closed client-side enum.

Canonical states are `CREATING`, `STARTING`, `RESTORING`, `RUNNING`, `STOPPING`,
`STOPPED`, `ARCHIVING`, `ARCHIVED`, `FAILED`, and `DELETED`. `CREATING` is fresh
admission, `STARTING` resumes a warm retained agent, and `RESTORING` hydrates a
cold agent from its exact archive checkpoint.
`STOPPED` is warm and `ARCHIVING` is transitional. `ARCHIVED` is the
Backend-persisted, cold-restorable terminal projection after Lagoon drops its
agent task, namespace, PVC, and local S3 copy. `DELETED` is a Backend-only
terminal state and normally absent from user reads.

For a long-lived UI, subscribe to thin invalidations and refresh REST in the
handler:

```typescript
const controller = new AbortController();
const subscription = client.deployments.subscribe(async () => {
  render(await client.deployments.list());
}, {
  signal: controller.signal,
  onReady: async () => render(await client.deployments.list()),
});

// During application teardown:
controller.abort();
await subscription;
```

Abort during teardown. `onReady` runs after user-stream authentication and
before event frames are read; it repeats that order after reconnect.
Transition events carry `agent_id` for local filtering plus `state`, `reason`,
`error`, and `message`, but are not snapshots and may be duplicated or
coalesced; refresh REST for authority.

Use `createAgent('openclaw-pro', ...)` or `update(..., { launchConfig })` to persist the desktop/browser image. The pro launch config selects `ghcr.io/hypercli/hypercli-openclaw:pro-prod`, enables noVNC through the protected `desktop-<agent>.hypercli.app` route, and sets `HYPER_DESKTOP_ENABLED=1`.

For a running desktop-enabled agent, `client.deployments.desktopUrl(id)` returns
a JWT-signed URL that logs straight into the noVNC page: it builds
`<base>/_jwt_auth?jwt=…&redirect=vnc_lite.html`. `vnc_lite.html` is the default
redirect target (immediate RFB handoff, no connect screen); the builder accepts
any relative page via `BrowserDesktopUrlOptions.redirect`, and
`BrowserDesktopUrlOptions.resize` (default `'scale'`) renders as `scale=true`
for the lite pages (`vnc_lite.html`, `vnc_auto.html`) and as `resize=…` for
full-UI pages such as `vnc.html`. An already-minted token can be applied with
`agent.browserDesktopUrl(token, options)`; both resolve to `null`/`throw` when
the agent has no desktop route or is not running.

```typescript
const { url, expiresAt } = await client.deployments.desktopUrl(agent.id);
// e.g. https://desktop-<agent>.hypercli.app/_jwt_auth?jwt=…&redirect=vnc_lite.html%3Fscale%3Dtrue
```

### OpenClaw control-UI allowed origins

An OpenClaw agent records the browser origins allowed to drive its control UI
in the `OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN` launch env. OpenClaw treats this env
as a comma-separated full replacement for `gateway.controlUi.allowedOrigins`,
with `*` allowing any origin. Stored values predate a single canonical writer,
so the value can exist in three shapes (space-separated, comma-separated, JSON
array). The helpers in
`@hypercli.com/sdk/openclaw/control-ui-origin` are pure parsing/normalization:
`normalizeControlUiOrigin()`, `parseControlUiAllowedOrigins()`, and
`mergeControlUiAllowedOrigins()`. `normalizeControlUiOrigin()` is display-only;
the launch env is user-controlled and is not scheme-validated by the SDK.
The OpenClaw create path always writes the wildcard replacement
(`OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN='*'`): every HyperCLI surface (desktop,
console) drives the control UI from dynamic origins, and the wildcard is the
only value that lands reliably. `resetRuntimeDefaults(...)` restores the same
wildcard.

`OPENCLAW_TRUSTED_PROXIES` is likewise a comma-separated full replacement for
OpenClaw `gateway.trustedProxies`. Use `buildOpenClawTrustedProxiesEnv([...])`
to build the launch env.

Automatic memory indexing is off by default. Opt in with `memoryIndex: { onSessionStart: true, onSearch: true, watch: true, watchDebounceMs: 30000, intervalMinutes: 0 }`.

### ACP v1 conversation operations

The Backend `/ws/acp` surface and native runtime leg use vanilla v1.
The SDK uses `@agentclientprotocol/sdk` 1.5.0's v1 construction and types.

```typescript
const acp = await agent.acpConnect({ onUpdate: handleSessionUpdate });
const { sessionId } = await acp.newSession({ cwd: '/home/node' });
const result = await acp.prompt(sessionId, [{ type: 'text', text: '  /plan\n' }]);
// result.stopReason is this native prompt's terminal result.
await acp.resumeSession(sessionId);
await acp.cancel(sessionId); // standard notification; never a replacement prompt
```

`prompt()` remains outstanding through callbacks and updates until its real
terminal response. Native text/thought chunks, tool creation and patches, plans
and configuration notifications are delivered directly. Platform source/title,
history identities and reader receipts remain on REST.
Unknown legacy workspace setup is not guessed into ACP catalog entries.

History pages use `SessionsAPI.getMessages`; ACP has no custom history-window
options. Reconnect reattaches tracked sessions with supported `session/resume`
and never resends a turn. Explicit `loadSession` uses v1 `session/load`; managed
native reconciliation belongs to Backend and is never driven by scrolling.

`AcpTurnDriver` serializes one queued submission per prompt, preserving all
content blocks. Its commit hook runs after verified completion and before
settling the submission or sending the next one. Cancelled completion pauses
the queue until a new explicit submission. Prompt observation or commit failure
fences the driver: pending and later submissions reject without resending input.

### Managed Coding Agents and Buzz ACP

Native Buzz Agent, OpenCode, Codex, Claude Code, Goose, and Kimi Code use
explicit managed runtime
discriminators while retaining the standard HyperCLI launch behavior: API-base
env injection, workspace boot sync, and persistent `/home/node` storage. They
do not receive an OpenClaw gateway token. OpenCode and Goose default to the
Anthropic-native `default-anthropic` route (currently `kimi-k3-anthropic`); Kimi Code uses Moonshot's
upstream login and service.
Claude Code, Codex, and Kimi Code are native-login-first. For Buzz-managed
launches, `HYPERCLI_RUNTIME_INFERENCE=hypercli` is an explicit compatibility
switch for Claude and Kimi. The gateway now exposes `/v1/responses`, and Buzz
compatibility mode renders Codex with `wire_api="responses"`; a successful
HyperCLI-model Codex Responses E2E remains unvalidated, so that path is not yet
advertised as supported. See the
[runtime and persistence matrix](../docs/agents/coding-runtimes.mdx).

```typescript
const agent = await client.deployments.createCodingAgent('opencode', {
  name: 'buzz-ci',
  buzz: {
    privateKeyNsec: agentNsec,
    relayUrl,
    authTag: ownerSignedAuthTag,
  },
  workspacesSync: { workspace: 'buzz' },
});

const methods = await agent.auth.methods();
const status = await agent.auth.status();
const login = await agent.auth.login({ method: 'device' });
// login.verificationUrl and login.userCode are populated from terminal output.
const authenticated = await login.wait();
await agent.auth.logout();
```

Runner and Lagoon inject consistent defaults for `HYPER_API_BASE`
(product/inference), `HYPER_AGENTS_API_BASE` (direct Agent control), the
appropriate ACP URL, and agent-scoped `HYPER_AGENTS_API_KEY`.
Customers may override either base and supply canonical `HYPER_API_KEY`
through launch `env` or `secrets`, including for managing other agents. Clients
prefer an explicit canonical credential, environment `HYPER_API_KEY`, then the
configured canonical key before the platform runtime fallback. The launch
owner's auth key is never automatically forwarded.
The Agents base never selects inference. External inference URLs/keys must not
implicitly redirect platform callbacks or reconnects. Explicit `HYPER_ACP_WS_URL`
wins; otherwise derive from the Agents base, using the product base only when
no Agents base is supplied. ACP authentication uses the separate runtime key.

Authentication is runtime-specific rather than one universal login protocol.
Native Buzz Agent has no separate login step and uses its injected model and
provider configuration. `methods()` returns supported native commands: OpenCode
provider login, Codex device login, and Claude Code's Claude.ai, Console and SSO
login. Status uses the native OpenCode, Codex or Claude command. Buzz, Goose,
Kimi and Pi status discovery is unsupported through this SDK surface and raises
an error; use their native runtime authentication interface. No plugin probe or
fallback `authenticate` command is launched. Goose and Kimi expose no
noninteractive logout through this surface.

All seven runtimes launch through one helper, `createCodingAgent(runtime,
...)` — `buzz-agent`, `opencode`, `codex`, `claude-code`, `goose`,
`kimi-code`, and `pi`. Set
the typed `buzz` object to derive the canonical child command, arguments,
native harness and Buzz-owned environment. `buzzEnabled`
remains as a deprecated raw-environment compatibility path. Both forms are
mutually exclusive with an explicit `command`.
Buzz launches keep the runtime's normal default image; only native Buzz
Agent's runtime image is already `hypercli-buzz-agent`. An explicit `image`
continues to override the default.

Buzz launches keep `/home/node` as the persistent Files API and credential
root, reserve `/home/node/shared` for Workspace projections, and run
`hyper-acp` from the specialized `/home/node/.buzz` nest. The image reconciles
the nest after the home mount. OpenCode and Codex consume its canonical
`AGENTS.md`; Claude Code receives `CLAUDE.md -> AGENTS.md`.
The Buzz plugin supplies no compiled prompt or context-injection asset.

The typed `buzz` renderer writes model and response-policy values but does not
duplicate the stock Desktop provider's validation; invalid combinations are
rejected later by `hyper-acp`. The Desktop provider also maps structured Goose
model/provider fields to `GOOSE_MODEL`/`GOOSE_PROVIDER`; direct TypeScript SDK
callers must set any Goose-specific environment themselves.

Buzz launches default `size` to `'large'` (only `'large'` or `'medium'` are
accepted) and force `restart: false`;
ordinary coding-agent launches preserve a caller-provided size or the backend
default. Stock Buzz provider agents do not
start on app launch and the current provider protocol has no stop callback.
Editing a running agent does not replace its HyperCLI launch environment: stop
the deployment through the authenticated HyperCLI API and deploy it again from
Buzz to apply changes. A successfully delivered and accepted `!shutdown` can
exit a new `restart: false` launch; the hosted terminal-state observer then
reports `stopping`, completes runtime cleanup, marks the deployment `stopped`,
and releases its slot. Desktop receives no provider acknowledgement and keeps
its local deployed record.

Stock Buzz expects ACP NDJSON. It skips non-JSON child stdout and there is no
plaintext fallback; the hosted connector auto-publishes completed assistant
text to the channel (see `docs/agents/buzz.mdx` → “Message behavior”). The
six-runtime SDK coverage validates request rendering, not live launches.

The agent nsec and caller environment become raw deployment environment values.
The agents backend currently persists them in `Agent.launch_config`, and
authenticated deployment read, environment, or exec surfaces may expose them.
The default `RUST_LOG` filter disables `acp::stream` content logging; overriding
it can expose generated text in container logs.

Persisted launch values can be changed one key at a time while an agent is
stopped:

```typescript
await agent.setEnv('LOG_LEVEL', 'debug');
await agent.deleteEnv('LOG_LEVEL');
await agent.setSecret('SERVICE_TOKEN', token);
await agent.deleteSecret('SERVICE_TOKEN');
```

Secret mutations return metadata only and never echo the secret value.

`client.agent.redeemGrantCode()` redeems a promo/activation code and returns the applied grant plus the resulting entitlement. Codes create new entitlements by default; pass `extendExisting: true` only for renewal/extension behavior.

### Renders (Managed AI Workflows)

```typescript
// Text to image
const render = await client.renders.textToImage({
  prompt: 'a cat wearing sunglasses',
  width: 1024,
  height: 1024,
});

// Text to video
const video = await client.renders.textToVideo({
  prompt: 'a cat walking through a garden',
});

// Check status
const status = await client.renders.status(render.renderId);
```

### File Uploads

```typescript
// Upload local file
const file = await client.files.upload('./image.png');

// Upload from URL
const file = await client.files.uploadUrl('https://example.com/image.png');
await client.files.waitReady(file.id);

// Use in renders
const render = await client.renders.imageToVideo({
  prompt: 'dancing',
  fileIds: [file.id],
});
```

### Log Streaming

```typescript
import { streamLogs } from '@hypercli.com/sdk';

await streamLogs(client, jobId, (line) => {
  console.log(line);
});
```

### ComfyUI Workflows

```typescript
import { ComfyUIJob, applyParams, graphToApi } from '@hypercli.com/sdk';

// Launch ComfyUI instance
const comfy = await ComfyUIJob.createForTemplate(client, 'flux-dev', {
  gpuType: 'l40s',
  lb: 8188, // HTTPS load balancer
  auth: true,
});

// Wait for ready
await comfy.waitReady();

// Load and modify workflow
const workflow = JSON.parse(fs.readFileSync('workflow.json', 'utf-8'));
applyParams(workflow, {
  prompt: 'a beautiful landscape',
  seed: 42,
  steps: 20,
});

// Execute workflow
const response = await fetch(`${comfy.baseUrl}/prompt`, {
  method: 'POST',
  headers: { ...comfy.authHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: workflow }),
});
```

## API Reference

### Client

- `client.billing` - Billing API
- `client.jobs` - Jobs API
- `client.user` - User API
- `client.instances` - GPU instances, types, regions, pricing
- `client.renders` - Render API
- `client.files` - File upload/download
- `client.keys` - API keys management
- `client.agent` - hosted inference API
- `client.agents` - hosted agents `hypercli-openclaw` exec/shell API

### Job Helpers

- `BaseJob` - Base class for GPU jobs
- `ComfyUIJob` - ComfyUI-specific helpers
- `GradioJob` - Gradio-specific helpers

## License

MIT
