# @hypercli/sdk

TypeScript SDK for HyperCLI API - GPU cloud compute made simple.

## Installation

```bash
npm install @hypercli/sdk
```

**Dependencies:**
- `ws` - WebSocket client for log streaming
- Node.js 18+ (uses native `fetch`)

## Quick Start

```typescript
import { HyperCLI } from '@hypercli/sdk';

// Initialize client (uses HYPERCLI_API_KEY from env or ~/.hypercli/config)
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
  env: { MODEL: 'llama-3' },
});

console.log(`Job started: ${job.jobId}`);
console.log(`Hostname: ${job.hostname}`);
```

## Configuration

Set your API key via:
1. Environment variable: `export HYPERCLI_API_KEY=your_key`
2. Config file: `~/.hypercli/config`
3. Constructor: `new HyperCLI({ apiKey: 'your_key' })`

```typescript
import { configure } from '@hypercli/sdk';

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
```

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
import { streamLogs } from '@hypercli/sdk';

await streamLogs(client, jobId, (line) => {
  console.log(line);
});
```

### ComfyUI Workflows

```typescript
import { ComfyUIJob, applyParams, graphToApi } from '@hypercli/sdk';

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
- `client.claw` - HyperClaw inference API

### Job Helpers

- `BaseJob` - Base class for GPU jobs
- `ComfyUIJob` - ComfyUI-specific helpers
- `GradioJob` - Gradio-specific helpers

## License

MIT
