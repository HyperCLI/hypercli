# HyperCLI Release Playbook

Ship the Python SDK, TypeScript SDK, Node CLI, and desktop app as one coordinated release. Do not put credential values, tokens, secret URLs, or private registry coordinates in commits, logs, issue comments, or release notes. Secrets belong only in GitHub Actions secrets, npm/PyPI/GitHub auth, or local credential stores.

## Version Rule

- Use CalVer for SDK and Node CLI packages: first release on a date is `YYYY.M.D`, for example `2026.9.12`.
- Same-day rereleases append `-N`, for example `2026.9.12-2`. Do not start a new day with `-1`.
- Python package versions must be PEP 440. Map `YYYY.M.D-N` to `YYYY.M.D.postN`, for example `2026.9.12-2` -> `2026.9.12.post2`.
- Desktop uses stable SemVer because `Release Desktop` validates SemVer against Tauri config.

## Version Bump Locations

- Python SDK `hypercli-sdk`: `sdk/pyproject.toml` and `sdk/hypercli/__init__.py`.
- TypeScript SDK `@hypercli.com/sdk`: `ts-sdk/package.json` and `ts-sdk/package-lock.json`.
- Node CLI `@hypercli.com/cli`: `cli/package.json` and `cli/package-lock.json`.
- Desktop app: `desktop/package.json`, `desktop/package-lock.json`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`, and generated `desktop/src-tauri/Cargo.lock` if Cargo updates it.

## Dependency Coupling

- Publish SDKs before any consumer package.
- Before publishing the Node CLI to npm, replace `cli/package.json` dependency `"@hypercli.com/sdk": "file:../ts-sdk"` with the published release version, for example `"@hypercli.com/sdk": "2026.9.12"`, then regenerate and include `cli/package-lock.json`.
- Desktop currently consumes the sibling SDK checkout with `"@hypercli.com/sdk": "file:../ts-sdk"` and imports SDK source directly; keep this for source-built desktop verification unless intentionally changing desktop packaging.
- Generated lockfile changes are release artifacts. Include them intentionally and inspect them before committing.

## Local Verification

Run from a clean checkout after installing dependencies.

```bash
cd /Users/nedos/dev/hypercli/sdk
python -m pip install -e '.[dev]'
python -m pytest
python -m build
python -m twine check dist/*
```

```bash
cd /Users/nedos/dev/hypercli/ts-sdk
npm ci
npm run clean
npm run build
npm test
npm pack --dry-run
```

```bash
cd /Users/nedos/dev/hypercli/cli
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

```bash
cd /Users/nedos/dev/hypercli/desktop
npm ci
npm run typecheck
npm test
npm run build
npm run tauri build
```

```bash
cd /Users/nedos/dev/hypercli/desktop/src-tauri
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

## Release Hygiene

- Start with `git status --short` showing only intentional changes.
- Avoid dirty stashes; either apply and inspect them or leave them unrelated and untouched.
- Inspect `git diff`, `git diff --check`, and `git log --oneline -10` before committing.
- Check for accidental secrets in changed files, generated artifacts, release notes, and terminal history.
- Include generated lockfiles only when the release bump or dependency change produced them intentionally.
- Never publish from a tree with unreviewed generated changes or unresolved merge markers.

## Commit And Push

Inspect first:

```bash
git status --short
git diff
git diff --check
git log --oneline -10
```

Commit and push only after verification:

```bash
git add sdk/pyproject.toml sdk/hypercli/__init__.py ts-sdk/package.json ts-sdk/package-lock.json cli/package.json cli/package-lock.json desktop/package.json desktop/package-lock.json desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml desktop/src-tauri/Cargo.lock RELEASE.md
git commit -m "Release HyperCLI artifacts"
git push origin main
```

Adjust the `git add` list to the artifacts actually being released. Do not commit, push, tag, publish, or trigger workflows until the release owner approves.

## Publish Sequence

1. Verify and merge the version bump commit.
2. Publish SDKs first with the `Publish SDKs` workflow. It publishes `@hypercli.com/sdk` to npm and `hypercli-sdk` to PyPI.
3. Wait for npm and PyPI package pages to show the new SDK versions.
4. Publish the Node CLI after `cli/package.json` and `cli/package-lock.json` depend on the published `@hypercli.com/sdk`, not `file:../ts-sdk`. This repo has `CLI CI`, but no Node CLI npm publish workflow was found; publish manually with npm or add a dedicated workflow before relying on automation.
5. Release desktop after the app has been locally verified and `Desktop CI` is green. Use `Release Desktop` only after confirming the version in `desktop/src-tauri/tauri.conf.json` and `desktop/src-tauri/Cargo.toml` matches the workflow input.

## Manual Workflow Triggers

Actual workflow names discovered under `.github/workflows`:

- `Publish SDKs` in `.github/workflows/publish-sdks.yml`.
- `Release Desktop` in `.github/workflows/release-desktop.yml`.
- `CLI CI` in `.github/workflows/cli.yml`; CI only, no npm publish job.
- `Desktop CI` in `.github/workflows/desktop-ci.yml`; CI only.

Commands, to run only when authorized:

```bash
gh workflow run "Publish SDKs" --ref main -f version=2026.9.12
```

```bash
gh workflow run "Release Desktop" --ref main -f version=0.3.2 -f ref=main -f publish_release=true
```

For a desktop dry build without publishing GitHub releases:

```bash
gh workflow run "Release Desktop" --ref main -f version=0.3.2 -f ref=main -f publish_release=false
```

Manual Node CLI publish, if no workflow has been added:

```bash
cd /Users/nedos/dev/hypercli/cli
npm ci
npm run build
npm test
npm publish --access public
```

Use npm, PyPI, and GitHub authentication mechanisms without printing credential values. Do not pass secret values on command lines.
