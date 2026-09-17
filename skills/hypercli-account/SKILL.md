---
name: hypercli-account
description: >
  Inspect the active HyperCLI identity, capabilities, and entitlements with
  hyper me, and set up the local product API key with hyper configure. Use
  for who-am-I, capability, entitlement, and credential-setup questions.
---

# HyperCLI Account

Load the `hypercli` and `hypercli-auth` skills before account work. This
skill covers the two account-facing commands; `hypercli-auth` owns
credential precedence, environment selection, and failure diagnosis.
Reference: `/opt/hypercli/docs/cli/configuration.mdx`.

## Complete command map

| Area | Command |
| --- | --- |
| Identity, capabilities, entitlements | `hyper me` |
| Write the local product API key | `hyper configure` |

## Identity and entitlements

```bash
hyper me
hyper me --json
```

`hyper me` resolves the active credential and reports the account identity,
the capabilities that key holds, and entitlement state. Read the capability
list before assuming a key may run jobs, flows, agents, or voice: a working
identity does not prove every scope is present. Use `--dev` only when the
user intends the dev environment, and `--json` only in private automation —
the payload contains account and key identifiers.

## Local credential configuration

```bash
hyper configure
```

`hyper configure` writes the product API key to `~/.hypercli/config` so it
persists across sessions. Environment keys (`HYPER_API_KEY`, then
`HYPERCLI_API_KEY`) still override the saved value, and
`HYPER_AGENTS_API_KEY` remains the final agent fallback; see `hypercli-auth`
for the exact chain. After configuring, verify once with `hyper me` and
report the resulting identity, never the key.

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
