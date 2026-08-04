# HyperCLI Desktop

Tauri v2 companion app (macOS, Windows, Linux): sign in or paste an API key,
then install the Buzz provider so HyperCLI agents appear in Buzz Desktop.
One page, shared-ui design tokens, no bundled Node runtime.

## Layout

```
desktop/
  ui/            static frontend (no build step; frontendDist points here)
  src-tauri/     Tauri app — its own cargo workspace, deliberately NOT a
                 member of the repo root workspace so provider release
                 builds never compile GUI dependencies
```

## What the app does

1. **Auth**: "Sign in with browser" opens the claw `/desktop-login` page with
   `redirect_uri=hypercli://auth`; the token comes back via deep link and is
   exchanged for a durable API key named `<OS> (<hostname>)` (tag `desktop`),
   written to `~/.hypercli/config` (`HYPER_API_KEY=...`). Alternatively the
   user pastes an existing key. The session token is never stored.
2. **Provider install**: the provider binary ships as a Tauri sidecar inside
   the app. Install places all Buzz-discoverable names in `~/.local/bin`
   (created if missing — surfaced in the UI, never silent):
   - macOS/Linux: symlinks to the binary inside the app bundle. The whole
     bundle is signed + notarized as a unit, so the sidecar's cdhash is in
     the notarization ticket and direct execution via symlink passes
     Gatekeeper.
   - Windows: copies (symlinks require admin/Developer Mode).

## Build

```bash
cd desktop/src-tauri
# sidecar must exist first, named per target triple:
mkdir -p binaries
cp ../../target/release/buzz-backend-hypercli \
  binaries/buzz-backend-hypercli-$(rustc -vV | sed -n 's/host: //p')
cargo tauri build
```

## TODO before first release

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
- [ ] CI: build unsigned bundles on hosted runners (macos-15 universal,
      windows-latest, ubuntu for AppImage/deb), then sign + notarize +
      staple the .app on the self-hosted signing job (rcodesign, creds from
      the Pulumi stack — same pattern as release-buzz-provider.yml).

## Related: `hypercli-configure` CLI identity (planned, provider-side)

For users who want neither Python nor the app (e.g. Linux servers), the
provider binary itself will gain a `hypercli-configure` argv[0] identity
(same single-binary + symlink pattern as the runtime aliases) mirroring the
Python `hyper configure` surface: show current key preview, prompt for a new
key (getpass-style), optional API URL, write `~/.hypercli/config`. Lives in
`buzz-backend-provider`; tracked there.
