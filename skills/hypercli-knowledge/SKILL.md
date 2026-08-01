---
name: hypercli-knowledge
description: >
  Upload and inspect platform files, manage durable HyperCLI shared knowledge
  workspaces, search/sync/download Markdown projections, control grants, and
  convert captions or documents into local OpenClaw memory. Use for hyper
  files, hyper workspaces, and hyper memory commands.
---

# HyperCLI Knowledge

Load the `hypercli` and `hypercli-auth` skills before remote operations. Load
the `hypercli-flows` skill when a file is only an input to media rendering.
Managed image references are:

- `/opt/hypercli/docs/cli/commands/files.mdx`
- `/opt/hypercli/docs/cli/commands/workspaces.mdx`
- `/opt/hypercli/docs/cli/commands/memory.mdx`

## Choose the storage surface

| Need | Surface |
| --- | --- |
| Reusable upload ID for flows/renders | `hyper files` |
| Durable originals, Markdown projections, search, grants, agent sync | `hyper workspaces` |
| Local OpenClaw-indexable Markdown generated from source files | `hyper memory import` |

These are not interchangeable. A platform file ID is not a Workspace path;
local memory import does not upload anything unless `--enrich` calls the model
API, and Workspace `enrich` only builds a payload.

## Platform files

Complete commands: `upload`, `upload-url`, `get`, and `delete`.

```bash
hyper files upload ./reference.png
hyper files upload ./reference.png --no-wait
hyper files upload-url https://example.com/reference.png
hyper files get <file-id>
hyper files delete <file-id>
```

`upload` requires a readable local file. `upload-url` asks the platform to
fetch the URL; do not submit private-network targets, expiring secret-bearing
URLs, or a third party's content without permission. Both wait for processing
by default and print the ID, filename/state, and selected metadata. With
`--no-wait`, "Queued" or `processing` is not ready for downstream consumption.

The current file commands have no JSON output flag. Capture the returned ID
carefully rather than scraping an unrelated URL or status line. `get` shows
state/error/URL. A returned URL may be scoped or time-limited; do not publish
it.

`delete` asks for confirmation unless `--yes`; deletion can break pending or
reproducible renders. Resolve the exact ID and check its use before approval.

## Workspace command map

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

## Local memory import

`hyper memory` has one command, `import`:

```bash
hyper memory import ./notes \
  --collection research/project \
  --workspace ~/.openclaw/workspace
```

Supported captions are `.srt`, `.vtt`, and `.ttml`; documents are `.pdf`,
`.doc`, `.docx`, `.epub`, `.txt`, and `.md`. A directory is searched
recursively. Install `hypercli-cli[documents]` for PDF/DOCX/EPUB extraction.
Legacy `.doc` also requires the external `antiword` executable on `PATH`;
convert it to DOCX or PDF when that tool is unavailable. Plain text, Markdown,
and caption conversion do not need optional dependencies.

`--collection` is required and selects a path below the memory root. The root
defaults to `<workspace>/memory`, where workspace defaults to
`~/.openclaw/workspace`; `--memory-dir` or `HYPER_MEMORY_DIR` overrides it.
The command prints each generated Markdown path and transcript-line or
word/character counts.

For one input, metadata options include `--source-id`, `--title`,
`--source-url`, caption channel/language/kind/participants, or document author
and source type. `--source-id`, `--title`, `--source-url`, and `--raw-json3`
are rejected for multi-file imports; JSON3 applies only to captions.
`--no-copy-raw` prevents copying original/raw companion files into the memory
artifact tree.

Optional work changes the trust boundary:

```bash
hyper memory import ./notes.txt --collection research \
  --enrich --model <model-id>
hyper memory import ./notes --collection research --index --agent <agent-id>
```

`--enrich` sends sampled extracted text to the remote `/v1` LLM API to produce
summary/keyword metadata. Without it, conversion is local. `--index` invokes
the local subprocess `openclaw memory index` after every import and fails the
command if indexing fails. Generated files can still exist after that failure;
do not rerun import blindly without inspecting them.

## Completion and safety

- Distinguish uploaded, processing, ready, failed, synced, and locally indexed
  states. They are separate milestones.
- Treat originals, generated Markdown, search results, grants, signed URLs, and
  file IDs as potentially private.
- On a conversion failure, report the exact source and any generated paths;
  directory imports can partially succeed before a later file fails.
- Report workspace/file address, processing state, local destination, and
  whether raw or Markdown content was used. Never expose a signed URL or key.
