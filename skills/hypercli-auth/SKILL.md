---
name: hypercli-auth
description: >
  Diagnose and configure HyperCLI credentials, API bases, inactive keys, x402
  identity boundaries, and hosted Buzz coding-runtime authentication. Use when
  selecting HYPER_API_KEY versus HYPER_AGENTS_API_KEY, running hyper me safely,
  or authenticating OpenCode, Goose, Claude Code, Codex, or Kimi Code.
---

# HyperCLI Authentication

Load the `hypercli` skill for the operation itself. Use this skill before
changing a credential, API base, wallet identity, or coding-harness login.

Keep these authorities separate:

- **HyperCLI product auth** covers account, billing, jobs, uploads, keys, and
  `/api/auth/me`.
- **HyperCLI agent/runtime auth** is normally narrower and covers allowed agent,
  model, flow, file, voice, web, or workspace routes.
- **Harness/vendor auth** belongs to Claude Code, Codex, OpenCode, Goose, or
  Kimi Code. A HyperCLI key is not automatically an Anthropic, OpenAI, or
  Moonshot login.
- **Wallet/x402 auth** proves the payer for a specific payment flow. It is not a
  replacement for every product-authenticated step.

Never invent a credential bridge between these authorities.

## Resolve Credentials Exactly

The bundled `hyper` command uses the Python SDK. Where a command supports an
explicit `--key`, or code passes `api_key=`/`agent_api_key=`, that explicit
value wins for that path.

The common **product credential** order is:

1. Explicit `--key` or `api_key=`, where supported.
2. Environment `HYPER_API_KEY`.
3. `HYPER_API_KEY` in `~/.hypercli/config`.
4. Environment legacy `HYPERCLI_API_KEY`.
5. Legacy `HYPERCLI_API_KEY` in `~/.hypercli/config`.

The common **agent credential** order is:

1. Explicit `agent_api_key=`, where supported.
2. Environment `HYPER_AGENTS_API_KEY`.
3. `HYPER_AGENTS_API_KEY` in `~/.hypercli/config`.
4. Environment `HYPER_API_KEY`.
5. `HYPER_API_KEY` in `~/.hypercli/config`.
6. Environment legacy `HYPERCLI_API_KEY`.
7. Legacy `HYPERCLI_API_KEY` in `~/.hypercli/config`.

`get_agent_api_key()` stops there. The `hyper agents` group and most
`hyper agent` account queries add `~/.hypercli/agent-key.json` as a final
legacy fallback.

Precedence is grouped by variable name, not by storage type. A saved
`HYPER_AGENTS_API_KEY` therefore beats an environment `HYPER_API_KEY`. Writing
a new lower-priority key does not change the active credential. Remove, unset,
or replace the actual winning source.

The Python `HyperCLI()` client uses the product key for product transports. If
no product key exists, it falls back to the resolved agent key, but that does
not expand the key's scopes. Agent-specific namespaces prefer the resolved
agent key.

### Legacy command exceptions

Do not assume the common resolver applies everywhere:

- `hyper config openclaw` and `hyper config opencode`: explicit `--key`, then
  only `~/.hypercli/agent-key.json`. They do not use the shared config resolver.
- `hyper voice`: explicit `--key`, common product resolution, common agent
  resolution, then a non-expired `agent-key.json`.
- `hyper agent embed`: explicit `--key`, environment `HYPER_API_KEY`, then
  `agent-key.json`; it ignores `~/.hypercli/config`.
- `hyper agent status`: reads `agent-key.json` locally and does not validate the
  key against the API.

Run `hyper <group> <command> --help` before relying on a key flag. Avoid
`--key <literal>` because it can enter shell history and process listings.

### Compatibility configuration commands

Two legacy `hyper agent` commands still own local provider configuration:

```bash
hyper agent openclaw-setup
hyper agent openclaw-setup --default
hyper agent config env
hyper agent config openclaw
hyper agent config opencode
```

`openclaw-setup` reads only `~/.hypercli/agent-key.json` and patches the
`models.providers.hypercli` section of `~/.openclaw/openclaw.json`. With
`--default`, it also selects `hypercli/kimi-k2.6-anthropic` as the primary
model. It does not restart OpenClaw.

`agent config` validates a key, fetches the available models, and prints
`env`, `openclaw`, or `opencode` output. Omitting the format prints all three.
Its `--apply` option is valid only for OpenClaw and OpenCode. Prefer the newer
top-level `hyper config openclaw|opencode` form in new automation, but preserve
the compatibility form when maintaining an existing script.

### SDK drift boundary

The TypeScript SDK follows the same per-variable-name ordering as Python. The
Rust provider currently differs: it checks all supported environment key names
before all config-file key names, then `agent-key.json`. Diagnose the `hyper`
CLI with the Python order above; do not import the Rust provider's ordering.

## Resolve Base URLs Exactly

The common **product HTTP base** order is:

1. Explicit `api_url=` or command `--base-url`/`--api-url`, where supported.
2. Environment `HYPER_API_BASE`.
3. `HYPER_API_BASE` in `~/.hypercli/config`.
4. Environment legacy `HYPERCLI_API_URL`.
5. Legacy `HYPERCLI_API_URL` in `~/.hypercli/config`.
6. `https://api.hypercli.com`.

The common **agents HTTP base** order is:

1. Explicit `agents_api_base_url=`, where supported.
2. Environment `AGENTS_API_BASE_URL`.
3. `AGENTS_API_BASE_URL` in `~/.hypercli/config`.
4. With an explicit dev selection, the dev default.
5. Otherwise the resolved `HYPER_API_BASE` or legacy `HYPERCLI_API_URL` in the
   same per-name environment/file order.
6. `https://api.hypercli.com/agents`.

`AGENTS_WS_URL` uses environment, then config, then a WebSocket URL derived from
the resolved agents base. `HYPERCLI_WS_URL` similarly overrides the WebSocket
URL derived from the product base.

Known production and dev hosts normalize to
`https://api.hypercli.com/agents` and
`https://api.dev.hypercli.com/agents`. Do not add `/agents` twice.

Important exceptions:

- `hyper agents` HTTP commands ignore saved URL config. They use environment
  `AGENTS_API_BASE_URL`, then `HYPER_API_BASE`, then legacy
  `HYPERCLI_API_URL`, then the selected prod/dev default. Its WebSocket order is
  an explicit `--agents-ws-url`, then environment `AGENTS_WS_URL`, then derived
  behavior.
- Most `hyper agent` account queries select fixed prod/dev product bases. Their
  deployment helper uses environment `AGENTS_API_BASE_URL`, then
  `HYPER_AGENTS_API_BASE`, then a fixed prod/dev agents base.
- `hyper agent login` uses explicit `--api-url`, then production. It does not
  read the common base resolver.
- `hyper config openclaw|opencode` uses explicit `--base-url`, environment
  `HYPER_API_BASE`, then its prod/dev inference host. It ignores saved URL
  config and legacy `HYPERCLI_API_URL`.
- `hyper voice` uses explicit `--base-url`, environment `HYPER_API_BASE`,
  environment legacy `HYPERCLI_API_URL`, then production; it ignores saved URL
  config and `AGENTS_API_BASE_URL`.

`HYPER_AGENTS_API_BASE` is a hosted-runtime/provider variable, not the canonical
Python CLI agents-base setting. Use `AGENTS_API_BASE_URL` for common CLI/SDK
configuration.

## Generate Provider Config Safely

The current provider-config commands are:

```bash
hyper config openclaw
hyper config opencode --placeholder-env HYPER_AGENTS_API_KEY
hyper agent config env
```

The root `hyper config` commands and compatibility `hyper agent config` share
the same implementation. They validate the selected key and print generated
config unless `--apply` writes the OpenClaw or OpenCode file. Without explicit
`--key`, this legacy path reads only `~/.hypercli/agent-key.json`; it does not
consume the injected runtime key. Avoid a literal command-line key. Use these
commands only in a private session and review the destination before `--apply`.

`hyper agent openclaw-setup` is a separate legacy mutation. It reads
`agent-key.json`, patches `~/.openclaw/openclaw.json`, and preserves unrelated
config. `--default` also selects `hypercli/kimi-k2.6-anthropic` as the primary
model. Back up the file and obtain approval before either form; prefer
`hyper config openclaw` for new instructions.

## Diagnose Without Revealing Secrets

Start by printing source names and resolved bases, never values:

```bash
python - <<'PY'
import os
from pathlib import Path
from hypercli.config import (
    CONFIG_FILE,
    get_agents_api_base_url,
    get_agents_ws_url,
    get_api_url,
    get_ws_url,
)

names = (
    "HYPER_AGENTS_API_KEY",
    "HYPER_API_KEY",
    "HYPERCLI_API_KEY",
    "AGENTS_API_BASE_URL",
    "HYPER_API_BASE",
    "HYPERCLI_API_URL",
    "AGENTS_WS_URL",
    "HYPERCLI_WS_URL",
)
configured = set()
if CONFIG_FILE.exists():
    configured = {
        line.split("=", 1)[0].strip()
        for line in CONFIG_FILE.read_text().splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }

print("environment names:", [n for n in names if os.environ.get(n)])
print("config names:", [n for n in names if n in configured])
print("legacy agent-key present:", (Path.home() / ".hypercli/agent-key.json").exists())
print("product HTTP:", get_api_url())
print("product WS:", get_ws_url())
print("agents HTTP:", get_agents_api_base_url())
print("agents WS:", get_agents_ws_url())
PY
```

Then test identity once:

```bash
hyper me
```

`hyper me` does not print the raw credential, but it prints account, email,
wallet, team, and key identifiers. Keep its output private. Use
`hyper me --output json` only for private automation, not public logs.

`hyper me` is a composite check when product and agent keys differ:

- identity/capability fields come from product `/api/auth/me` using the product
  transport key;
- `agents_*` fields come from a separate agent entitlement request using the
  agent resolver;
- failure of the entitlement request is reported as unavailable without erasing
  a successful product identity.

Do not assume both sections describe the same credential. `hyper status` is a
health check, not an identity check.

## Handle Inactive Or Under-Scoped Keys

A `401` detail such as `API key is inactive` means the selected key was
recognized but deactivated. Stop. Retrying, changing prompts, or switching to
x402 cannot reactivate it.

1. Record only the resolved base, winning source name, status, and server
   detail.
2. Replace or activate the key at the highest-priority source.
3. Run `hyper me` once more before retrying the original operation.

A `403` usually means a valid identity lacks the requested capability. Inspect
the `capabilities` shown by `hyper me`; do not substitute another credential
without the user's authorization.

Orchestra `/api/auth/me` field `has_active_subscription` describes the
Orchestra product subscription only. It is **not** HyperClaw plan or agent
entitlement truth. Read HyperClaw `GET /agents/subscriptions/summary` and treat
the account as active when either `active_subscription_count > 0` or
`active_entitlement_count > 0`; activation-code and other direct entitlements
can make the latter positive while the former remains zero. A `401` or `403`
from that summary means plan state is unknown to the selected key, not that the
account has no plan. Never show a no-plan conclusion from that failure.

An Orchestra `has_active_subscription: false` does not mean the API key itself
is inactive. Conversely, an unexpired timestamp in `agent-key.json` does not
prove the server still accepts that key.

Hosted runtime keys are revoked by the control plane during runtime cleanup.
Do not copy an injected runtime key into persistent config or vendor auth files.

## Keep Secrets Out Of State And Output

- Prefer `hyper configure` for a normal local product key; it writes
  `~/.hypercli/config` with mode `0600`. Environment values still win.
- Treat `config`, `agent-key.json`, `agent-keys.yaml`, `agent-jwt.json`,
  `wallet.json`, `wallet.passphrase`, harness auth files, and
  `~/.hypercli/agents.json` as secrets.
- Legacy agent login/subscription paths do not consistently apply restrictive
  modes and can print key material. After using them privately, enforce:

```bash
chmod 700 ~/.hypercli
find ~/.hypercli -maxdepth 1 -type f -exec chmod 600 {} +
```

- Prefer an encrypted wallet. A plaintext `wallet.json` contains the private
  key even when its file mode is `0600`.
- Do not pass a wallet passphrase with `--passphrase`; use the hidden prompt.
- Do not dump `env`, `printenv`, config files, pod specs, or `hyper agents list
  --json` while debugging. Launch JSON can contain raw environment values.
- Never send a credential through Buzz messages, source control, an issue, or a
  shell command recorded in history.

Hosted Buzz images are not a general secret vault: the `node` user has
passwordless sudo, ACP permission requests are auto-approved, launch environment
can be exposed through management APIs, and egress is not currently restricted.
Do not inject a valuable long-lived vendor key through `hyper agents create` or
`start --env KEY=value`.

## Keep x402 At Its Boundary

- x402 job and flow submission signs a payment with the local wallet and does
  not send a normal HyperCLI API key to the x402 creation endpoint.
- Local file upload still requires product auth, including when the resulting
  flow is paid through x402.
- `hyper wallet topup` requires a product key to resolve the account, then adds
  the wallet payment headers. It is not wallet-only.
- `hyper agent subscribe` can make the plan payment without a product key. It
  may attach `~/.hypercli/agent-jwt.json` to link the payment, then returns and
  saves a new key in `agent-key.json`.
- Render/job access keys returned by x402 are scoped bearer secrets. Preserve
  them privately; do not paste x402 JSON or tables into chat.

Never switch from an inactive product key to x402 automatically. That changes
the payer and sometimes the resulting identity.

## Authenticate Hosted Buzz Runtimes

First identify the image without reading secrets:

```bash
cat /opt/hypercli-buzz/runtime
buzz-acp auth-methods --json
buzz-acp models --json
```

The control plane injects a scoped `HYPER_AGENTS_API_KEY`, `HYPER_API_BASE`, and
`HYPER_AGENTS_API_BASE`. It intentionally does not inject the owner's general
`HYPER_API_KEY`. Default runtime scopes include `agents:none`, `files:*`,
`flows:*`, `models:*`, `voice:*`, `web:*`, and `workspaces:*`.

| Runtime | What works in the hosted image | What does not happen |
| --- | --- | --- |
| OpenCode | A seeded HyperCLI provider reads `HYPER_AGENTS_API_KEY` and `{HYPER_API_BASE}/v1`. Zero entries from `opencode auth list` does not invalidate this env-backed provider. | The runtime key is not converted into an OpenCode vendor login. |
| Goose | A seeded `hypercli` custom provider reads `HYPER_AGENTS_API_KEY` and `HYPER_AGENTS_API_BASE`; no vendor login is required for that provider. | The `goose-provider` ACP method does not grant new HyperCLI scopes. |
| Claude Code | The image exposes `claude-ai-login` and `console-login`; inspect with `claude auth status --json`. | `HYPER_AGENTS_API_KEY` is not Anthropic Console, Claude subscription, or SSO auth. |
| Codex | The image exposes `api-key` and `chat-gpt`; inspect with `codex login status`. | The runtime key is not an OpenAI key or ChatGPT login. Do not seed `.codex/auth.json` with it as an inferred bridge. |
| Kimi Code | The image exposes upstream `login`; inspect with `kimi login --help`. | The runtime key is not a Moonshot/Kimi login. |

OpenCode and Goose should normally start with the injected HyperCLI provider.
If `buzz-acp models --json` fails, check presence only:

```bash
test -n "${HYPER_AGENTS_API_KEY:-}" && echo present || echo missing
test -n "${HYPER_API_BASE:-}" && echo present || echo missing
test -n "${HYPER_AGENTS_API_BASE:-}" && echo present || echo missing
```

Do not print the values or copy the runtime key into another file.

Claude Code, Codex, and Kimi Code require upstream human-owned auth state. An
operator may enter the persistent container home through an approved
interactive session:

```bash
hyper agents shell <agent-id>
```

Inside that private PTY, use the vendor's installed help and human flow:

```bash
claude auth status --json
claude auth login

codex login status
codex login --device-auth

kimi login --help
kimi login
```

The human must complete browser, device, subscription, SSO, or secret prompts.
The remote coding agent must not ask for a token in Buzz, scrape a browser
session, select a different account, or claim success before the vendor status
command succeeds. A running ACP child may need an operator-approved restart to
read newly written auth state; do not restart it implicitly.

Auth state under `/home/node` can persist across managed restarts when home sync
is enabled. That persistence is sensitive. Confirm the user accepts the hosted
image and sync boundary before creating vendor login state there.

If installed versions disagree with this matrix, stop and inspect their current
`--help`, `/opt/hypercli/skills`, and the pinned image source. Do not improvise a
login bridge.
