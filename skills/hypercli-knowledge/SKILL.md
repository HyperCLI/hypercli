---
name: hypercli-knowledge
description: >
  Upload and inspect platform files, manage durable HyperCLI shared knowledge
  workspaces, search/sync/download Markdown projections, control grants, and
  search session memory, inspect history, and request summary rebuilds. Use for hyper
  files, hyper workspaces, and hyper memory commands. When a file exists only
  as an input to media rendering, use the hypercli-flows skill instead; this
  skill owns durable knowledge, not render inputs.
commands:
  - hyper files upload ./reference.png
  - hyper files get <file-id>
  - hyper workspaces create "Team Knowledge" --slug team-knowledge --output json
  - hyper workspaces list
  - hyper workspaces search "launch notes" --output json
  - hyper workspaces upload team-knowledge ./report.pdf --path projects/acme/report.pdf --output json
  - hyper workspaces wait-until-processed team-knowledge projects/acme/report.pdf --timeout 300 --poll-interval 2
  - hyper workspaces sync team-knowledge --output-dir ~/workspaces
  - hyper workspaces grant team-knowledge --agent-id <agent> --role viewer
  - hyper workspaces revoke-grant team-knowledge <grant-id>
  - hyper memory search "launch notes" --session-id <session-id> --json
  - hyper memory summary <session-id> --json
  - hyper memory chunks <session-id> --limit 50 --json
  - hyper memory tail <session-id> --n 20 --json
  - hyper memory rebuild <session-id> --json
---

# HyperCLI Knowledge

Load the `hypercli` and `hypercli-auth` skills before remote operations. Load
the `hypercli-flows` skill when a file is only an input to media rendering.
Confirm exact flags with each command's `--help` when exactness matters; when
help and this skill disagree, follow help and report the drift. Managed image
references are:

- `/opt/hypercli/docs/cli/commands/files.mdx`
- `/opt/hypercli/docs/cli/commands/workspaces.mdx`
- `/opt/hypercli/docs/cli/commands/memory.mdx`

## Choose the storage surface

| Need | Surface |
| --- | --- |
| Reusable upload ID for flows/renders | `hyper files` |
| Durable originals, Markdown projections, search, grants, agent sync | `hyper workspaces` |
| Indexed session memory, summaries, and recent conversation history | `hyper memory` |

These are not interchangeable. A platform file ID is not a Workspace path or
session ID. Memory commands use the remote session-memory API; Workspace
`enrich` only builds a payload.

## Platform files

Complete commands: `upload`, `get`, and `delete`.

```bash
hyper files upload ./reference.png
hyper files get <file-id>
hyper files delete <file-id> --yes
```

`upload` requires a readable local file and returns only once processing makes
the upload usable in renders. All three accept the CLI-wide `--json` machine
output flag; under `--json`, `delete` skips the confirmation prompt like
`--yes`. Capture the returned ID carefully. `get` shows state/error/URL. A
returned URL may be scoped or time-limited; do not publish it.

`delete` asks for confirmation unless `--yes` (or `--json`); deletion can break
pending or reproducible renders. Resolve the exact ID and check its use before
approval.

## Workspace command map

All rows run under `hyper workspaces <command>` (for example
`hyper workspaces list`).

| Area | Commands |
| --- | --- |
| Workspace lifecycle | `create`, `list`, `update`, `delete` |
| Discovery | `search`, `search-files`, `manifest` |
| Source lifecycle | `upload`, `wait-until-processed`, `regenerate`, `delete-file` |
| Retrieval | `download`, `download-url`, `sync` |
| Access | `grant`, `grants`, `revoke-grant` |
| Local payload prep | `enrich` |

Most table-oriented commands accept `--output table|json`. `manifest` always
prints JSON. `sync` uses `--json` rather than `--output json`, and `download`
uses `--json` for machine-readable local-file metadata.

### Workspace lifecycle and search

```bash
hyper workspaces create "Team Knowledge" --slug team-knowledge --output json
hyper workspaces list
hyper workspaces update team-knowledge --description "Current launch context"
hyper workspaces search "launch notes" --output json
hyper workspaces search-files team-knowledge "visual language" --no-vector
```

`update` requires at least one of `--name`, `--slug`, or `--description`.
`search` spans accessible workspaces; `search-files` is scoped to one. Vector
search is on by default and can be disabled for exact/metadata-only behavior.
Scores and match reasons are relevance signals, not proof that a file contains
the answer; retrieve the selected projection before citing it.

`delete <workspace>` is a soft delete but has no confirmation prompt. Confirm
the slug/ID and downstream grants/sync consumers first.

Explicit `--user-id` and `--agent-id` select the authorization subject for
supported calls and are primarily for agent or local/dev contexts. Never use a
different subject to bypass access control. When sync receives neither, it
resolves the authenticated runtime agent or current user.

### Upload and processing

```bash
hyper workspaces upload team-knowledge ./report.pdf \
  --path projects/acme/report.pdf --output json
hyper workspaces wait-until-processed team-knowledge \
  projects/acme/report.pdf --timeout 300 --poll-interval 2
hyper workspaces manifest team-knowledge
```

An upload stores the original and queues its Markdown projection. Retain its
workspace-relative path/file ID and wait when the next action requires ready
Markdown. A successful upload is not successful conversion. `manifest` shows
active projection paths and states.

`regenerate` queues a new Markdown projection and must be followed by
`wait-until-processed` before consumption:

```bash
hyper workspaces regenerate team-knowledge projects/acme/report.pdf
hyper workspaces delete-file team-knowledge projects/acme/obsolete.pdf
```

`delete-file` soft-deletes without confirmation. Obtain approval and use the
exact relative path or file ID.

### Download and signed URLs

Markdown is the default; raw returns the original:

```bash
hyper workspaces download team-knowledge projects/acme/report.pdf \
  --output report.md
hyper workspaces download team-knowledge projects/acme/report.pdf \
  --raw --output report.pdf
hyper workspaces download-url team-knowledge projects/acme/report.pdf \
  --output json
```

`download` also accepts one `slug/path` argument or reads that address from
stdin. `--raw` and `--md` are mutually exclusive. Without `--output`, raw uses
the source basename; Markdown uses `<source-basename>.md` (for example,
`report.pdf.md`). Parent directories are created and existing files are
overwritten, so choose an explicit safe destination.

With `--json --raw` and no destination, the CLI writes a temporary file and
prints its `local_path`. JSON does not put raw bytes on stdout.

`download-url` returns a time-limited signed URL for the original. The URL is a
bearer capability until expiry; never paste it into public logs or durable
documents.

### Sync

```bash
hyper workspaces sync team-knowledge --output-dir ~/workspaces
hyper workspaces sync --all --ready-only \
  --output-dir ~/workspaces --json
```

Pass either one workspace or `--all`, not both. `--ready-only` avoids writing
unfinished projections. The deterministic layout is
`<root>/<workspace-slug>/<source-folder>/.tomd/<source-stem>.md`. Sync writes
remote Markdown into the local tree; inspect destination ownership and avoid
overwriting a user's edited copy. Agents commonly sync to
`/home/node/workspaces` during boot.

### Grants

```bash
hyper workspaces grant team-knowledge --agent-id <agent> --role viewer
hyper workspaces grant team-knowledge --user-subject-id <user> --role contributor
hyper workspaces grants team-knowledge --output json
hyper workspaces revoke-grant team-knowledge <grant-id>
```

Grant requires exactly one agent or user subject. Roles are `viewer`,
`contributor`, and `admin`. Use least privilege, obtain approval, and list
grants afterward. Revoke has no confirmation prompt and may break active agent
sync.

### Enrichment payload

```bash
hyper workspaces enrich team-knowledge/projects/acme/report.pdf \
  --dir ./generated-markdown --json > enrichment.json
```

The directory must contain at least one Markdown file. The command recursively
reads all `.md` files and builds an address/workspace/path/files JSON payload,
marking the first sorted file primary. It does not submit that payload to the
Workspace API. Review Markdown for secrets before passing the result anywhere.

## Session memory

`hyper memory` supports `search`, `summary`, `chunks`, `tail`, and `rebuild`.
All accept `--json`. There is no local file-import command.

```bash
hyper memory search "launch notes" --session-id <session-id> --limit 50 --json
hyper memory search "launch notes" --agent-id <agent-uuid> --json
hyper memory summary <session-id> --json
hyper memory chunks <session-id> --limit 50 --json
hyper memory tail <session-id> --n 20 --json
hyper memory rebuild <session-id> --json
```

- `search` searches indexed session chunks. Optional `--session-id` (`-s`)
  and `--agent-id` (`-a`) scope the query; the agent ID must be a full UUID.
- `summary`, `chunks`, `tail`, and `rebuild` each require one session ID.
  `summary --json` exposes summary text, coverage cursor, timestamps, pending
  state, and failure information.
- `search` and `chunks` accept `--limit` and `--cursor`. Follow `nextCursor`
  while `hasMore` is true; one page is not the complete result. `chunks`
  returns indexed text in ascending sequence order.
- `tail` returns recent logical text messages in chronological order, not raw
  event frames. `--n` defaults to 20. Both `--n` and `--limit` accept integers
  from 1 to 100.
- `rebuild` requests a summary rebuild, limited by the server to once per
  24 hours. A pending response is not a completed summary. Inspect `summary`
  afterward and report pending or failure state honestly. Honor retry-after
  information on errors; do not blindly repeat an uncertain rebuild request.

## Completion and safety

- Distinguish uploaded, processing, ready, failed, and synced workspace states
  from session-memory summary pending/completed/failed states.
- Treat originals, generated Markdown, search results, grants, signed URLs, and
  file IDs as potentially private.
- For session memory, report the session scope, pagination completeness, and
  summary state; search hits and recent history do not prove summary coverage.
- Report workspace/file address, processing state, local destination, and
  whether raw or Markdown content was used. Never expose a signed URL or key.
