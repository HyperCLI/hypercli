# docker/

The ACP carrier/base stays private. CLI, coding, OpenClaw, and Hermes image
sources and their image tests live only in the public `hypercli/docker/` tree.
Agents CI and `pulumi/pulumi-docker` consume that checked-out public source.

| image | Dockerfile | context | notes |
|---|---|---|---|
| hypercli-agent-tools | `hypercli/docker/cli/Dockerfile` | `hypercli/` | CLI/SDK/skills toolchain; feeds agent-base as `TOOLCHAIN_IMAGE`. |
| hypercli-cli-ci | `hypercli/docker/cli/ci.Dockerfile` | `hypercli/` | CLI CI image; parent CI runner scripts are bind-mounted at `/tests`. |
| hypercli-acp | `acp/hyper-acp/Dockerfile` | `acp/hyper-acp/` | compiled hyper-acp binary (scratch file-server image). Feeds agent-base as `ACP_IMAGE` (digest-pinned in CI/pulumi; build it first). |
| hypercli-agent-base | `docker/agent-base/Dockerfile` | `docker/agent-base` | runtime floor, the ACP carrier (hyper-acp, Buzz Sprig, shared entrypoint), plus the X11 agent desktop stack |
| hypercli-openclaw | `hypercli/docker/openclaw/Dockerfile` | `hypercli/docker/openclaw` (public submodule) | OpenClaw runtime on agent-base; public-safe, so it lives with the other public image sources in the submodule |
| hypercli-hermes-agent | `hypercli/docker/hermes-agent/Dockerfile` | `hypercli/docker/hermes-agent` | Hermes runtime on agent-base |
| coding/* | `hypercli/docker/coding/<provider>/Dockerfile` | `hypercli/docker/coding` | hosted coding agents on agent-base (buzz-agent, opencode, codex, claude, goose, kimi-code, pi) |

Local builds:

```bash
docker build -t hypercli-agent-tools:local -f hypercli/docker/cli/Dockerfile hypercli
docker build -t hypercli-acp:local -f acp/hyper-acp/Dockerfile acp/hyper-acp
docker build -t hypercli-agent-base:local --build-arg TOOLCHAIN_IMAGE=hypercli-agent-tools:local --build-arg ACP_IMAGE=hypercli-acp:local docker/agent-base
docker build -t hypercli-openclaw:local --build-arg HYPERCLI_AGENT_BASE_IMAGE=hypercli-agent-base:local -f hypercli/docker/openclaw/Dockerfile hypercli/docker/openclaw
docker build -t hypercli-hermes:local --build-arg HYPERCLI_AGENT_BASE_IMAGE=hypercli-agent-base:local hypercli/docker/hermes-agent
```

The base build also needs the `BUZZ_REF` build arg (the pinned buzz-sdk commit
from `acp/hyper-acp/plugins/buzz/Cargo.toml`); `agents/scripts/build-image.sh`
resolves it automatically.

The old `hypercli-agent-images` repo is retired; its README lives on as
`AGENT_IMAGES.md`.
