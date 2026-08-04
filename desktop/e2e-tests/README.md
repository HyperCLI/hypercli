# HyperCLI Desktop — Linux e2e tests

End-to-end test for the **real** desktop app (unlike `../ui-tests`, which
drives the static UI with mocked Tauri IPC in Chromium).

## What it does

`run-e2e.mjs` builds nothing itself; it drives an already-built app binary:

1. Mints a session token via the admin login endpoint
   (`GET {TEST_API_BASE_URL}/api/admin/auth/login?email=...` with header
   `X-BACKEND-API-KEY`) — the same auth seam as the web e2e suites.
2. Launches the real Tauri app in WebKitGTK under
   [tauri-driver](https://crates.io/crates/tauri-driver) + WebKitWebDriver,
   with an isolated temporary `$HOME` and `HYPER_API_BASE` pointing at the
   test backend.
3. Delivers the token through the real login path: a second process
   invocation with a `hypercli://auth#token=...` argument, which the
   single-instance plugin forwards to the running app — exactly what the
   OS/browser hand-off does after "Sign in with browser". The app exchanges
   it for a durable API key (`mint_api_key`), saves it, and validates it
   against the real backend (`validate_key` → `auth_me`, capability check).
4. Clicks **Install providers** and asserts all seven Buzz-discoverable
   names in `$HOME/.local/bin` are symlinks resolving to the sidecar that
   shipped inside the app.
5. Logs out and asserts the credential is gone from `$HOME/.hypercli/config`
   and the UI is back to the disconnected state.

Nothing is mocked. Secrets are never printed; failure screenshots go to
`artifacts/` (or `$E2E_ARTIFACTS_DIR`).

## Prerequisites (Linux)

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev webkit2gtk-driver xvfb dbus-x11
cargo install tauri-driver --locked
npm install --global @tauri-apps/cli@2
```

## Build the app (from the repo root)

```bash
cargo build --locked -p buzz-backend-hypercli
mkdir -p desktop/src-tauri/binaries
cp target/debug/buzz-backend-hypercli \
  desktop/src-tauri/binaries/buzz-backend-hypercli-$(rustc -vV | sed -n 's/host: //p')
(cd desktop/src-tauri && tauri build --no-bundle)
```

## Run

```bash
cd desktop/e2e-tests
npm ci
export BACKEND_API_KEY=...   # admin key for the test backend (CI secret)
export TEST_EMAIL=...        # account to mint the session for
export TEST_API_BASE_URL=https://api.dev.hypercli.com   # optional, default shown
dbus-run-session -- xvfb-run -a npm test
```

`dbus-run-session` is required: the single-instance plugin forwards the
deep-link argv to the running app over the D-Bus session bus.

## Known gaps

- The browser half of "Sign in with browser" (the `/desktop-login` web page
  and OS scheme registration) is not exercised; the test injects the deep
  link directly at the argv hand-off point.
- WebKitGTK rendering quirks (D-Bus menu, appmenu) are irrelevant here — the
  app is a single fixed-size window with no menus.
