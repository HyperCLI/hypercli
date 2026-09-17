---
name: hypercli-auth
description: >
  Diagnose and configure HyperCLI credentials, API bases, and inactive keys,
  and authenticate hosted Buzz coding-runtime harnesses. Use when choosing
  between HYPER_API_KEY, HYPERCLI_API_KEY, and HYPER_AGENTS_API_KEY, running
  hyper me safely, applying hyper configure, or signing OpenCode, Goose,
  Claude Code, Codex, or Kimi Code into a hosted runtime.
---

# HyperCLI Authentication

Load the `hypercli` skill for the operation itself. Use this skill before
changing a credential, API base, or coding-harness login.

Keep these authorities separate:

- **HyperCLI product auth** covers identity, jobs, uploads, flows, and
  voice — everything resolves through the product key chain below.
- **HyperCLI agent/runtime auth** covers the managed-agent APIs and is
  normally narrower than product auth.
- **Harness/vendor sign-in** belongs to Claude Code, Codex, OpenCode,
  Goose, or Kimi Code. A HyperCLI key is not automatically an Anthropic,
  OpenAI, or Moonshot login.

Never invent a credential bridge between these authorities.

## Resolve Credentials Exactly

The product credential resolves in this order:

1. Environment `HYPER_API_KEY`.
2. Environment legacy `HYPERCLI_API_KEY`.
3. The key saved by `hyper configure` in `~/.hypercli/config`.

Agent APIs try that same product chain first, then fall back to an
environment `HYPER_AGENTS_API_KEY`. Precedence is grouped by source: a
saved key never beats an environment key, and writing a lower-priority
source does not change the active credential. Unset or replace the actual
winning source.

`hyper configure` is the preferred way to set the local product key; it
writes `~/.hypercli/config` read-only to the current user. Do not pass key
literals on other command lines — they leak through shell history and
process lists.

## API Base and Environment Selection

`--dev` switches the CLI to the dev control plane; combined with `--json`
it covers most diagnosis. Do not select `--dev` or another API base unless
the user explicitly intends that environment. Read the
[configuration reference](/opt/hypercli/docs/cli/configuration.mdx) before
changing a base URL setting.

## Diagnose Without Revealing Secrets

Print source names, never values:

```bash
test -n "${HYPER_API_KEY:-}" && echo HYPER_API_KEY present || echo HYPER_API_KEY missing
test -n "${HYPERCLI_API_KEY:-}" && echo HYPERCLI_API_KEY present || echo HYPERCLI_API_KEY missing
test -n "${HYPER_AGENTS_API_KEY:-}" && echo HYPER_AGENTS_API_KEY present || echo HYPER_AGENTS_API_KEY missing
test -s ~/.hypercli/config && echo config present || echo config missing
```

Then test identity once:

```bash
hyper me
```

`hyper me` prints identity, capability, and entitlement fields for the
active key. Its output can include account and key identifiers; keep it
private and use `hyper me --json` only for private automation. A `401`
there means the resolved credential is rejected, not that one group is
misconfigured.

## Handle Inactive Or Under-Scoped Keys

A `401` detail such as `API key is inactive` means the selected key was
recognized but deactivated. Stop; retrying cannot reactivate it.

1. Record only the winning source name, resolved environment (prod/dev),
   status, and server detail.
2. Replace or activate the key at the highest-priority source.
3. Run `hyper me` once more before retrying the original operation.

A `403` usually means a valid identity lacks the requested capability.
Inspect the capabilities shown by `hyper me`; do not substitute another
credential without the user's authorization.

Hosted runtime keys are injected by the control plane and revoked during
runtime cleanup. Do not copy an injected runtime key into persistent config
or vendor sign-in files.

## Keep Secrets Out Of State And Output

- Prefer `hyper configure` for a normal local product key; it writes
  `~/.hypercli/config` with restrictive permissions. Environment values
  still win.
- Treat `~/.hypercli/config`, `~/.hypercli/agents.json`, and harness
  sign-in files as secrets.
- Do not dump `env`, `printenv`, config files, or `hyper agents ls --json`
  while debugging. Agent inventory can include launch environment values.
- Never send a credential through source control, an issue, or a shell
  command recorded in history.

Hosted Buzz images are not a general secret vault: launch environment can
be exposed through management APIs and egress is not restricted. Do not
inject a valuable long-lived vendor key when creating or starting Buzz
runtimes.

## Authenticate Hosted Buzz Runtimes

First identify the runtime without reading secrets:

```bash
buzz-acp auth-methods --json
buzz-acp models --json
```

The control plane injects a scoped `HYPER_AGENTS_API_KEY` plus the API base
settings. It intentionally does not inject the owner's general
`HYPER_API_KEY`. The runtime key typically permits file, flow, model, and
voice routes while denying agent management.

| Runtime | What works in the hosted image | What does not happen |
| --- | --- | --- |
| OpenCode | A seeded HyperCLI provider reads the runtime key and API base. Zero entries from `opencode auth list` does not invalidate this env-backed provider. | The runtime key is not converted into an OpenCode vendor login. |
| Goose | A seeded `hypercli` custom provider reads the runtime key and agents base; no vendor login is required for that provider. | The runtime's provider method does not grant new HyperCLI scopes. |
| Claude Code | The image exposes `claude-ai-login` and `console-login`; inspect with `claude auth status --json`. | `HYPER_AGENTS_API_KEY` is not Anthropic Console, Claude subscription, or SSO auth. |
| Codex | The image exposes API-key and OpenAI account sign-in methods; inspect with `codex login status`. | The runtime key is not an OpenAI key or account login. Do not seed `.codex/auth.json` with it as an inferred bridge. |
| Kimi Code | The image exposes upstream `login`; inspect with `kimi login --help`. | The runtime key is not a Moonshot/Kimi login. |

OpenCode and Goose should normally start with the injected HyperCLI
provider. If `buzz-acp models --json` fails, check presence only with the
`test -n` form above; do not print the values or copy the runtime key into
another file.

Claude Code, Codex, and Kimi Code require upstream human-owned sign-in
state. An operator may enter the runtime through an approved interactive
session:

```bash
hyper agents shell <agent>
```

Inside that private terminal, use the vendor's installed help and human
flow, for example `claude auth status --json` and `claude auth login`,
`codex login status`, or `kimi login`. The human must complete browser,
device, subscription, SSO, or secret prompts. The remote agent must not ask
for a token in-band, select a different account, or claim success before
the vendor status command succeeds. A running harness process may need an
operator-approved restart to read newly written sign-in state; do not
restart it implicitly.

If installed versions disagree with this matrix, stop and inspect their
current `--help` output and `/opt/hypercli/skills`. Do not improvise a
login bridge.
