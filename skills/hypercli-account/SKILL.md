---
name: hypercli-account
description: >
  Inspect the active HyperCLI identity, capabilities, and entitlements with
  hyper me, manage the account profile and Agent soul or role metadata with
  hyper user and hyper soul, write the local product API key with hyper
  configure, and check billing balance, API keys, and wallet with hyper
  billing, hyper keys, and hyper wallet. Use for who-am-I, capability,
  entitlement, profile, and balance questions; hypercli-auth owns credential
  precedence and auth failure diagnosis, and grant-code redemption belongs
  to hypercli-agents.
commands:
  - hyper me
  - hyper me --json
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
| Account profile | `hyper user [--json] [-f <file>|-]` |
| Agent soul | `hyper soul [--agent <id>] [-f <file>|-]` |
| Agent role identifier | `hyper role [--agent <id>] [value]` |
| Canonical Agent metadata | `hyper agent <id> soul`, `hyper agent <id> role [value]` |
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

`hyper user` and `hyper soul` print Backend-owned Markdown; use `-f <file>` or
`-f -` to replace it. `hyper role` prints a role identifier, not a role document.
Shorthand soul/role commands resolve one Agent through Backend key identity;
user-scoped keys require `--agent <id>` or canonical `hyper agent <id> ...`.
Do not substitute local USER.md, SOUL.md, or role files. The `-f` and
`[value]` write forms replace Backend-owned content — remote mutations:
confirm the exact Agent and obtain approval before writing.

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
