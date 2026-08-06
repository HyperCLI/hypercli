# HyperCLI Desktop

Tauri v2 companion app (macOS, Windows, Linux): sign in or paste an API key,
install the Buzz provider, and manage saved HyperCLI agents. One page,
shared-ui design tokens, no bundled Node runtime.

## Layout

```
desktop/
  ui/            static frontend (no build step; frontendDist points here)
  src-tauri/     Tauri app — its own cargo workspace, deliberately NOT a
                 member of the repo root workspace so provider release
                 builds never compile GUI dependencies
  scripts/       release tooling (ported from Buzz Desktop):
                 build-release-config.mjs   release-only tauri config delta
                 generate-oss-latest-json.sh  updater latest.json assembly
                 fix-appimage.sh            AppImage infra-lib fix + re-sign
  RELEASE-WORKFLOW-DRAFT.yml  CI draft for .github/workflows/release-desktop.yml
                              (installed manually after review)
```

## What the app does

1. **Auth**: "Sign in with browser" opens the claw `/desktop-login` page with
   `redirect_uri=hypercli://auth`; the token comes back via deep link and is
   exchanged for a durable API key named `<OS> (<hostname>)`,
   written to `~/.hypercli/config` (`HYPER_API_KEY=...`). Alternatively the
   user pastes an existing key. The session token is never stored.
2. **Provider install**: the provider binary ships as a Tauri sidecar inside
   the app. Install places all Buzz-discoverable names in `~/.local/bin`
   (created if missing — surfaced in the UI, never silent):
   - macOS/Linux: one user-owned `~/.local/bin/hypercli-configure` copy, with
     relative provider-name symlinks beside it. Nothing points into the app
     bundle, so App Translocation, app moves, and uninstall cannot leave
     dangling providers.
   - Windows: user-owned copies (symlinks require admin/Developer Mode).
3. **Agent fleet**: after login, create or list saved deployments, default to a
   backward-compatible Buzz-only filter, and offer state-safe start, stop,
   restart, and delete. Only stopped agents can be deleted. Native Rust owns
   one credential-bound deployment subscription and sends only a sanitized
   `deployments-invalidated` signal to the webview. The webview coalesces
   signals and reloads the authoritative REST fleet. Saving, replacing, or
   clearing credentials restarts or stops the native stream; manual Refresh is
   recovery, not background lifecycle polling.

## Build

```bash
cd desktop/src-tauri
# sidecar must exist first, named per target triple:
mkdir -p binaries
cp ../../target/release/buzz-backend-hypercli \
  binaries/buzz-backend-hypercli-$(rustc -vV | sed -n 's/host: //p')
cargo tauri build
```

Local builds carry **no updater**: `build.rs` emits the
`hypercli_updater_enabled` cfg only when both `HYPERCLI_UPDATER_PUBLIC_KEY`
and `HYPERCLI_UPDATER_ENDPOINT` are set at build time, and even then the
updater + process plugins are registered only in non-debug builds (Buzz's
env-gated pattern). Without the cfg, `window.__TAURI__.updater` is absent and
the UI stays in its resting "up to date" state.

## Auto-updates

Release builds check the updater endpoint on launch and every 6 hours
(`ui/app.js`, a vanilla-JS port of Buzz's `use-updater.ts`). An available
update is downloaded in the background, then the footer shows "Update the
HyperCLI app"; clicking installs and relaunches. Errors and unsupported
installs (Linux `.deb` — only AppImage can self-update, detected via the
`APPIMAGE` env var in `is_auto_update_supported`) rest silently.

The endpoint is `latest.json` on the rolling `desktop-latest` GitHub release,
mirroring Buzz's `buzz-desktop-latest`.

## Releasing

Modeled on Buzz Desktop's release flow (block/buzz `release.yml` +
`RELEASING.md`). CI draft: `.github/workflows/release-desktop.yml` (installed to
`.github/workflows/release-desktop.yml` manually after review).

1. Bump `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
   (they must match the workflow's `version` input).
2. Dispatch **Release Desktop** with the version and ref; flip
   `publish_release` once builds are green.
3. The pipeline:
   - **build** (macos-15 aarch64, macos-15-intel x86_64, windows NSIS,
     ubuntu-24.04 AppImage + deb): builds the provider sidecar
     (`cargo build --release --locked -p buzz-backend-hypercli`), copies it
     to `src-tauri/binaries/buzz-backend-hypercli-<triple>`, generates
     `tauri.release.conf.json` (`createUpdaterArtifacts: true` + updater
     pubkey/endpoint) via `scripts/build-release-config.mjs`, and builds with
     the Tauri updater key in the env. Linux AppImages are post-processed by
     `scripts/fix-appimage.sh` (strips over-bundled infra libs that crash on
     Mesa 25+ distros, re-signs).
   - **sign-macos** (self-hosted Linux): pulls the Developer ID cert from the
     Pulumi stack (`pulumi stack output`, same pattern as
     `release-buzz-provider.yml`), signs the `.app` with rcodesign,
     notarizes + staples when the stack has an ASC key, then **rebuilds the
     updater `.app.tar.gz` from the signed app and re-signs it** with the
     Tauri updater key (Buzz's re-sign dance — the build-time tarball
     contains the unsigned app and must never ship).
   - **publish**: creates `desktop-v<version>` (installers) and the rolling
     `desktop-latest` release (updater archives + `.sig`s + `latest.json`
     assembled by `scripts/generate-oss-latest-json.sh`).

Environment / secrets:

| Name | Purpose |
|------|---------|
| `HYPERCLI_UPDATER_PUBLIC_KEY` | updater public key; also gates the updater cfg in `build.rs` |
| `HYPERCLI_UPDATER_ENDPOINT` | updater manifest URL (defaults to the `desktop-latest` `latest.json`) |
| `TAURI_SIGNING_PRIVATE_KEY` / `..._PASSWORD` | Tauri updater signing key (canonical copy in the Pulumi stack) |
| `PULUMI_APPLE_CERT_STACK` / `PULUMI_APPLE_AWS_PROFILE` / `PULUMI_APPLE_PASSPHRASE_FILE` | Developer ID + ASC creds for the self-hosted signing job |

One-time keypair: `npx --yes @tauri-apps/cli@2 signer generate -w
hypercli-updater.key`; public key → Actions secret, private key + password →
Pulumi stack (losing it strands every install on its current version).

## Historical TODO list

These items are retained for archaeology; the current source/HANDOVER is the
authority and several have already shipped.

- [ ] Icons: generate with `cargo tauri icon <logo.png>` (bundle expects
      `icons/icon.icns`, `icons/icon.ico`, PNGs).
- [ ] Add `hypercli://auth` to the redirect allowlist in
      `site/apps/claw/src/app/desktop-login/page.tsx` (currently only
      `backseatdriver://auth`).
- [ ] Verify the key-mint endpoint + response shape used by `mint_api_key`
      (`POST {AGENTS_API_BASE}/keys`, expects `api_key` in the response) and
      whether `tags` is accepted there.
- [ ] macOS app translocation: detect launch outside `/Applications` and
      offer "Move to Applications" before creating symlinks (a quarantined
      app launched from ~/Downloads runs from a randomized path and the
      symlinks would dangle). Symlinks are re-healed on every launch either
      way.
- [ ] CI: review and install `.github/workflows/release-desktop.yml` as
      `.github/workflows/release-desktop.yml`; generate the updater keypair
      and store it (Pulumi stack + Actions secrets) before the first release.
- [ ] macOS DMG: the draft workflow ships signed `.app.tar.gz` archives only —
      DMGs can't be rebuilt on the Linux signing host. Add a macOS repack job
      if a DMG download is wanted.

## Related: `hypercli-configure` CLI identity (planned, provider-side)

For users who want neither Python nor the app (e.g. Linux servers), the
provider binary itself will gain a `hypercli-configure` argv[0] identity
(same single-binary + symlink pattern as the runtime aliases) mirroring the
Python `hyper configure` surface: show current key preview, prompt for a new
key (getpass-style), optional API URL, write `~/.hypercli/config`. Lives in
`buzz-backend-provider`; tracked there.

## Icon source

`src-tauri/icons/icon-source.png` is the 1024px master: the Aurora mark from
`hypercli-styles/logos/icon_padded.png` composited on `#10151f` and laid out
on Apple's macOS grid — 824×824 shape at +100,+100 in a 1024 canvas, mark
sized to the 626px square element. Every other size, the `.icns` and the
`.ico` are generated from it (Tauri requires 8-bit RGBA).
