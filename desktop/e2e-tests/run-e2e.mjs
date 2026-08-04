// Real-app Linux e2e for the HyperCLI desktop (Tauri) app.
//
// Drives the actual built binary in WebKitGTK via tauri-driver +
// WebKitWebDriver (WebDriver protocol), against the REAL backend:
//   1. mints a session token via the admin login endpoint
//      (GET {TEST_API_BASE_URL}/api/admin/auth/login?email=..., header
//      X-BACKEND-API-KEY) — the same auth seam the web e2e suites use;
//   2. delivers it to the running app as a hypercli://auth deep link
//      (second-instance argv, exactly what the OS/browser hand-off does);
//   3. the app exchanges it for a durable API key (mint_api_key), saves it,
//      and validates it against the backend (validate_key);
//   4. installs the real provider sidecar into the temp $HOME/.local/bin and
//      verifies the symlinks on disk;
//   5. logs out and verifies the credential is gone.
//
// Required env (never printed):
//   BACKEND_API_KEY   admin key for the login endpoint (CI secret)
//   TEST_EMAIL        account to mint the session for
// Optional env:
//   TEST_API_BASE_URL backend base (default https://api.dev.hypercli.com)
//   HYPERCLI_DESKTOP_APP  app binary (default ../src-tauri/target/debug/HyperCLI)
//   TAURI_DRIVER          tauri-driver binary (default: from PATH)
//   E2E_ARTIFACTS_DIR     failure screenshots land here (default ./artifacts)
//
// Run under a virtual display with a D-Bus session (the single-instance
// plugin forwards the deep link over D-Bus):
//   dbus-run-session -- xvfb-run -a npm test

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = (process.env.TEST_API_BASE_URL || "https://api.dev.hypercli.com").replace(/\/+$/, "");
const EMAIL = process.env.TEST_EMAIL;
const ADMIN_KEY = process.env.BACKEND_API_KEY;
const APP_BIN =
  process.env.HYPERCLI_DESKTOP_APP ||
  path.resolve(HERE, "../src-tauri/target/debug/HyperCLI");
const TAURI_DRIVER = process.env.TAURI_DRIVER || "tauri-driver";
const ARTIFACTS_DIR = process.env.E2E_ARTIFACTS_DIR || path.join(HERE, "artifacts");
const DRIVER_PORT = 4444;
const STEP_TIMEOUT_MS = 60_000;

const PROVIDER_NAMES = [
  "buzz-backend-hypercli",
  "buzz-backend-hypercli-buzz-agent",
  "buzz-backend-hypercli-opencode",
  "buzz-backend-hypercli-codex",
  "buzz-backend-hypercli-claude",
  "buzz-backend-hypercli-goose",
  "buzz-backend-hypercli-kimi",
];

function fail(message) {
  throw new Error(message);
}

function requiredEnv() {
  if (!EMAIL) fail("TEST_EMAIL is required");
  if (!ADMIN_KEY) fail("BACKEND_API_KEY is required");
  if (!fs.existsSync(APP_BIN)) fail(`app binary not found at ${APP_BIN} — build it first`);
}

async function mintSessionToken() {
  const url = new URL(`${API_BASE}/api/admin/auth/login`);
  url.searchParams.set("email", EMAIL);
  const response = await fetch(url, { headers: { "X-BACKEND-API-KEY": ADMIN_KEY } });
  if (!response.ok) {
    fail(`admin auth login failed: HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload.token) fail("admin auth login returned no token");
  console.log("[auth] session token minted (value redacted)");
  return payload.token;
}

function waitForDriver(proc, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let exited = false;
    proc.once("exit", (code) => {
      exited = true;
      reject(new Error(`tauri-driver exited early (code ${code})`));
    });
    (async () => {
      while (Date.now() < deadline) {
        if (exited) return;
        try {
          const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}/status`);
          if (response.ok) return resolve();
        } catch {
          // not up yet
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      reject(new Error("timed out waiting for tauri-driver"));
    })();
  });
}

async function waitForText(browser, selector, substring, timeoutMs = STEP_TIMEOUT_MS) {
  const element = await browser.$(selector);
  await element.waitForDisplayed({ timeout: timeoutMs });
  await browser.waitUntil(
    async () => (await element.getText()).includes(substring),
    {
      timeout: timeoutMs,
      timeoutMsg: `${selector} never contained ${JSON.stringify(substring)}; last text: ${JSON.stringify(await element.getText())}`,
    },
  );
}

async function expectDisplayed(browser, selector, displayed, timeoutMs = STEP_TIMEOUT_MS) {
  const element = await browser.$(selector);
  if (displayed) {
    await element.waitForDisplayed({ timeout: timeoutMs });
  } else {
    await element.waitForDisplayed({ timeout: timeoutMs, reverse: true });
  }
}

async function screenshot(browser, name) {
  try {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    await browser.saveScreenshot(path.join(ARTIFACTS_DIR, `${name}.png`));
  } catch {
    // best effort only
  }
}

function deliverDeepLink(env, token) {
  const url = `hypercli://auth#token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    execFile(APP_BIN, [url], { env, timeout: 30_000 }, (error) => {
      // The second instance forwards argv to the running instance and exits.
      // A timeout/kill means the single-instance hand-off is broken (e.g. no
      // D-Bus session bus); a nonzero exit after forwarding is fine.
      if (error && error.killed) {
        return reject(
          new Error("deep-link second instance did not exit — single-instance hand-off broken?"),
        );
      }
      resolve();
    });
  });
}

function readConfig(home) {
  const configPath = path.join(home, ".hypercli", "config");
  return fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
}

async function main() {
  try {
    requiredEnv();
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hypercli-desktop-e2e-"));
  console.log(`[setup] isolated HOME=${home}`);

  const token = await mintSessionToken();

  const appEnv = {
    ...process.env,
    HOME: home,
    // Point the app's backend discovery at the test environment; mirrors
    // what a dev/feat user gets from ~/.hypercli/config.
    HYPER_API_BASE: API_BASE,
    // Software rendering — no GPU on CI runners.
    WEBKIT_DISABLE_DMABUF_RENDERER: "1",
  };

  const driver = spawn(TAURI_DRIVER, ["--port", String(DRIVER_PORT)], {
    env: appEnv,
    stdio: ["ignore", "inherit", "inherit"],
  });

  let browser;
  try {
    await waitForDriver(driver);
    console.log("[setup] tauri-driver up, starting session");

    browser = await remote({
      hostname: "127.0.0.1",
      port: DRIVER_PORT,
      path: "/",
      logLevel: "warn",
      connectionRetryTimeout: 60_000,
      capabilities: {
        "tauri:options": { application: APP_BIN },
      },
    });

    // 1. Fresh launch: disconnected, providers hidden.
    await expectDisplayed(browser, "#auth-disconnected", true);
    await expectDisplayed(browser, "#provider-section", false);
    console.log("[ok] launches disconnected");

    // 2. Browser-login equivalent: deliver the session token through the
    //    hypercli://auth deep link (second-instance argv hand-off).
    await deliverDeepLink(appEnv, token);
    await waitForText(browser, "#status", "created and saved");
    await expectDisplayed(browser, "#auth-connected", true);
    await expectDisplayed(browser, "#provider-section", true);
    console.log("[ok] deep-link login minted and saved an API key");

    // 3. The saved key validates against the real backend as the test user
    //    and carries the agents:* capability (no warning shown).
    await waitForText(browser, "#auth-detail", `as ${EMAIL}`);
    await expectDisplayed(browser, "#auth-warning", false);
    if (!/^HYPER_API_KEY=\S/m.test(readConfig(home))) {
      fail("~/.hypercli/config does not contain HYPER_API_KEY after login");
    }
    console.log("[ok] key validated against backend and persisted");

    // 4. Install the provider sidecar into the isolated bin dir.
    await (await browser.$("#install-btn")).click();
    await waitForText(browser, "#provider-hint", "Providers installed");
    const binDir = path.join(home, ".local", "bin");
    const sidecar = path.join(path.dirname(APP_BIN), "buzz-backend-hypercli");
    for (const name of PROVIDER_NAMES) {
      const link = path.join(binDir, name);
      if (!fs.existsSync(link)) fail(`missing provider link ${link}`);
      if (fs.realpathSync(link) !== fs.realpathSync(sidecar)) {
        fail(`${link} does not resolve to the bundled sidecar`);
      }
    }
    await expectDisplayed(browser, "#uninstall-btn", true);
    console.log(`[ok] all ${PROVIDER_NAMES.length} provider names symlinked to the sidecar`);

    // 5. Logout clears the credential and returns to the disconnected state.
    await (await browser.$("#logout-btn")).click();
    await waitForText(browser, "#status", "Logged out.");
    await expectDisplayed(browser, "#auth-disconnected", true);
    if (/^HYPER_API_KEY=/m.test(readConfig(home))) {
      fail("HYPER_API_KEY still present in ~/.hypercli/config after logout");
    }
    console.log("[ok] logout cleared the credential");

    console.log("PASS: desktop Linux e2e");
  } catch (error) {
    if (browser) await screenshot(browser, "failure");
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.deleteSession().catch(() => {});
    driver.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

await main();
