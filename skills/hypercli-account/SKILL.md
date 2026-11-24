---
name: hypercli-account
description: >
  Inspect the active HyperCLI identity, capabilities, and entitlements with
  hyper me, discover live personas with hyper persona list and get, resolve
  effective persona and owner context through the hypercli-agents MCP server,
  manage account profile and Agent metadata with hyper user and hyper soul,
  write the local product API key with hyper
  configure, and check billing balance, API keys, and wallet with hyper
  billing, hyper keys, and hyper wallet. Use for who-am-I, capability,
  entitlement, profile, and balance questions; hypercli-auth owns credential
  precedence and auth failure diagnosis, and grant-code redemption belongs
  to hypercli-agents.
commands:
  - hyper me
  - hyper me --json
  - hyper persona list
  - hyper persona get <id>
  - hyper persona resolve
  - hyper user
  - hyper agent <id> soul
  - hyper configure
  - hyper billing balance
  - hyper keys list
  - hyper wallet balance
---

# HyperCLI Account

Load the `hypercli` and `hypercli-auth` skills before account work. This
skill covers identity, profile and Agent metadata, billing, API keys,
wallet, and local credential commands; `hypercli-auth` owns credential
precedence, environment selection, and failure diagnosis. Reference:
`/opt/hypercli/docs/cli/configuration.mdx`. Confirm exact flags against the
installed `--help` when exactness matters.

## Complete command map

| Area | Command |
| --- | --- |
| Identity, capabilities, entitlements | `hyper me` |
| Live persona catalog and content | `hyper persona list`, `hyper persona ls`, `hyper persona get <id>` |
| Effective persona and owner USER (CLI fallback) | `hyper persona resolve [--agent <id>]` |
| Read, set, or clear Agent persona selection | `hyper agent <id> persona [<persona-id>] [--clear]` |
| Account profile | `hyper user [--json] [-f <file>|-]` |
| Agent soul | `hyper soul [--agent <id>] [-f <file>|-]` |
| Canonical Agent SOUL by ID | `hyper agent <id> soul` |
| Write the local product API key | `hyper configure` |
| Balance, invoices, transactions | `hyper billing balance` |
| API keys | `hyper keys list`, `hyper keys create` |
| Wallet | `hyper wallet balance`, `hyper wallet topup` |

Map rows without a section below — `hyper keys create`, `hyper wallet
topup` — are mutations: obtain approval first, and confirm their exact
flags through `--help` before running.

## Identity and entitlements

```bash
hyper me
hyper me --json
```

`hyper me` resolves the active credential and reports the account identity,
the capabilities that key holds, and entitlement state. Read the capability
list before assuming a key may run jobs, flows, agents, or voice: a working
identity does not prove every scope is present. Use `--json` only in
private automation — the payload contains account and key identifiers.

Grant-code redemption changes entitlements; it is owned by
`hypercli-agents`.

## Profile and Agent metadata

Discover current personas with `hyper persona list` (alias `ls`), then inspect
one with `hyper persona get <id>`. Both fetch live content; no generated persona catalog is installed with the CLI.
These commands accept `--json` and `--source live`; there is no offline persona
fallback. Catalog failures are errors, not an empty catalog.

For session context, call `hyper_persona_resolve` on the local `hypercli-agents`
MCP server. One call returns the owner's USER and effective SOUL (the selected
persona, otherwise the Agent's canonical SOUL). For just one, call `hyper_user`
or `hyper_soul`. Look for `hypercli-agents_<tool>` or the `hypercli-agents`
namespace. The server applies enabled disk overrides; do not read or write the
context files yourself.

Only if those tools are unavailable, use `hyper persona resolve`. Runtime-bound
keys resolve their own Agent; owner keys supply `--agent <id>`. Empty USER or
SOUL is valid. Report a resolver failure rather than treating it as empty or
substituting retained files.

`hyper user` and `hyper soul` print Backend-owned Markdown; use `-f <file>` or
`-f -` to replace it.
`hyper soul` reads canonical SOUL only, not the selected effective persona.
Runtime self keys cannot mutate SOUL or persona selection; those changes require
an authorized owner key.
After confirming the exact Agent and obtaining approval, select a catalog ID
with `hyper agent <id> persona <persona-id>`, or clear the selector with
`hyper agent <id> persona --clear` to use canonical SOUL. Blank IDs are invalid.
Omitting the value reads the selector. Selection changes Backend metadata, not
persona service source.
API-key SOUL/selector writes require owner access and `agents:*`; even a wildcard
runtime-agent key cannot self-write those fields.
For `hyper soul`, user-scoped keys require `--agent <id>`. Confirm the exact
target and obtain approval before replacing Backend-owned content.

The product MCP offers `hyper_persona_list` and `hyper_persona_get` for catalog
discovery. Approved remote writes
(product MCP only) use `hyper_user_update(profile)`, `hyper_soul_update(soul,
agent_id)`, and `hyper_persona_set(persona_id, agent_id)`. Discover the actual
tool schema before calling. Each replacement/selector argument is required:
explicit null clears it; empty USER/SOUL strings store empty Markdown, while
blank persona IDs are invalid. Omit `agent_id` only with an exactly bound key;
target resolution grants no write permission. USER writes require the existing
user-family permission, not the Agent-bound profile-read exception. MCP forwards
the caller's credential and does not bypass Backend owner/scope checks.

## Local credential configuration

```bash
hyper configure
```

`hyper configure` writes the product API key to `$HYPER_HOME/config`, or
`~/.hypercli/config` when `HYPER_HOME` is unset, so it persists across
sessions. The saved key is not always the active credential;
`hypercli-auth` owns the exact chain. After configuring, verify once with
`hyper me` and report the resulting identity, never the key.

## Failure and completion rules

- A `401` means the resolved credential is rejected; follow `hypercli-auth`
  and do not retry with guessed alternates.
- A `403` means a valid identity lacks the capability; re-check the
  capabilities reported by `hyper me` instead of swapping keys.
- Never print the API key, saved config contents, or another account's
  identifiers in a response.
- Report the resolved environment (prod/dev), the identity, the
  capabilities relevant to the task, and the entitlement state — never the
  credential.
