# @hypercli.com/sdk

TypeScript SDK for HyperCLI API - GPU cloud compute made simple.

## Installation

```bash
npm install @hypercli.com/sdk
```

## Local Development

When working inside `~/dev/hypercli`, link the local TS SDK into the frontend instead of testing against the published package:

```bash
cd ~/dev/hypercli/ts-sdk
npm install
npm run build

cd ~/dev/hypercli/site
npm link ../ts-sdk
```

**Dependencies:**
- `ws` - WebSocket client for log streaming
- Node.js 18+ (uses native `fetch`)

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
const execResult = await client.jobs.exec(jobId, 'nvidia-smi');

// Interactive shell WebSocket
const ws = await client.jobs.shellConnect(jobId, '/bin/bash');
ws.close();
```

### HyperClaw Agent Exec/Shell

```typescript
const models = await client.agent.models();
const activation = await client.agent.redeemGrantCode('PROMO123');
const renewal = await client.agent.redeemGrantCode('PROMO123', { extendExisting: true });

// Execute command in a hypercli-openclaw agent container
const agentExec = await client.agents.exec(agentId, 'ls -la');

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

Plan IDs remain open strings so future and historical IDs keep parsing.
`plan.canonicalId` recognizes the current `solo`, `team`, and `pro` IDs.
Use the HyperClaw entitlement summary—not Orchestra `auth_me`—for plan access:

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

OpenClaw uses the generic deployment launch surface. `registryUrl`, `registryAuth`, `syncRoot`, and `syncEnabled` are generic deployment options; the OpenClaw helpers only add defaults such as routes, image, and `syncRoot=/home/node`.

```typescript
const agent = await client.deployments.createOpenClaw({
  name: 'docs-demo',
  start: true,
  registryUrl: 'git.nedos.co',
  registryAuth: { username: 'ci', password: 'token' },
});
const running = await client.deployments.waitForState(
  agent.id,
  ['RUNNING'],
  300_000,
  ['FAILED', 'RESTORE_FAILED', 'SYNC_FAILED'],
);

const capacity = await client.deployments.listWithCapacity();
console.log(capacity.maxAgentsPerAccount, capacity.runningAgents);
for (const slot of capacity.agentSlots) {
  console.log(slot.size, slot.planId, slot.agentId);
}
```

`list()` remains the compatibility array. `listWithCapacity()` preserves the
full deployment response: saved/running account limits, pooled TPD, aggregate
slot inventory, and individual entitlement-backed agent slots.

For a long-lived UI, subscribe to thin invalidations and refresh REST in the
handler:

```typescript
const controller = new AbortController();
const subscription = client.deployments.subscribe(async () => {
  render(await client.deployments.list());
}, { signal: controller.signal });

// During application teardown:
controller.abort();
await subscription;
```

Abort during teardown. The SDK owns authentication, ready/resync, and
reconnect; events are not snapshots and may be duplicated or coalesced.

Use `createOpenClawPro(...)` for the desktop/browser image. It enables noVNC through the protected `desktop-<agent>.hypercli.app` route and sets `OPENCLAW_DESKTOP_ENABLED=1`.

`heartbeat` maps directly to upstream OpenClaw config at `config.agents.defaults.heartbeat`. Omit it to keep upstream defaults, or pass values such as `heartbeat: { every: '1h', target: 'last' }`.

Automatic memory indexing is off by default. Opt in with `memoryIndex: { onSessionStart: true, onSearch: true, watch: true, watchDebounceMs: 30000, intervalMinutes: 0 }`.

### Managed Coding Agents and Buzz ACP

Native Buzz Agent, OpenCode, Codex, Claude Code, Goose, and Kimi Code use
explicit managed runtime
discriminators while retaining the standard HyperCLI launch behavior: API-base
env injection, workspace boot sync, and persistent `/home/node` storage. They
do not receive an OpenClaw gateway token. OpenCode and Goose default to the
Anthropic-native `kimi-k2.6-anthropic` route; Kimi Code uses Moonshot's
upstream login and service.
Claude Code, Codex, and Kimi Code are native-login-first. For Buzz-managed
launches, `HYPERCLI_RUNTIME_INFERENCE=hypercli` is an explicit compatibility
switch for Claude and Kimi; Codex cannot use the HyperCLI gateway until it
offers the OpenAI Responses wire API. See the
[runtime and persistence matrix](../docs/agents/coding-runtimes.mdx).

```typescript
const agent = await client.deployments.createOpenCode({
  name: 'buzz-ci',
  env: { HYPER_API_KEY: process.env.HYPER_API_KEY! },
  buzz: {
    privateKeyNsec: agentNsec,
    relayUrl,
    authTag: ownerSignedAuthTag,
    parallelism: 1,
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

Authentication is runtime-specific rather than one universal login protocol.
Native Buzz Agent has no separate login step and uses its injected model and
provider configuration. OpenCode combines adapter discovery with its
interactive provider login; Codex
adds native device login; Claude Code exposes Claude.ai, Console, and SSO;
Goose uses its injected deployment credential; and Kimi Code uses the
upstream adapter's methods. Goose and Kimi Code do not expose a noninteractive
logout command through this SDK surface.

The corresponding helpers are `createBuzzAgent(...)`, `createOpenCode(...)`, `createCodex(...)`,
`createClaudeCode(...)`, `createGoose(...)`, and `createKimiCode(...)`. Set
the typed `buzz` object to derive the canonical child command, arguments, MCP
command, lazy pool, relay observer, and Buzz-owned environment. `buzzEnabled`
remains as a deprecated raw-environment compatibility path. Both forms are
mutually exclusive with an explicit `command`.
Typed and compatibility Buzz launches select the matching `hypercli-buzz`
image family (`buzz-agent`, `opencode`, `codex`, `claude`, `goose`, or
`kimi-code`) by
default. Ordinary coding-agent helpers without Buzz keep the generic
`ghcr.io/hypercli/hypercli-<runtime>:latest` default, except native Buzz Agent,
whose runtime image is already `hypercli-buzz-agent`. An explicit `image`
continues to override either default.

Buzz launches keep `/home/node` as the persistent Files API and credential
root, reserve `/home/node/workspaces` for Workspace projections, and run
`buzz-acp` from the specialized `/home/node/.buzz` nest. The image reconciles
the nest after the home mount. OpenCode and Codex consume its canonical
`AGENTS.md`; Claude Code receives `CLAUDE.md -> AGENTS.md`.
`base_prompt.md` remains compiled into `buzz-acp`.

The typed `buzz` renderer writes timeout and response-policy values but does not
duplicate the stock Desktop provider's validation; invalid combinations are
rejected later by `buzz-acp`. The Desktop provider also maps structured Goose
model/provider fields to `GOOSE_MODEL`/`GOOSE_PROVIDER`; direct TypeScript SDK
callers must set any Goose-specific environment themselves.

Buzz launches leave size unset for live backend/provider slot selection;
ordinary coding-agent helpers preserve a caller-provided size or the backend
default. Stock Buzz provider agents do not
start on app launch and the current provider protocol has no stop callback.
Editing a running agent does not replace its HyperCLI launch environment: stop
the deployment through the authenticated HyperCLI API and deploy it again from
Buzz to apply changes. A successfully delivered and accepted `!shutdown` can
exit a new `restart: false` launch; the hosted terminal-state observer then
reports `stopping`, cleans up the namespace, marks the deployment `stopped`,
and releases its slot. Desktop receives no provider acknowledgement and keeps
its local deployed record.

Stock Buzz expects ACP NDJSON. It skips non-JSON child stdout, and
`agent_message_chunk` is activity telemetry rather than a channel reply. There
is no plaintext fallback; a visible reply requires the agent to invoke the Buzz
send command/tool. The six-runtime SDK coverage validates request rendering,
not live launches.

The agent nsec and caller environment become raw deployment environment values.
The HyperClaw backend currently persists them in `Agent.launch_config`, and
authenticated deployment read, environment, or exec surfaces may expose them.
The default `RUST_LOG` filter disables `acp::stream` content logging; overriding
it can expose generated text in container logs.

### OpenClaw Gateway Chat Attachments

```typescript
import { GatewayClient } from '@hypercli.com/sdk/browser';

const gateway = new GatewayClient({
  url: 'wss://your-agent.dev.hyperclaw.app',
  gatewayToken: 'gateway-token',
});

await gateway.connect();

await gateway.sendChat("What's in this image?", "main", undefined, [
  {
    dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
    mimeType: 'image/png',
    fileName: 'screenshot.png',
  },
]);

await gateway.sendChat('Already normalized', 'main', undefined, [
  {
    type: 'image',
    mimeType: 'image/png',
    content: 'iVBORw0KGgoAAAANSUhEUgAA...',
    fileName: 'screenshot.png',
  },
]);
```

`client.agent.redeemGrantCode()` redeems a promo/activation code and returns the applied grant plus the resulting entitlement. Codes create new entitlements by default; pass `extendExisting: true` only for renewal/extension behavior.

Browser-style `dataUrl` attachments are normalized automatically before `chat.send`.

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
- `client.agent` - HyperClaw inference API
- `client.agents` - HyperClaw `hypercli-openclaw` exec/shell API

### Job Helpers

- `BaseJob` - Base class for GPU jobs
- `ComfyUIJob` - ComfyUI-specific helpers
- `GradioJob` - Gradio-specific helpers

## License

MIT
