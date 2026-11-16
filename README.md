# HyperCLI

Official SDKs, CLI, and documentation for the HyperCLI platform: GPU
instances and jobs, managed agents, hosted inference, flow/media pipelines,
and shared workspaces.

## SDKs

Write code against these. Each package README covers installation, auth, and
the full method surface.

| Directory | Package | Language | Highlights |
|---|---|---|---|
| [`ts-sdk/`](ts-sdk) | `@hypercli.com/sdk` | TypeScript (Node.js >= 22) | Jobs, files, deployments, keys, workspaces |
| [`py-sdk/`](py-sdk) | `hypercli-sdk` | Python | Jobs, instances, renders/ComfyUI, deployments, workspaces |
| [`rs-sdk/`](rs-sdk) | `hypercli-sdk` | Rust | Core product API |

## CLI

The TypeScript CLI ships the `hyper` binary and reads `~/.hypercli` credentials.

| Directory | Package | Status |
|---|---|---|
| [`ts-cli/`](ts-cli) | `@hypercli.com/cli` | Current CLI (`npm install -g @hypercli.com/cli`) |

## Documentation

The public docs site is built from [`docs/`](docs) (Mintlify). Start with:

- [Quickstart](docs/quickstart.mdx)
- [Authentication](docs/authentication.mdx)
- [CLI reference](docs/cli/index.mdx)
- [Agents](docs/agents/index.mdx)
- [Inference](docs/inference/index.mdx)

## Examples

Runnable recipes live in [docs/examples](docs/examples/index.mdx): vLLM
serving, embeddings, speech, and TTS on HyperCLI GPU instances.
