# HyperCLI Coding Runtimes

This directory builds the coding-agent images used by HyperCLI hosted ACP
runtimes. The same images can also be launched by the Buzz provider when the
agent is intentionally a Buzz/Nostr agent.

This is the canonical human architecture document for these images. `AGENTS.md`
contains maintainer guardrails. Skill bodies are installed at `/opt/hypercli/skills`;
each runtime's native instruction file is seeded at boot from the canonical
`/opt/hypercli/share/runtime/AGENTS.md.template` (see "Runtime instruction
roots").

Image integration tests take parent-owned inputs explicitly. From the private
mono root, set `HYPERCLI_TEST_LAUNCH_CONTRACT` to the absolute path of
`.github/fixtures/hypercli/buzz-launch-contract.json` and
`HYPERCLI_TEST_SMOKE_HELPERS` to the absolute path of
`agents/tests/smoke/helpers.py` before running a provider's `test.py`.
CI supplies these paths; no copies of those inputs belong in the public images.

## System Boundary

```text
HyperCLI Desktop / SDK
  -> HyperCLI deployments API
  -> HyperClaw/Lagoon
  -> hypercli-<runtime> image
  -> hyper-acp
  -> runtime ACP child

Buzz Desktop
  -> one-shot HyperCLI Buzz provider process
  -> hypercli-sdk
  -> HyperCLI deployments API
  -> HyperClaw/Lagoon
  -> hypercli-<runtime> image
  -> hyper-acp plugin buzz
  -> runtime ACP child
  -> Buzz relay
```

Buzz Desktop owns:

- persona and agent identity;
- relay URL, private key, authorization tag, and owner identity;
- effective prompt, model, provider, timeouts, and access policy;
- channel membership and the selected backend provider;
- the portable resolved `launch` block.

The HyperCLI provider owns:

- provider-schema validation;
- portable-launch validation and environment precedence;
- runtime and canonical image selection;
- translation into the HyperCLI deployment request;
- stable identity lookup, idempotent create/start, and readiness polling.

HyperClaw and Lagoon own:

- runtime-key issuance and scopes;
- image scheduling, storage projection, and pod lifecycle;
- deployment state and authenticated lifecycle operations.

The image owns only process setup, installed runtime binaries, filesystem prompt
initialization, compatibility links, and the runtime-specific ACP child command.

## Local And Hosted Installation

Buzz's Settings > Agents screen discovers and installs local harnesses. For
example, the Goose Install action runs Goose's local CLI installer through
Tauri. OpenCode can appear Ready because its binary is already available on
the Desktop machine.

Those actions do not install software in a hosted deployment. Hosted runtimes
are immutable images with the selected CLI and adapter already installed.
Desktop's local install and login machinery is therefore useful source
material, but it is not part of the remote provider protocol.

## Provider Protocol

Buzz starts a fresh provider process for every operation:

1. The process receives no normal command-line arguments.
2. Desktop writes one JSON object plus a newline to stdin and closes stdin.
3. The provider writes one JSON response to stdout.
4. Diagnostics go to stderr and must not contain secrets.

Protocol version 1 supports only:

- `info`, with a 10-second Desktop timeout;
- `deploy`, with a 600-second Desktop timeout.

There is no provider `start`, `stop`, `delete`, `update`, `exec`, `logs`,
`status`, `install`, or `login` operation. Do not infer those operations from
similarly named UI actions.

The resolved `agent.launch` block is authoritative when present:

- `launch.command` and `launch.args` identify the selected portable harness;
- `launch.policy_env` supplies descriptor policy defaults;
- `launch.env` supplies the fully resolved descriptor and user environment;
- `launch.owner_pubkey` supplies the resolved owner.

Environment precedence is `policy_env`, then `env`. Legacy top-level agent
fields are accepted only for saved clients without a resolved launch block.
The provider must reject invalid POSIX keys and remove provider-owned keys
before applying its canonical values.

The portable contract expects a command name. `launch.command` selects the
hosted runtime; legacy requests without `launch` fall back to
`agent.agent_command`. Runtime-named provider executables are discovery and
saved-provider compatibility aliases, not runtime selectors, because Desktop
stages the selected binary as `provider[.exe]`. The provider defensively
normalizes a `/`- or `\\`-qualified value and optional `.exe` to a known
basename, then chooses the canonical image and absolute child command while
preserving descriptor arguments. Missing or unknown commands are rejected;
display fields and saved provider config do not select a runtime.

## Why We Do Not Import The Kubernetes Provider

Upstream's `buzz-backend-kubernetes` is a direct Kubernetes reconciler. It owns
Kubernetes configuration, namespaces, pods, image policy, observation,
garbage collection, and reconciliation. HyperCLI deliberately delegates those
responsibilities to the deployments API and Lagoon, so importing or copying
the reconciler would create two orchestration layers and immediate drift.

The reusable upstream boundaries are:

- provider request, response, and portable launch wire types;
- environment validation, precedence, and provider-owned key rules;
- sanitized provider-wire golden fixtures;
- setup payload types parsed by `hyper-acp plugin buzz`;
- naming, error classification, and reconciliation invariants as references.

The preferred future extraction is small shared crates such as
`buzz-backend-wire` and `buzz-backend-env`, not a dependency on the whole
Kubernetes provider. Until those exist, upstream wire fixtures and source are
conformance references and our orchestration remains provider-specific.

## Deployment Contracts

Plain hosted ACP launches use:

| Property | Value |
| --- | --- |
| Default image CMD | `["/usr/local/bin/hyper-acp"]` (no deployment command/args override required) |
| ACP child | `HYPER_ACP_AGENT_COMMAND`, `HYPER_ACP_AGENT_ARGS` |
| System instructions | native runtime configuration and instruction files; hyper-acp does not inject private prompt fields |
| Permission mode | `HYPER_ACP_PERMISSION_MODE` defaults to `default`; supported values are `default`, `auto`, `bypass-permissions`/`bypassPermissions`, `accept-edits`/`acceptEdits`, `dont-ask`/`dontAsk`, and `plan` |
| Restart | runtime-specific caller choice |
| Home and sync root | `/home/node` |
| Working directory | `/home/node` |
| Sync owner | UID/GID `1000` |

Buzz provider launches use:

| Property | Value |
| --- | --- |
| Size | largest currently available entitlement slot (`large` > `medium` > `small`) |
| Entrypoint command | `/usr/local/bin/hyper-acp plugin buzz` |
| ACP child | `BUZZ_ACP_AGENT_COMMAND`, `BUZZ_ACP_AGENT_ARGS` |
| Permission mode | `HYPER_ACP_PERMISSION_MODE` is read by `hyper-acp`; the image entrypoint maps it for plain ACP and `hyper-acp plugin buzz` applies it as an ACP session mode when supported |
| Restart | `false` |
| Routes | none |
| Home and sync root | `/home/node` |
| Working directory | `/home/node` |
| Sync owner | UID/GID `1000` |
| Runtime scopes | `agents:none`, `files:*`, `flows:*`, `models:*`, `voice:*`, `web:*`, `workspaces:*` |

The stable handle is derived from the Nostr public key. Provider `deploy` is
idempotent:

- a matching running deployment is reused;
- a booting deployment is polled;
- a stopped deployment is started in place with the current translated launch
  request;
- a create conflict is recovered by looking up the same stable deployment.
- a create-time slot race refreshes capacity and may fall back to an
  unattempted lower available tier.

Readiness succeeds only at `RUNNING`. `CREATING`, `STARTING`, and `RESTORING`
are polled. `FAILED` and the readiness timeout return a sanitized
error without upstream response bodies or secrets.

## Runtime Matrix

| Hosted runtime | Canonical image | Portable command | Injected ACP child | Child args | MCP command | Prompt transport | Runtime state |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Buzz Agent | `ghcr.io/hypercli/hypercli-buzz-agent:latest` | `buzz-agent` | `/usr/local/bin/buzz-agent` | none | none | none — hosted Buzz sessions send `mcpServers: []`; system instructions rejected | environment-only for hosted OpenAI-compatible chat auth |
| OpenCode | `ghcr.io/hypercli/hypercli-opencode:latest` | `opencode` | `/opt/hypercli/bin/opencode` | `acp` | none | none — passthrough; `systemPrompt` rejected | `.config/opencode`, `.local/share/opencode`, `.local/state/opencode`, `.cache/opencode` |
| Codex | `ghcr.io/hypercli/hypercli-codex:latest` | `codex-acp` | `/opt/hypercli/bin/codex-acp` | none | none | none — passthrough | `.codex` |
| Claude Code | `ghcr.io/hypercli/hypercli-claude:latest` | `claude-agent-acp` | `/opt/hypercli/bin/claude-agent-acp` | none | none | none — passthrough | `.claude`, `.claude.json` |
| Goose | `ghcr.io/hypercli/hypercli-goose:latest` | `goose` | `/usr/local/bin/goose` | `acp` | none | none — passthrough | `.goose` |
| Kimi Code | `ghcr.io/hypercli/hypercli-kimi-code:latest` | `kimi` | `/opt/hypercli/bin/kimi` | `acp` | none | none — passthrough | `.kimi-code` |
| Pi | `hypercli-pi:local` (local gate) / `ghcr.io/hypercli/hypercli-pi:latest` (hosted) | `pi-acp` | `/opt/hypercli/bin/pi-acp` | none | none | none — passthrough | `.pi/agent` |

Hyper-acp forwards ordinary ACP turns without injecting system instructions.
Instructions belong in native runtime configuration and seeded instruction files
(below). The Buzz plugin supplies no compiled prompt asset; see
`acp/hyper-acp/plugins/buzz/README.md` for its execution/signing boundary.

Pi's minimal image installs the official `@earendil-works/pi-coding-agent` and
ordinary `pi-acp` releases, pinned by `PI_VERSION` and `PI_ACP_VERSION` build
arguments. Its small runtime entrypoint delegates to agent-base's shared entrypoint and defaults to plain
`hyper-acp`. `PI_ACP_PI_COMMAND=/opt/hypercli/bin/pi` selects native Pi, which
the adapter starts in RPC mode. `HYPER_RUNTIME_HOME=/home/node/.pi/agent`
maps to `PI_CODING_AGENT_DIR` at startup, keeping native state under the sync-backed
home, including when launched as root; explicit native overrides win.
User-owned native `AGENTS.md` discovery is retained;
the image seeds the native instruction file from the canonical template only
when no user-managed file, link, or directory exists at the target. Pi has no
implicit
HyperCLI inference mapping. Pi IS a registered hosted runtime: the backend
launch contract maps `pi` to `ghcr.io/hypercli/hypercli-pi:latest`
(`agents/backend/agents/launch_contract.py`), the ts-sdk runtime registry and
the app picker both list it (`hypercli/ts-sdk/src/agents.ts`,
`app/src/components/NewAgentModal.tsx`), and the docker Pulumi stack builds
and publishes the image (`pulumi/pulumi-docker/Pulumi.prod.yaml`).

Build and run the offline image gate from the repository root, selecting an
existing agent base image (Node >=22.19):

```sh
docker build -f docker/coding/pi/Dockerfile \
  --build-arg HYPERCLI_AGENT_BASE_IMAGE=hypercli-agent-base:local \
  -t hypercli-pi:local docker/coding
python3 docker/coding/pi/test.py hypercli-pi:local
```

Resolve release versions before updating the build arguments; promote only a
tested immutable candidate. The Pi gate verifies the installed native CLI,
ordinary adapter initialize, root/non-root paths, user instruction preservation,
and shared entrypoint exit status with networking disabled. It does not perform
provider/model calls or claim end-to-end session prompt delivery coverage.

OpenClaw is a separate ACP desktop runtime. `buzz-agent` is upstream Buzz's native
ACP runtime. The upstream Sprig multicall binary is kept at
`/usr/local/lib/acp/buzz/sprig`; only the native Buzz image exposes
`buzz-agent` and `buzz-dev-mcp` on `PATH`. Plain hosted ACP uses
`/usr/local/bin/hyper-acp`; Buzz/Nostr launches use `/usr/local/bin/hyper-acp plugin buzz`.
A deprecated compat symlink at `/usr/local/bin/acp` points to the same binary
for launch configs not yet migrated.

Goose ships a HyperCLI custom provider and advertises both OpenAI-compatible
aliases (`default`, `coding`, `kimi-k3`) and the
matching Anthropic Messages aliases. It boots on `coding-anthropic`, enables
Goose's built-in `developer` and `memory` extensions, and enables the native
platform `skills` extension. Buzz Agent remains native Sprig: it uses
upstream's OpenAI-compatible Chat Completions provider, receives a single bare
`BUZZ_AGENT_MODEL`, and does not use OpenCode's `BUZZ_MODEL_PREFIX`
qualification.

## Container Injection

### Files and directories

The image must provide:

- `/usr/local/bin/hyper-acp`, built from the selected HyperCLI ref or explicit SHA;
- the runtime CLI and any required ACP adapter from the matrix above;
- `/opt/hypercli/skills`, the canonical installed skill bodies;
- `/opt/hypercli/share/runtime`, containing `.buzz-commit` provenance, the
  concrete image's `runtime` marker, the canonical `AGENTS.md.template`
  instruction seed, and runtime-specific config seeds;
- `/opt/hypercli/bin/entrypoint` and runtime-specific `*-entrypoint` scripts;
- `/home/node/shared` and `/home/node/.coding-agent`,
  owned by UID/GID 1000.

Runtime entrypoints create only the hidden state/config directories required by
their own tools and copy template config files only when the destination does
not exist. They must not overwrite a user-managed file, directory, or symlink.

Agent-base is the ACP carrier: it sets the shared entrypoint under `tini` and
defaults to `CMD ["/usr/local/bin/hyper-acp"]`. Concrete coding images repeat
that CMD because Docker resets inherited CMD when an entrypoint is declared.
The real binary remains `/opt/hypercli/bin/hyper-acp`, with
`/usr/local/bin/hyper-acp` as its symlink. Provider images supply their own `HYPER_ACP_AGENT_COMMAND` and
`HYPER_ACP_AGENT_ARGS`; the base requires the caller to select a child.

Runtime entrypoints perform compatibility setup and then `exec` the shared
entrypoint under `tini`; native Buzz uses the shared entrypoint directly.
The shared entrypoint `exec`s the default or caller-supplied command, and its
exit status becomes the container exit status. Intentional Nostr callers can
still supply `/usr/local/bin/hyper-acp plugin buzz` explicitly.

User and Buzz turns use ordinary ACP prompts. Platform identity, file and
environment instructions belong in native runtime configuration and the seeded
instruction file (`AGENTS.md.template`), not host-authored ACP extensions.
Hosted Buzz sessions send `mcpServers: []`; the connector publishes completed
replies locally. Retired context-injection assets are not part of this path.

Bundled HyperCLI skills live in `/opt/hypercli/skills`. Runtime
entrypoints no longer create workspace skill symlink farms. No Buzz-specific
instructions are delivered over ACP;
no workspace skill file carries them either. OpenCode reads skills directly from `/opt/hypercli/skills` through
its generated config. The CLI's generated `index.json` and per-skill JSON files
live alongside the skill directories and support offline `hyper skills list`
and `hyper skills export`; no static Markdown index is installed.

At boot the shared entrypoint seeds each runtime's native instruction file
(see "Runtime instruction roots") from the canonical
`/opt/hypercli/share/runtime/AGENTS.md.template`. The template is
runtime-neutral and directs the runtime to read the platform-projected persona
files `~/.hypercli/USER.md` and `~/.hypercli/SOUL.md` at session start. The
seed is written only when the target path is absent: an existing user-managed
file, directory, or symlink always wins and is never overwritten or followed.
There is no ACP session prompt transport to reconcile against: the wire is
passthrough with reject semantics (see "Container Injection").
Native mode does not create
`.claude/settings.json`. Explicit HyperCLI compatibility mode may create a
three-key model catalog plus `.claude/.hypercli-settings.json` ownership
marker. Returning to native mode removes a still-unmodified marked catalog,
or the exact legacy three-key `kimi-k2.6-anthropic` catalog emitted by older
images. Any extra key or different value is preserved as user-owned config.

### Runtime instruction roots

The six coding images expose one platform build argument/environment variable,
`HYPER_RUNTIME_HOME`. The Docker build argument supplies the image ENV default;
`docker run -e HYPER_RUNTIME_HOME=...` changes it at startup. Each runtime's
entrypoint resolves its native variable before creating directories or copying
existing config templates:

| Runtime | Image default | Native variable | Instruction file relative to resolved native root |
| --- | --- | --- | --- |
| OpenCode | `/home/node/.config/opencode` | `OPENCODE_CONFIG_DIR` | `AGENTS.md` |
| Claude | `/home/node/.claude` | `CLAUDE_CONFIG_DIR` | `CLAUDE.md` |
| Codex | `/home/node/.codex` | `CODEX_HOME` | `AGENTS.md` |
| Goose | `/home/node/.goose` | `GOOSE_PATH_ROOT` | `config/.goosehints` |
| Kimi Code | `/home/node/.kimi-code` | `KIMI_CODE_HOME` | `AGENTS.md` |
| Pi | `/home/node/.pi/agent` | `PI_CODING_AGENT_DIR` | `AGENTS.md` |

Precedence is an explicitly set native variable, then nonempty
`HYPER_RUNTIME_HOME`, then the established image default. An explicitly empty
native variable fails startup rather than redirecting writes. Native defaults
are not baked into these images, so even an explicit native override equal to
the old default wins over a different platform root. Use absolute directory paths.
This mapping applies to entrypoint descendants; Docker exec processes bypass
the entrypoint and must receive the matching native variable separately.

The relative filenames name the native instruction file the shared entrypoint
seeds from the canonical template at boot, at the resolved native root. The
seed carries the platform base instructions plus the persona references
(`~/.hypercli/USER.md`, `~/.hypercli/SOUL.md` — the `default` profile in the
SDK persona registry, `ts-sdk/src/agent-persona.ts`) and is written only when no
user-managed file, link, or directory exists at the target. Existing config
templates follow the resolved native root and retain their existing
ownership/protection rules. Coding cwd remains `/home/node`; selecting a root
does not update sync mounts, other state roots, or Pi adapter state at
`~/.pi/pi-acp`.

OpenClaw and Hermes are not yet covered by this platform variable. OpenClaw's
current template explicitly pins both default and per-agent workspace to
`~/.openclaw/workspace`; exporting `OPENCLAW_WORKSPACE_DIR` alone is insufficient
to establish the selected instruction root while preserving user config. Hermes
loads generic `AGENTS.md` from workspace cwd (default `/home/hermes`), not from
`HERMES_HOME` (`/home/hermes/.hermes`). Its CLI and ACP workspace controls
need separate verification against the pinned August image before mapping them.

Run the root gate in addition to each runtime's existing image contract test:

```sh
python3 docker/coding/test_runtime_home.py opencode IMAGE
```

The gate accepts `opencode`, `claude`, `codex`, `goose`, `kimi-code`, or `pi` and
checks default/platform/native precedence, empty-native rejection, unchanged cwd,
and personal file/directory/symlink preservation as root and node. All probes run
in disposable containers with networking disabled and no personal-home mounts.

### Runtime inference environment

`HYPER_API_BASE` selects product/inference; `HYPER_AGENTS_API_BASE` independently
selects direct Agent control and never inference. `HYPER_API_KEY` is the canonical
credential; `HYPER_AGENTS_API_KEY` is only a final credential fallback.
Runner and Lagoon inject consistent platform defaults for both bases, the
appropriate ACP URL, and platform runtime key. Customer `HYPER_API_BASE`,
`HYPER_AGENTS_API_BASE`, and `HYPER_API_KEY` in launch `env` or `secrets` are preserved;
the canonical key overrides the default runtime key, including for managing
other agents. Clients prefer an explicit canonical credential, then environment
`HYPER_API_KEY`, then the configured canonical key, before the platform fallback.
The launch owner's authentication key is never automatically forwarded.
Buzz Agent, OpenCode, and Goose are the
zero-login HyperCLI runtimes. The shared entrypoint maps native Buzz's values to
upstream's OpenAI-compatible Chat Completions env (`OPENAI_COMPAT_*`) without
persisting the credential, preserving explicit overrides including empty values.
Its image supplies `BUZZ_AGENT_PROVIDER=openai`,
`BUZZ_AGENT_MODEL=coding-anthropic`, and `OPENAI_COMPAT_API=chat`.
Claude Code, Codex, and Kimi Code are native-first:
missing `HYPERCLI_RUNTIME_INFERENCE` means the child receives no implicit
HyperCLI model, URL, or credential overlay.

Only the exact explicit value `HYPERCLI_RUNTIME_INFERENCE=hypercli` asks the
launcher to perform runtime-specific compatibility translation immediately
before each native-runtime child launch:

- Claude Code: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`;
- Codex: a non-secret `CODEX_CONFIG` custom-provider overlay whose credential
  follows canonical key precedence above and whose wire API is `responses`;
- Kimi Code 0.31: the native in-memory `KIMI_MODEL_*` overlay.

The mapping is all-or-nothing and does not overwrite an explicit vendor
runtime environment, preventing a HyperCLI key/vendor URL mix. Explicit
`HYPERCLI_RUNTIME_INFERENCE=native` is accepted but not required. Codex
compatibility configuration is reproducible, but inference remains blocked
until the HyperCLI gateway exposes an OpenAI Responses surface.

### Runtime-native authentication

Claude Code, Codex, and Kimi Code images expose a stable
`/usr/local/bin/hypercli-runtime-auth` command for authenticated remote exec or
PTY sessions. It resolves to the runtime-specific wrapper installed in the
same image:

- Claude Code: `hypercli-claude-auth status|login|setup-token|logout`;
- Codex: `hypercli-codex-auth status|login|logout`;
- Kimi Code: `hypercli-kimi-auth status|login`.

Login runs inside the hosted runtime so native credentials persist beneath the
sync-backed home directory. These commands are an image/exec contract; the
one-shot deployment provider does not proxy interactive authentication and
credentials must not be copied into its launch request.

Every wrapper's `status` action prints exactly one JSON object with `runtime`
and boolean `authenticated`, then exits successfully. Kimi mirrors its native
OAuth `hasToken` check by safely validating the mode-0600
`.kimi-code/credentials/kimi-code.json` wire file and never prints its content.
Exit code 2 is reserved for invalid wrapper usage.

### Provider-owned environment

The provider must inject and protect these categories:

| Category | Keys |
| --- | --- |
| Identity | `BUZZ_PRIVATE_KEY` (`NOSTR_PRIVATE_KEY` has no readers; reserved/stripped, never minted) |
| Relay | `BUZZ_RELAY_URL`, optional `BUZZ_AUTH_TAG` |
| ACP child | `BUZZ_ACP_AGENT_COMMAND`, `BUZZ_ACP_AGENT_ARGS` |
| Owner and access | `BUZZ_ACP_AGENT_OWNER`, `BUZZ_ACP_RESPOND_TO`, `BUZZ_ACP_RESPOND_TO_ALLOWLIST` |
| Display and mentions | none minted — dead `BUZZ_ACP_DISPLAY_NAME` / `BUZZ_ACP_TEXT_MENTIONS` are reserved/stripped |
| Reply behavior | none minted — dead `BUZZ_ACP_REQUIRE_REPLY` is reserved/stripped; the plugin itself pins `BUZZ_AGENT_REQUIRE_REPLY=0` on native Buzz Agent children because the connector publishes completed text |
| Prompt and model | `BUZZ_ACP_SYSTEM_PROMPT` / `BUZZ_ACP_SYSTEM_PROMPT_FILE` are reserved/stripped — the plugin hard-rejects any configured system instructions at session create (never delivered); provider mints only `BUZZ_ACP_MODEL` |
| Observer | `BUZZ_ACP_RELAY_OBSERVER` |
| Event handling | Distinct admitted relay events queue behind the local Buzz turn. Event-ID deduplication remains; failed turns are not automatically resubmitted. |
| Workspaces | `HYPER_WORKSPACES_DIR=/home/node/shared`; image boot-sync envs (`HYPER_WORKSPACES_BOOT_SYNC`, `HYPER_WORKSPACES_SYNC_READY_ONLY`) removed — superseded by the typed `workspaces_sync` agent launch config (Lagoon-managed resident `workspaces-sync` sidecar) |
| ACP WebSocket | outbound `HYPER_ACP_WS_URL`, authenticated only with platform `HYPER_AGENTS_API_KEY` |

The provider also projects validated non-reserved `launch.env` values. It must
not allow user environment to override identity, relay, authorization,
runtime command, text mentions, signing identity, or workspace bootstrap fields.

`BUZZ_ACP_SYSTEM_PROMPT` is reserved and stripped from all launch tiers: the
plugin rejects any system instruction source at session create ("system
instructions require native runtime configuration",
`acp/hyper-acp/plugins/buzz` `pool.rs`). Hosted Buzz sessions are created with
`cwd` + `mcpServers: []` and completed assistant text is auto-published by the
connector. An image must not append its own response policy or duplicate the
prompt in a runtime-specific instruction file.

### ACP WebSocket

An explicit `HYPER_ACP_WS_URL` wins. Otherwise the shared entrypoint derives it
from `HYPER_AGENTS_API_BASE`, falling back to `HYPER_API_BASE` only when no
Agents base is supplied. It converts HTTP(S) to
WS(S), maps `api.hypercli.com` / `api.dev.hypercli.com` to their corresponding
`api.agents.hypercli.com` / `api.agents.dev.hypercli.com` bridge hosts, preserves
custom hosts and deployment path prefixes, and replaces a terminal REST
`/agents` or `/api` suffix with `/ws` (otherwise appending `/ws`). Images must not bake in a
production Agents base that selects the wrong plane. External inference
URLs/keys must not implicitly redirect platform callbacks or reconnects.
Only the platform `HYPER_AGENTS_API_KEY` authenticates ACP transport; a customer
`HYPER_API_KEY` used for inference or SDK calls does not replace it. The entrypoint unsets
legacy `HYPER_ACP_WS_LISTEN` and `HYPER_ACP_LOG`; no inbound container port or
Kubernetes startup override is needed. HyperACP owns connect/reconnect and the
generic ACP wire protocol.

Native `buzz-agent` is a stdio ACP child, distinct from `hyper-acp plugin buzz`.
Generic clients supply tools through standard `session/new.mcpServers`, which
hyper-acp forwards verbatim (the HyperACP MCP registry is removed). The hosted
Buzz connector submits an empty MCP server list and publishes completed
assistant text locally.

## Messages, Mentions, And Replies

ACP activity and thinking output remain native session updates. In Buzz provider mode,
the plugin publishes accumulated assistant `agent_message_chunk` text as the
turn's Buzz channel message after a successful ACP `end_turn`. Child runtimes
must not call Buzz-specific commands to publish their final reply.

`BUZZ_ACP_REQUIRE_REPLY` is dead: nothing reads it and the provider mints it
nowhere (it stays reserved so caller/policy injection is stripped). For native
`buzz-agent` children the plugin itself pins upstream's process-level
`BUZZ_AGENT_REQUIRE_REPLY=0` at spawn to disable its tool-only reply loop.

`respond_to` authorizes who may instruct the agent. Text mention fallback is a
separate live routing feature. The plugin resolves mentions for its single identity.
Matching is boundary-safe and case-insensitive. It does not bypass
`owner-only`, `allowlist`, `anyone`, or `nobody` authorization.

## Desktop Lifecycle Semantics

Desktop projects provider status from its stored `backend_agent_id`, not from
the live HyperCLI deployment. Presence is a separate relay signal.

| Desktop action | Provider call | Hosted effect |
| --- | --- | --- |
| Create with provider | `info`, then `deploy` | Creates or reuses the stable deployment and stores its ID. |
| Play/deploy an undeployed record | `info`, then `deploy` | Rebuilds the current portable request. |
| Add or mention an undeployed agent | conditional `deploy` | Deploys after membership when no provider ID exists. |
| Add or mention a deployed agent | none | Changes membership only. |
| Save settings | none | Persists Desktop state; does not hot-reload the pod. |
| Remove from channel | none | Changes membership only; the pod keeps running. |
| Stop current turn | none | No hosted observer/control command is implemented. |
| Shutdown/Stop running agents | none | No hosted `!shutdown` command is implemented. |
| Delete agent | none | Local/relay deletion does not stop the hosted deployment. |
| Desktop launch or quit | none | Provider-backed agents are excluded from local process restore/shutdown. |

Normal UI can suppress Play while a stale provider ID still says `deployed`,
even after the remote deployment has stopped. Provider idempotency makes a
future explicit `deploy` safe but cannot repair Desktop's local status without
a new Desktop lifecycle operation.

HyperCLI lifecycle operations remain available through the authenticated agents
API and CLI; they are not provider protocol operations. With `restart: false`,
an actual process exit terminates the pod.

## Authentication Boundary

Desktop's provider deploy response contains only `agent_id`. Settings > Agents
login commands execute local adapters and terminals. They cannot execute in a
provider-hosted pod or return a remote verification URL/code through provider
protocol v1.

Buzz Agent, OpenCode, and Goose use hosted HyperCLI inference without a vendor
login. Claude Code, Codex, and Kimi Code require their native persisted login
by default. Their device/browser flows require a live remote PTY, structured
URL/code extraction, status, input where applicable, cancellation, and resume.
HyperCLI compatibility for those runtimes is an explicit advanced opt-in; it
is never a fallback for a missing vendor login. Do not encode a challenge in
`agent_id` or a provider error.

ACP authentication is useful as a protocol reference but does not install a
runtime. Terminal authentication tells the client to launch a separate
interactive process; it does not transport that terminal through the current
Desktop provider interface.

## Persistence

The current hosted contract enables sync at `/home/node`. This preserves more
state than the minimum needed by task-oriented coding agents. Narrowing future
sync to canonical runtime state such as `.claude`, `.codex`, `.goose`, or other
explicit authentication/configuration directories is a separate storage
change. Do not describe that proposal as shipped behavior.

Workspace initialization and HyperCLI workspace sync are distinct. Runtime state
lives under `/home/node`; synced HyperCLI workspaces live under
`/home/node/shared`.

## Regression Gates

Provider, SDK, ACP, or image changes must verify:

1. Sanitized provider fixtures deserialize and round-trip the exact wire keys.
2. Every supported `launch.command` basename selects the expected runtime,
   canonical image, absolute child, args, and MCP command; the generic
   executable and compatibility aliases expose the same provider protocol.
3. Missing and unknown launch commands are rejected; path-qualified known
   commands and optional case-insensitive `.exe` normalize to the same
   canonical runtime, and the caller-supplied path is never executed.
4. Environment precedence matches upstream and provider-owned keys cannot be
   overridden.
5. Every image contains the exact child command, args, MCP command, runtime
   state paths, and canonical skill bodies in the matrix.
   The shared image test reads the tracked mono launch fixture on the CI host
   (outside the Docker build context). The provider's executable protocol test
   pins emitted requests to that fixture; all six image tests then check its
   launcher, child, MCP, and optional Claude executable paths inside the real
   candidate image as UID 1000 after entrypoint setup, and exercise the emitted
   `hyper-acp plugin buzz --help` command with networking disabled. Missing
   fixtures, dangling links, non-executable files, and overwritten launch env
   fail this gate.
6. The canonical instruction template is seeded once into each runtime's
    resolved native instruction root (workspace root only for `buzz-agent`,
    whose home is its instruction root), carries the `~/.hypercli/USER.md` and
    `~/.hypercli/SOUL.md` persona references, and never overwrites an existing
      user-managed path. System instructions belong in native configuration;
      ACP carries ordinary user turns.
7. The real `tini` and setup entrypoint chain terminates promptly and preserves
   the launched command's nonzero exit status.
   Built image inspection also checks the default CMD and child environment for
   every runtime. The local OpenCode ACP smoke test launches the candidate with
   nothing after the image name and verifies a correlated successful initialize
   from the real OpenCode child through a synthetic local `/ws` peer.
8. Live Buzz intake verifies signatures, membership, mentions and author policy.
9. Native configuration supplies system instructions; ordinary ACP carries turns
   without host-authored prompt extensions.
10. The connector signs completed assistant text locally; the runtime does not
    publish Buzz messages or hold Buzz signing keys.
11. Failed turns are not automatically resubmitted; real native outcomes govern
    completion, not a reply-guard deadline.
12. Text mentions and author authorization remain independent.
13. Provider deploy reuses running state and restarts stopped state in place.
14. Tests do not claim Desktop settings, membership, shutdown, deletion, or
    restoration invokes a provider lifecycle operation.

Image candidates should be tested by immutable SHA tag. Promotion to `latest`
must follow the runtime contract and offline ACP gates, including real Buzz
Agent, OpenCode, and Goose inference behavior where supported.

## Source Map

Pinned upstream Buzz dependencies:

- provider request construction: `desktop/src-tauri/src/commands/agents_deploy.rs`;
- provider invocation: `desktop/src-tauri/src/managed_agents/backend.rs`;
- local discovery/install: `desktop/src-tauri/src/managed_agents/discovery.rs`
  and `desktop/src-tauri/src/commands/agent_discovery.rs`;
- remote status projection: `desktop/src-tauri/src/managed_agents/runtime.rs`;
- frontend lifecycle actions:
  `desktop/src/features/agents/lib/managedAgentControlActions.ts`;
- native runtime: `crates/buzz-agent`;
- Sprig dispatch: `crates/sprig/src/main.rs`;
- upstream Kubernetes reference: `crates/buzz-backend-kubernetes`.

HyperCLI:

- hosted ACP startup: `hyper-acp`;
- Buzz-compatible relay library and upstream pin: `acp/hyper-acp/plugins/buzz`;
- provider translation: `acp/buzz-backend-provider/src/lib.rs`;
- typed launch rendering: `rs-sdk/src/types.rs`;
- golden contract: `.github/fixtures/hypercli/buzz-launch-contract.json`;
- provider protocol tests: `acp/buzz-backend-provider/tests/protocol.rs`.

HyperClaw backend and images:

- canonical backend contract: `backend/agents/launch_contract.py`;
- image definitions and initialization: this directory;
- image contract tests: `test_*.py` and parent smoke/CI tests.
