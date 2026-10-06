# One app release version

`versions.json` contains exactly one value: `appVersion`, currently `0.8.0`.
This deliberately resets the formerly calendar-versioned Python and TypeScript
packages to the app's version. There are no per-package release exceptions.

To change the release version, edit **only** `versions.json` and run:

```sh
python3 tools/sync_versions.py
python3 tools/sync_versions.py --check
python3 -m unittest discover -s tools -p 'test_*.py'
```

The explicit `version-ownership.json` map covers:

| Package | Release projections |
| --- | --- |
| TypeScript SDK | npm manifest/lock, exported `APP_VERSION` |
| TypeScript CLI | npm manifest/lock/local SDK entry, `--version`, MCP client identity |
| Python SDK | pyproject, `hypercli.__version__` |
| Python CLI | pyproject, exact SDK requirements including extras, `__version__`/`--version` |
| Rust SDK | workspace version, local Cargo lock entry; `APP_VERSION` uses Cargo metadata |

All projections are committed. npm packages, wheels and the Cargo package need
neither this script nor the mono checkout to report or build their release version.
The TS CLI's existing `file:../ts-sdk` dependency remains a source-layout packaging
constraint; this change does not redesign npm distribution.

In the parent checkout, `python3 hypercli/tools/sync_versions.py --parent .`
also applies its root `version-ownership.json` to the private app, runner, ACP
and owned plugin/provider packages. Use `--check --parent .` for a nonmutating
cross-repository check. New package manifests fail the inventory gate until
explicitly owned or classified. Keep the public commit and parent submodule
pointer together: publish public changes first, then the parent.

## Independent versions

The following are **not app release identities** and must not be rewritten:

- ACP protocol/schema versions and external ACP dependency pins.
- OpenAPI `info.version`, API routes (`v1`/`v2`), database migrations, storage
  formats and npm/Cargo lockfile format versions.
- Third-party dependency versions, checksums and external image/tool pins.
- Historical migration fixtures (including old calendar-versioned CLI installs)
  and server-response samples that exercise compatibility with older runtimes.
- Git/build SHA and development channel metadata; neither overrides appVersion.

The parent ownership map explicitly lists broader first-party repositories and
services outside this authorized package scope, including admin/GPU packages
requiring separate approval. Those are pending scope decisions, not an alternative
calendar-version policy for managed app releases. This code change does not publish
registries, create tags, or deploy anything.
