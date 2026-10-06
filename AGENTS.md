# Release versions

`versions.json` is the sole release-version authority: `{ "appVersion": "0.8.0" }`.
Edit only that value to change a release version; then run
`python3 tools/sync_versions.py`. All managed manifests, local lock entries,
dependency constraints and runtime constants are committed projections. Never
introduce package-specific or calendar release versions. Build revisions and
development channels are separate metadata, not release versions.

`version-ownership.json` explicitly owns projections and classifies every package
manifest. New manifests must be classified; app-release manifests must be managed.
`python3 tools/sync_versions.py --check` is nonmutating and runs in CI. Packages
build standalone using their committed projections; no parent checkout is needed.
In the mono checkout, also run with `--parent ..` to synchronize private packages.
Protocol/schema/API/database format versions and external dependency pins are
independent of the app release. See `docs/versioning.md` for scope and exclusions.
