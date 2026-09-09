---
name: hypercli
description: >
  Operate HyperCLI product APIs, GPU jobs, media flows, voice, and managed
  agents with the hyper CLI. Use as the router for identity, credentials,
  agents, compute, flows, files, and voice operations.
---

# HyperCLI

Use the bundled `hyper` command. Run `hyper --help` and
`hyper <group> --help` before guessing flags. Detailed references live under
`/opt/hypercli/docs/cli/` in managed images.

For credential resolution or coding-harness login, load the `hypercli-auth`
skill. For identity and entitlements load `hypercli-account`. For media
generation load `hypercli-flows`. For GPU jobs load `hypercli-compute`. For
managed runtimes load `hypercli-agents`. For text-to-speech load
`hypercli-voice`.

## Root surface

The v1 command tree is deliberately small:

- `hyper me`: identity, capabilities, and entitlements for the active key.
- `hyper configure`: write the local product API key to
  `~/.hypercli/config`.
- `hyper skills`: inventory and print the skills bundled with this CLI.
- Groups: `hyper agents`, `hyper jobs`, `hyper flow`, `hyper files`,
  `hyper voice`.

Every command accepts `--json`; `--dev` selects the dev environment, and
mutations accept `--dry-run` for preflight validation. Do not select
`--dev` or another environment unless the user explicitly intends it.

## Authentication

`HYPER_API_KEY` authenticates product APIs, with legacy `HYPERCLI_API_KEY`
next and the key saved by `hyper configure` in `~/.hypercli/config` last.
Environment values override the saved key. Agent APIs try that same chain
first and then fall back to `HYPER_AGENTS_API_KEY`. Load `hypercli-auth`
before changing any of these sources.

Never print, paste, or send a credential. Before a costly or mutating
operation, validate the intended identity:

```bash
hyper me --json
```

If this returns `401` or says the key is inactive, stop. Do not retry or
select another saved key. Report the API base, credential source name, and
server detail, then follow the `hypercli-auth` skill. See
[configuration.mdx](/opt/hypercli/docs/cli/configuration.mdx#diagnosing-401-errors).

## Remote Agents

Start with table output:

```bash
hyper agents ls
hyper agents status <agent>
hyper agents logs <agent>
```

Add `-f` to follow logs, and use `hyper agents wait <agent> --state <state>`
when the next step depends on a target state. For lifecycle, routines,
container access, and runtime configuration, load the `hypercli-agents`
skill.

Do not paste raw `ls --json` output: it can contain launch environment
secrets. Treat log, exec, shell, file-copy, token, config, and routine
output as sensitive. Get approval before `exec`, `shell`, `cp` to a remote
destination, `agents config` changes, lifecycle mutations, or archive and
restore, and dry-run mutations first. Read
[agents.mdx](/opt/hypercli/docs/cli/commands/agents.mdx).

## Reference Map

- `configure`, `me`, `skills`: `/opt/hypercli/docs/cli/configuration.mdx`
- `agents`: `/opt/hypercli/docs/cli/commands/agents.mdx`
- `jobs`: `/opt/hypercli/docs/cli/commands/jobs.mdx`
- `flow`: `/opt/hypercli/docs/cli/commands/flow.mdx`
- `files`: `/opt/hypercli/docs/cli/commands/files.mdx`
- `voice`: `/opt/hypercli/docs/cli/commands/voice.mdx`

If `/opt/hypercli` is unavailable, rely on command help rather than
inventing a contract.
