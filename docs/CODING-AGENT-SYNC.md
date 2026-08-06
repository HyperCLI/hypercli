# Coding Agent Selective Sync Handoff

Status: Client and launch propagation complete; deep storage validation remains
Date: 2026-08-06 UTC  
Related plan: `/tmp/LAGOON-PLAN.md`

## HyperCLI implementation progress

- [x] Preserve this handoff in the HyperCLI repository.
- [x] Add flat `sync_include` / `sync_exclude` launch fields to Python,
  TypeScript, and Rust SDK request types. Explicit empty includes remain
  serializable and mean "sync nothing."
- [x] Give every coding runtime a visible SDK-owned default include policy.
  Buzz Agent deliberately defaults to an empty include because its identity
  and inference credentials are environment-owned.
- [x] Add an explicit SDK `sync_all` / `syncAll` override that clears both
  policy fields on the final wire request.
- [x] Pin cross-language serialization/default tests. Deep restore, sync,
  finalization, eviction, and archive validation remains with the Backend /
  Lagoon / Reef implementation workstream.
- [x] Add Desktop's flat **Sync all files** control and preserve it through
  create/edit. Legacy launches with neither policy field render as sync-all;
  turning it off restores the selected runtime's default include list.
- [x] Complete independent SDK and Desktop audits. The follow-up fixes preserve
  excludes when Python receives a nullable include, apply runtime defaults on
  the provider's initial create while ordinary restarts inherit the backend's
  stored policy, distinguish JSON null from an explicit empty include, and let
  older Desktop callers preserve the current launch policy.
- [x] Document every coding runtime and OpenClaw's full-root behavior in
  `docs/agents/coding-runtimes.mdx`.

The wire contract stays flat. `sync_all` / `syncAll` is a client convenience
and is never sent to Backend: it emits explicit JSON null for both
`sync_include` and `sync_exclude`. Explicit null clears a stored selective
policy and selects the complete sync root. Omitting both fields is different:
on restart or edit it inherits the stored policy. An omitted create override
receives the runtime subclass default; a custom include or exclude replaces
that default, and a non-null include wins when both custom policies are
supplied. An explicit empty include remains distinct and means sync nothing.

## User decisions

- Coding-agent SDK subclasses own the runtime-specific sync defaults.
- Each subclass passes an include or exclude policy through the ordinary agent
  launch contract; callers may override the subclass default.
- Include and exclude are mutually selective modes. Include has precedence if
  both are supplied (`include XOR exclude`, with include winning during
  normalization). Do not merge the two policies.
- Selective coding-agent defaults are visible and overridable. They are not a
  hidden platform blacklist. A user may select the complete sync root.
- Include/exclude behavior must be tested extensively across SDK serialization,
  launch propagation, restore, continuous sync, finalization, eviction, and
  archive-only restore.

## Current repository facts

HyperCLI clients and the Backend launch path now contain the per-agent include
contract. Deep restore/finalize/eviction validation remains active work:

- Python and TypeScript expose flat include/exclude fields, explicit sync-all
  convenience, and SDK-owned defaults for all six coding runtimes.
- Rust launch types expose the same wire fields, preserve explicit empty
  includes, and apply the runtime defaults to typed Buzz launches.
- Backend persists and normalizes the flat policy, preserving omission,
  explicit null, and explicit empty lists as distinct operations:
  `hyperclaw-backend/backend/agents/launch_contract.py`.
- Lagoon passes the normalized policy to Reef, annotates retained namespaces,
  and replaces an immutable retained Reef watcher when that policy changes:
  `hyperclaw-backend/lagoon/main.py`.
- Reef implements mutually exclusive include and exclude modes, including
  scoped directory mirrors and exact-file synchronization:
  `hyperclaw-backend/reef-sync/reef_policy.py` and
  `hyperclaw-backend/reef-sync/supervisor.py`.
- The consolidated `pulumi-provision-k8s/lagoon.py` currently does not wire the
  exclude settings that existed in the removed Pulumi stack. Do not assume the
  recently added exclude configuration is deployed end to end.

## Recommended launch contract

Use one normalized policy object, persisted with the agent launch config and
passed unchanged through every layer. Exact field naming is for the owning
session to align with existing conventions; the conceptual shape is:

```json
{
  "sync_root": "/home/node",
  "sync_include": [".codex", ".claude", ".claude.json"],
  "sync_exclude": null
}
```

Normalization rules:

1. Distinguish an omitted field from an explicit empty list.
2. If a non-empty include is supplied, normalize and use it; discard/ignore
   exclude because include wins. Emit a diagnostic when both were supplied so
   the precedence is visible.
3. Otherwise, if exclude is supplied, synchronize the full root minus those
   patterns.
4. With neither policy, synchronize the complete root.
5. Decide explicitly whether an empty include means “sync nothing” or is
   invalid. Recommended: allow it to mean “sync nothing” only when explicitly
   supplied; never collapse it to the absent/full-root case.
6. Paths are relative to `sync_root`. Reject absolute paths, `..`, empty path
   segments after normalization, NULs, and paths escaping through symlinks.
7. Normalize duplicate and nested include roots deterministically. A parent
   include subsumes its descendants.
8. Reserved platform paths such as `.reef-sync/**` and
   `.reef-sync-upload/**` remain mandatory internal exclusions independent of
   the user policy.

One canonical normalized policy must drive all of these operations:

- cold restore;
- continuous PVC-to-local-S3 synchronization;
- stopped/final PVC-to-local convergence;
- local-S3-to-archive finalization;
- exact deletion propagation;
- Files API list/read/write/delete authorization;
- local-cache eviction validation and archive-only restore.

Fail closed if any stage receives a different policy revision. Restore must not
silently broaden an include policy or apply upload excludes differently.

## Coding-agent subclass defaults

The image runtime matrix documents these canonical state roots:

| Runtime | Default selected roots |
|---|---|
| Codex | `.codex` |
| Claude Code | `.claude`, `.claude.json` |
| OpenCode | `.config/opencode`, `.local/share/opencode`, `.local/state/opencode`, `.cache/opencode` |
| Goose | `.goose` |
| Kimi Code | `.kimi-code` |

Buzz native authentication is environment-owned; do not persist secrets merely
because the Buzz wrapper is used. The concrete subclasses should supply these
defaults, expose user overrides, and serialize through the same base launch
contract. Avoid duplicating normalization independently in each subclass.

## Reef implementation implications

- Directory includes: supervise one scoped one-way mirror per normalized root.
- Exact-file includes such as `.claude.json`: explicit copy on change/finalize,
  explicit delete when absent, and explicit restore.
- Include mode confines `--remove` to each selected destination root. It must
  never remove sibling objects outside the include universe.
- Exclude mode applies the same patterns during restore, watch, both finalizers,
  and Files API operations.
- Files API and supervisor must share one parser/matcher. Today the file API can
  silently tolerate malformed JSON while the supervisor fails; remove that
  disagreement.
- Ordinary runtime deletions must be captured during the quiesced final pass.
  Existing Reef watch/final commands omit `--remove`, so this behavior requires
  an explicit change and regression tests.

## Mandatory test matrix

### SDK and contract tests

- Every coding subclass emits its documented default include roots.
- User include override replaces the subclass default.
- User exclude override selects exclude mode when include is absent.
- When both are supplied, include wins and exclude is not serialized as active.
- Omitted, empty, duplicate, nested, file, and directory roots serialize
  consistently in Python, TypeScript, Rust types, and backend fixtures.
- Existing generic/OpenClaw full-root behavior remains unchanged.
- Invalid traversal, absolute paths, symlink escapes, and reserved paths fail.

### Lagoon manifest tests

- The normalized policy reaches restore, Reef watch, and finalizer containers.
- Include and exclude are never simultaneously active after normalization.
- Workspace sync remains orthogonal: when `HYPER_WORKSPACES_BOOT_SYNC` is
  disabled, Lagoon adds no workspace init/refresh container and makes no
  Workspaces request.
- A warm runtime start against a retained Reef Pod/PVC does not rerun blocking
  workspace initialization.

### Reef unit and Compose tests

- Separate selected directory roots upload and restore correctly.
- Exact selected file creation, overwrite, deletion, and restore work.
- An excluded descendant inside an included parent remains absent.
- Files outside include roots remain untouched locally and remotely.
- `--remove` is confined to the selected remote prefix.
- Restore/watch/finalizer/File API use identical matching results.
- Malformed policy fails closed everywhere.
- Interrupted finalization cannot publish HEAD; retry is idempotent.

### Persistent dev01 lifecycle E2E

Use one stable coding-agent identity and fixed destinations so storage remains
approximately constant between runs:

```text
/home/node/.codex/reef-lifecycle/large.bin       # 100 MiB /dev/urandom
/home/node/.codex/reef-lifecycle/SHA256SUMS
/home/node/.claude/reef-lifecycle/small/000.txt  # through 099.txt
/home/node/.claude/reef-lifecycle/tombstone-a-or-b.txt
/home/node/worktree/not-backed-up.txt            # outside include roots
```

For each generation:

1. Verify the previous restored SHA-256 manifest before overwriting files.
2. Replace the same 100 MiB random file and 100 fixed text files.
3. Alternate the tombstone, and in the second generation delete text files
   `075.txt` through `099.txt` to prove removal.
4. Stop, force archive finalization, and prove `finalize_epoch` advanced exactly
   once and archive HEAD matches local HEAD.
5. Verify archive SHA-256/path inventory; the outside-policy fixture must be
   absent in include mode.
6. Evict both PVC and local S3 through the real capacity-eviction path.
7. Wait longer than two background archive reconciliation intervals and prove
   the committed archive was not deleted.
8. Restart from archive only and recompute all hashes in the container. Prove
   deleted and excluded paths remain absent.
9. Inject one failed finalizer run: HEAD must remain old/absent, cleanup must
   remain blocked, and an idempotent retry must succeed.

Run a separate exclude-mode generation with no active include list and an
explicit excluded descendant. Include and exclude are XOR modes and include
wins if both arrive, so an “included parent plus excluded child” assertion is
not a valid policy test.

Keep this as a serialized live CI gate. Do not apply Pulumi from the test.

## Archive dependency to resolve

Current continuous cluster archival uses global `mc mirror --remove`. Local-S3
cache eviction will therefore delete the archive copy within a reconciliation
cycle. Archive-only restore is impossible until that coupling changes.

The simplest compatible direction is:

- continuous archive prepositioner uploads/overwrites without `--remove`;
- the quiesced per-agent finalizer alone performs scoped `--remove`, verifies
  exact inventory/checksums, then writes archive HEAD;
- local eviction cannot propagate into the committed archive;
- no agent lifecycle operation stops or relaunches the long-running archiver.

The dev01 E2E must explicitly wait across multiple background reconcile cycles
after local eviction before declaring archive retention successful.
