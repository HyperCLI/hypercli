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

// Execute command in a hypercli-openclaw agent container
const agentExec = await client.agents.exec(agentId, 'ls -la');

// Interactive shell for a hypercli-openclaw agent
const agentWs = await client.agents.shellConnect(agentId);
agentWs.close();
```

### OpenClaw Agents

OpenClaw uses the generic deployment launch surface. `registryUrl`, `registryAuth`, `syncRoot`, and `syncEnabled` are generic deployment options; the OpenClaw helpers only add defaults such as routes, image, and `syncRoot=/home/node`.

```typescript
const agent = await client.deployments.createOpenClaw({
  name: 'docs-demo',
  start: true,
  heartbeat: { every: '0m' }, // disable upstream OpenClaw heartbeat runs
  registryUrl: 'git.nedos.co',
  registryAuth: { username: 'ci', password: 'token' },
});
```

`heartbeat` maps directly to upstream OpenClaw config at `config.agents.defaults.heartbeat`. Omit it to keep upstream defaults, or pass values such as `heartbeat: { every: '1h', target: 'last' }`.

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

`client.agent.redeemGrantCode()` redeems a promo/activation code and returns the applied grant plus the resulting entitlement.

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
