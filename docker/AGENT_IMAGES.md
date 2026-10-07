# HyperCLI agent images

## Coding Agents

`hypercli/docker/coding/` contains the public images used by hosted coding agents. Each
provider has its own Dockerfile and test:

```text
coding/
├── buzz-agent/
├── opencode/
├── codex/
├── claude/
├── goose/
├── kimi-code/
└── pi/
```

`agent-base/` builds the shared `hypercli-agent-base` image (runtime floor, the
shared ACP carrier — hyper-acp, the Buzz plugin toolchain, and the common
entrypoint — plus the X11 agent desktop stack); `hypercli/docker/openclaw/` (public submodule) and
`hypercli/docker/hermes-agent/` build the OpenClaw
and Hermes runtime images on top of it. The image table (names, Dockerfiles,
build contexts) and the local build commands live in [`README.md`](README.md);
this file is the runtime and desktop reference.

The canonical `hypercli-agent-base` installs Python, build tools, `jq`, `rg`
(ripgrep), `pdftotext` (poppler-utils), `pandoc`, passwordless sudo for
`node`, and HyperCLI skills. It does not
inherit from or contain OpenClaw.
`HYPERCLI_REF` defaults to `main`; `HYPERCLI_SHA` is an opt-in exact override.

The base image also carries the shared X11 agent-desktop stack: Xvfb, xfwm4,
x11vnc, the Debian `novnc` package with websockify, plank, Thunar,
xfce4-terminal, feh, and Google Chrome (via the `hypercli-chrome` wrapper).

The `hypercli-chrome` wrapper turns `HYPER_PROXY_HOST` into Chrome's
`--proxy-server`: a boolean-ish true value (`1`, `true`, `yes`, `on`,
`enabled`, case-insensitive) selects the canonical in-cluster endpoint
`socks5://hyper-proxy:8080`; a boolean-ish false value (`0`, `false`, `no`,
`off`, `disabled`) disables proxying; any other non-empty value passes
through unchanged as an explicit proxy URL.

The wrapper always launches Chrome with `--no-sandbox`: agent pods are not
guaranteed the kernel primitives (setuid helper or unprivileged user
namespaces) Chrome's sandbox needs, and Chrome hard-refuses to launch when
sandbox setup fails; the per-agent pod/namespace is the security boundary.
The "You are using an unsupported command-line flag" infobar that flag
triggers is suppressed image-wide by the managed Chrome policy at
`/etc/opt/chrome/policies/managed/hypercli.json`
(`CommandLineFlagSecurityWarningsEnabled: false`, installed from
`agent-base/chrome-policies-managed.json`), the documented enterprise policy for
exactly this warning.

`agent-base/desktop.sh` is sourced by the OpenClaw and Hermes entrypoints and does
nothing unless `HYPER_DESKTOP_ENABLED` is truthy. When enabled,
`hyper_start_desktop` exports `HYPER_PROXY_HOST=true` when the variable is
unset, so every Chrome in the desktop session egresses through the cluster
proxy by default (an explicit URL or boolean-ish false value overrides), and
then:

1. starts Xvfb on `${DISPLAY:-:99}` with `${HYPER_DESKTOP_GEOMETRY:-1280x800x24}`;
2. paints the background: feh `--bg-fill` with
   `${HYPER_DESKTOP_BACKGROUND_IMAGE:-/opt/hypercli/share/hypercli-bg.png}`,
   falling back to an `xsetroot` solid color;
3. starts xfwm4, then plank with a bottom dock pinned to Chrome, Thunar, and
   xfce4-terminal;
4. opens a welcome Chrome window via `hypercli-chrome`;
5. starts x11vnc on localhost `${HYPER_VNC_PORT:-5900}` and websockify serving
   `/usr/share/novnc/` on `${HYPER_DESKTOP_PORT:-${OPENCLAW_DESKTOP_PORT:-3000}}`.

Missing desktop runtime packages fail fast with an error; a missing plank or
welcome-Chrome binary only skips that piece.

The base image installs its custom viewer as
`/usr/share/novnc/hyper-desktop.html`, next to the stock `vnc.html` and
`vnc_lite.html` pages, which remain available. At build time
`agent-base/patch-novnc.mjs` applies two patches (the older per-patch Python
scripts are EOL'd): it patches the stock full UI (`app/ui.js`, used by
`vnc.html` and `vnc_auto.html`) so the URL query/hash and persisted settings
can no longer override `host`, `port`, `path`, or `password` — the RFB
websocket stays pinned to the page origin defaults — and it reworks the vendored
`core/display.js` so noVNC's viewport scaling fills the container on each
axis instead of aspect-preserving fit: the fixed-geometry Xvfb desktop then
fills whatever page size the embedder gives the viewer without
pillar/letterbox bars, and pointer input is mapped per axis so clicks stay
aligned with the stretched canvas. `hyper-desktop.html` connects
immediately on load, syncs the clipboard both ways, and turns dropped files
into Reef uploads on the agent's `~/Desktop`. Its query-string contract (read
from the query or the hash, like `vnc_lite.html`):

| Param | Meaning |
| --- | --- |
| `path` | websockify path (default `websockify`); may itself carry `?token=...` |
| `scale` | `false` fits the remote viewport inside the page (aspect preserved); anything else fills the page exactly — the default in our embed |
| `ft` | Reef files token |
| `fte` | files-token expiry, epoch seconds |
| `rh` | Reef base URL; defaults to this host without the leading `desktop-` |

Uploads go cross-origin to Reef as `PUT {rh}/files/Desktop/{name}` with the
`ft` bearer token. When embedded, the viewer treats only the allowlisted parent
origins (`tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`,
`https://agents.hypercli.com`, `https://agents.dev.hypercli.com`) as a trusted
source of fresh tokens: it posts `{type: "hyper-desktop:ft-refresh"}` to the
parent ahead of expiry and accepts `{type: "hyper-desktop:ft", token,
expiresAt}` replies.

The base image carries the bundled HyperCLI toolchain:

| Command | Implementation | Location |
| --- | --- | --- |
| `hyper` | TypeScript `@hypercli.com/cli`, built from `ts-sdk` + `ts-cli` and bundled into one executable | `/opt/hypercli/bin/hyper` |

The toolchain image builds from the checked-out public source and exports
skill bodies plus the CLI's generated JSON catalog to `/opt/hypercli/skills`.
The source checkout is not retained in the runtime image.
The TypeScript CLI owns the `hyper` name on `PATH`; every
agent image layered on the base (OpenClaw, Hermes, ACP/coding providers)
inherits it. The base build fails unless `hyper --version` and
`hyper --help` succeed.

The base image is also the ACP carrier: it bakes `hyper-acp`, the Buzz plugin,
the pinned Buzz Sprig multicall binary, the `compute_auth_tag` helper, and
`/opt/hypercli/bin/entrypoint`. Provider images add only
their selected runtime CLI and provider-specific configuration. Config seeds,
the runtime marker, and Buzz provenance live in `/opt/hypercli/share/runtime`.

The persistent sync root remains `/home/node`, and HyperCLI Workspace
projections remain under `/home/node/shared`. The main process initializes the
workspace directly under `/home/node`. It seeds only missing files, so restored
user content is preserved.

Coding images read skill bodies from `/opt/hypercli/skills`, without workspace
skill links or a static Markdown index. No Buzz
instructions are delivered over ACP: the Buzz plugin's compiled
`base_prompt.md` is never sent (it survives only as plugin test pins), and
nothing is copied into the image workspace as a skill file.

Coding images boot generic ACP by default. Intentional Buzz/Nostr launches
inject the agent identity, relay URL, and owner-signed authorization tag and
select `hyper-acp plugin buzz` explicitly. See [coding/README.md](coding/README.md)
for the image startup and child-environment contract; shell launches retain
the same image and persistent home.

CI publishes `hypercli-agent-base`, resolves it to an immutable digest, then
builds and tests each provider from that digest. The OpenCode job also runs
the synthetic offline ACP regression before promotion.

## OpenClaw

The independently maintained `hypercli/docker/openclaw/` image (public submodule checkout) remains the OpenClaw runtime.
It is not a base for the Buzz coding-agent images.

The OpenClaw and Hermes images share a general coding-tool floor: Python and
native build tools, Node/npm/npx, pinned Corepack/pnpm/Yarn, media/PDF tools,
editors, archives, HyperCLI with all extras, and passwordless sudo for their
actual runtime users. Runtime-specific applications and plugins remain separate.

Both runtimes clone HyperCLI into `/opt/hypercli`, including the bundled
`/opt/hypercli/skills` library. OpenClaw synchronizes those skills into its
state directory on launch. Hermes seeds missing skills into
`/home/hermes/.hermes/skills` and also registers `/opt/hypercli/skills` as
`skills.external_dirs`, so the immutable image skills are visible as an
externally owned source.

Coding images keep their retained runtime root mounted as the runtime user's
home directory and reserve `$HOME/shared` for HyperCLI Workspace projections.
`shared/` lives on the retained PVC, so restarted containers can still see it,
but SDK launch defaults exclude `shared/**` from Reef/S3 backup. Workspaces
are boot-materialized and can drift during sessions; backing them up as normal
home state makes restores stale and unnecessarily large.

OpenClaw and Hermes seed the Anthropic-route HyperCLI aliases into their
runtime config and boot with `default-anthropic`. That default is a stable
container contract: the backend can retarget it without breaking existing
containers. Today the image aliases resolve as:

| Alias | Current target | Notes |
| --- | --- | --- |
| `default-anthropic` | `kimi-k3-anthropic` | Image default, Anthropic Messages route |
| `coding-anthropic` | `kimi-k3-anthropic` | Stable coding alias, Anthropic Messages route |
| `kimi-k3-anthropic` | `kimi-k3-anthropic` | Pinned Kimi K3 Anthropic Messages route |

The authoritative alias map lives in
[`pulumi/pulumi-agents-k8s/gpus.yaml`](/home/ubuntu/dev/hypercli-mono/pulumi/pulumi-agents-k8s/gpus.yaml).
Image configs duplicate the public names so runtime UIs can list and select
them before the first model request.

For agent runtimes and tool-calling workloads, prefer `-anthropic` aliases.
They use the Anthropic Messages route and are the expected surface for the best
tool-calling behavior.

OpenCode boots with `coding-anthropic`, and its seeded config includes
both route families: `default`, `coding`, `kimi-k3`, and the matching
`-anthropic` aliases. Keep the `-anthropic` aliases as the
default path for hosted coding work; the non-suffixed names remain available
for OpenCode flows that expect the OpenAI-compatible model names.

OpenCode also seeds remote MCP servers for HyperCLI product tools and
Mintlify docs search. The image entrypoint sets `HYPER_MCP_API_KEY` from
`HYPER_API_KEY` when a user supplies a long-term key, otherwise from the
backend-injected `HYPER_AGENTS_API_KEY`. The OpenCode config uses
`HYPER_MCP_API_KEY` only for MCP headers. Model inference resolves the canonical
credential before using `HYPER_AGENTS_API_KEY` as its final fallback. The product MCP URL defaults to
`${HYPER_API_BASE}/api/mcp` and can be overridden with
`HYPER_OPENCODE_MCP_URL`.

OpenClaw exposes vector-backed memory search as `memorySearch`, using the
HyperCLI embeddings route `qwen3-embedding-4b` at
`${HYPER_API_BASE}/v1`. Hermes uses its native external memory provider
slot and boots with `memory.provider: mem0`. The image bakes `mem0ai` and
`qdrant-client` into the Hermes venv, so the default memory provider does not
depend on runtime lazy installs. The image ships a checked-in Mem0 config at
`/home/hermes/.hermes/mem0.json`: Mem0 OSS mode, an OpenAI-style LLM provider
set to `default-anthropic`, an OpenAI-style embedder set to
`qwen3-embedding-4b` with 2560-dimensional vectors, and local Qdrant storage
under `/home/hermes/.hermes/mem0_qdrant`. mem0 forwards the embedder's
`embedding_dims` as the `dimensions` request parameter on every embeddings
call; Qwen3-Embedding supports MRL dims (1024-2560), and the deployed
LiteLLM deployments allowlist `dimensions` via `allowed_openai_params`
(`pulumi/pulumi-agents-k8s/litellm_models.yaml` for the order-2 OpenRouter
fallback, `agents/gpu-operator` registration for the order-1 vLLM rows) —
without the allowlist LiteLLM's openai provider 400s dim-pinned requests for
any model not named `text-embedding-3*`. Launch credentials are projected
through the managed runtime environment, not written into the durable Mem0
config.

## Security boundary

Coding images intentionally grant passwordless sudo to the `node` user. Hosted
ACP permission behavior is controlled by `HYPER_ACP_PERMISSION_MODE`;
`default` preserves runtime permission handling, while `auto` or
`bypass-permissions` approves inside the pod. The effective boundary is
therefore the per-agent namespace, filesystem/persistence scope, resource
limits, and scoped runtime credentials. The current per-agent NetworkPolicy
restricts ingress but does not restrict egress.

Lagoon materializes caller-supplied runtime `env` and `secrets` as per-launch
`agent-env` ConfigMap and `agent-secrets` Secret inputs that exist only for the
lifetime of the runtime launch, but Backend also persists those raw
values in ordinary launch JSON and exposes env/secrets/exec APIs. Do not treat
these images or the unsigned provider test release as a production-safe secret
boundary until Backend moves launch secrets to encrypted/external references and
narrows those read/exec capabilities.
