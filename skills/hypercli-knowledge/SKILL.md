---
name: hypercli-knowledge
description: >
  Upload and inspect platform files, manage durable HyperCLI shared knowledge
  workspaces through the Python SDK, search/sync/download Markdown projections,
  control grants, and
  search session memory, inspect history, and request summary rebuilds. Use for hyper
  files and hyper memory commands, and SDK workspace workflows. When a file exists only
  as an input to media rendering, use the hypercli-flows skill instead; this
  skill owns durable knowledge, not render inputs.
commands:
  - hyper files upload ./reference.png
  - hyper files get <file-id>
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
- `/opt/hypercli/docs/sdk/workspaces.mdx`
- `/opt/hypercli/docs/cli/commands/memory.mdx`

## Choose the storage surface

| Need | Surface |
| --- | --- |
| Reusable upload ID for flows/renders | `hyper files` |
| Durable originals, Markdown projections, search, grants, agent sync | Python SDK `client.workspaces` |
| Indexed session memory, summaries, and recent conversation history | `hyper memory` |

These are not interchangeable. A platform file ID is not a Workspace path or
session ID. Memory commands use the remote session-memory API. The supported
TypeScript CLI has no workspace command group; use the SDK below.

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

## Workspace Python SDK

Use the source-built `hypercli-sdk` package from the public repository's
`py-sdk` directory (Python 3.10+). From a checked-out `HyperCLI/hypercli` root:

```bash
python3 -m pip install ./py-sdk
```

The examples below share this setup and use configured credentials without
embedding keys:

```python
from pathlib import Path
from hypercli import HyperCLI

client = HyperCLI()
ws = client.workspaces
workspace = "team-knowledge"  # workspace slug or ID
source = "projects/acme/report.pdf"
```

The supported methods and signatures live in `py-sdk/hypercli/workspaces.py`.
Workspace calls authenticate with the client's key; `user_id` and `agent_id`
parameters do not override the bearer identity.

### Discovery and workspace management

```python
created = ws.create(name="Team Knowledge", slug="team-knowledge")
workspaces = ws.list()
details = ws.get(workspace)
updated = ws.update(workspace, description="Current launch context")
matches = ws.search("launch notes")
files = ws.search_files(workspace, "visual language", vector=False)
```

`search` spans accessible workspaces; `search_files` is scoped to one. Both
default to `vector=True`. Scores and match reasons are relevance signals;
retrieve the selected projection before citing it. `create`, `get`, and
`update` return Workspace records; searches return lists of records.
`ensure_workspace(name=..., slug=...)` can reuse an existing workspace and
returns a result with `workspace` and `created` fields.

### Upload and processing

```python
uploaded = ws.upload(workspace, "./report.pdf", workspace_path=source)
ready = ws.wait_until_processed(workspace, uploaded.path,
                                timeout=300, poll_interval=2)
manifest = ws.manifest(workspace)
```

Upload stores the original and queues its Markdown projection. Retain the
workspace-relative path/file ID. Upload success is not conversion success:
`wait_until_processed` requires both file and processing states to be
`processed`, raises on failed/deleted states, and times out otherwise.
`manifest.markdown_files` contains projection entries and states.

To regenerate a projection, call `ws.regenerate_file(workspace, source)` and
then `ws.wait_until_processed(workspace, source)` before consumption.
`ws.get_file(workspace, source)` and `ws.list_files(workspace)` inspect sources.

### Download and signed URLs

```python
Path("report.md").write_bytes(ws.download(workspace, source))
Path("report.pdf").write_bytes(ws.download(workspace, source, raw=True))
metadata, markdown = ws.markdown_file(workspace, source)
signed = ws.download_url(workspace, source)
```

`download` returns bytes (Markdown by default, original with `raw=True`);
it does not choose or write a local destination. `markdown_file` returns a
metadata dictionary and decoded Markdown text. Choose explicit destinations;
`Path.write_bytes` overwrites existing files and requires parent directories
to exist. A returned `signed.url` is a time-limited bearer capability: do not
publish it or blindly execute a returned `download_command` string.

### Sync

```python
root = str(Path("~/workspaces").expanduser())
written = ws.sync_manifest(workspace, root, ready_only=True)
all_written = ws.sync_all(root, ready_only=True)
```

`sync_manifest` returns written paths; `sync_all` returns paths keyed by
workspace slug. The layout is
`<output_dir>/<workspace-slug>/<manifest-entry-path>.md`. `ready_only=True`
skips entries not marked `processed` and missing Markdown responses. Sync
creates parent directories and overwrites files; inspect destination ownership
first. A failed sync can leave earlier files written; report partial results.

### Grants and deletion

```python
grant = ws.grant(workspace, subject_type="agent", subject_id="<agent-id>",
                 role="viewer")
grants = ws.list_grants(workspace)
# When revocation is intended:
ws.revoke_grant(workspace, grant.id)
```

Use `subject_type="user"` and the user ID for a user grant. Roles are `viewer`,
`contributor`, and `admin`. Use least privilege and inspect grants afterward.
`ws.access_snapshot(workspace)` distinguishes an admin's direct-access listing
from the current-access-only view available to other roles.

`ws.delete_file(workspace, source)` deletes a source;
`ws.delete_workspace(workspace)` deletes the workspace. These SDK methods and
`revoke_grant` have no interactive confirmation. Confirm the exact target and
downstream consumers before deletion or revocation.

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
