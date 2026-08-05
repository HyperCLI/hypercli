// Real HyperCLI Desktop -> dev backend -> Buzz relay -> hosted agent E2E.
//
// The owner nsec is accepted only through BUZZ_DEV_E2E_NSEC. It is typed into
// the native app's secure-connection form, never logged, written to disk, or
// placed in argv. The disposable agent and keychain entry are removed even on
// failure.

import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
import { remote } from "webdriverio";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_BASE = (process.env.TEST_API_BASE_URL || "https://api.dev.hypercli.com").replace(/\/+$/, "");
const RELAY_URL = (process.env.BUZZ_DEV_E2E_RELAY_URL || "wss://dev.buzz.hypercli.com").replace(/\/+$/, "");
const OWNER_NSEC = process.env.BUZZ_DEV_E2E_NSEC;
const EMAIL = process.env.TEST_EMAIL;
const ADMIN_KEY = process.env.BACKEND_API_KEY;
const APP_BIN = process.env.HYPERCLI_DESKTOP_APP || path.resolve(HERE, "../src-tauri/target/debug/HyperCLI");
const TAURI_DRIVER = process.env.TAURI_DRIVER || "tauri-driver";
const ARTIFACTS_DIR = process.env.E2E_ARTIFACTS_DIR || path.join(HERE, "artifacts");
// tauri-driver defaults its underlying WebKitWebDriver to 4445. Its own
// intermediary must use a distinct port (4444 is the upstream default).
const DRIVER_PORT = 4444;
const START_TIMEOUT_MS = 12 * 60_000;
const REPLY_TIMEOUT_MS = 60_000;

function fail(message) {
  throw new Error(message);
}

function requiredEnv() {
  if (!EMAIL) fail("TEST_EMAIL is required");
  if (!ADMIN_KEY) fail("BACKEND_API_KEY is required");
  if (!OWNER_NSEC?.startsWith("nsec1")) fail("BUZZ_DEV_E2E_NSEC is required");
  if (!fs.existsSync(APP_BIN)) fail(`app binary not found at ${APP_BIN}`);
}

async function mintSessionToken() {
  const url = new URL(`${API_BASE}/api/admin/auth/login`);
  url.searchParams.set("email", EMAIL);
  const response = await fetch(url, { headers: { "X-BACKEND-API-KEY": ADMIN_KEY } });
  if (!response.ok) fail(`admin auth login failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.token) fail("admin auth login returned no token");
  return payload.token;
}

function waitForDriver(proc, stderrTail, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let exited = false;
    proc.once("exit", (code) => {
      exited = true;
      reject(new Error(`tauri-driver exited early (code ${code}): ${stderrTail()}`));
    });
    (async () => {
      while (Date.now() < deadline) {
        if (exited) return;
        try {
          const response = await fetch(`http://127.0.0.1:${DRIVER_PORT}/status`);
          if (response.ok) return resolve();
        } catch {
          // Driver is still starting.
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
      }
      reject(new Error(`timed out waiting for tauri-driver: ${stderrTail()}`));
    })();
  });
}

function deliverDeepLink(env, token) {
  const url = `hypercli://auth#token=${encodeURIComponent(token)}`;
  return new Promise((resolve, reject) => {
    execFile(APP_BIN, [url], { env, timeout: 30_000 }, (error) => {
      if (error?.killed) return reject(new Error("deep-link second instance did not exit"));
      resolve();
    });
  });
}

async function tauriInvoke(browser, command, args = {}) {
  const result = await browser.executeAsync((cmd, invokeArgs, done) => {
    window.__TAURI__.core.invoke(cmd, invokeArgs)
      .then((value) => done({ ok: true, value }))
      .catch((error) => done({ ok: false, error: String(error) }));
  }, command, args);
  if (!result.ok) throw new Error(`${command} failed: ${result.error}`);
  return result.value;
}

async function waitForText(browser, selector, expected, timeoutMs = 60_000) {
  const element = await browser.$(selector);
  await browser.waitUntil(async () => (await element.getText()).includes(expected), {
    timeout: timeoutMs,
    timeoutMsg: `${selector} did not contain ${JSON.stringify(expected)} after ${timeoutMs}ms`,
  });
}

async function waitForAgent(browser, agentId, target, timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last = "missing";
  while (Date.now() < deadline) {
    const agents = await tauriInvoke(browser, "list_agents");
    const agent = agents.find((candidate) => candidate.id === agentId);
    last = agent?.state || "missing";
    if (last === target) return agent;
    if (["failed", "error", "deleted"].includes(last)) {
      fail(`agent entered terminal state ${last}: ${agent?.last_error || "no detail"}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
  }
  fail(`agent never reached ${target}; last state=${last}`);
}

async function forceCleanupDeployment(sessionToken, agentId, timeoutMs = 3 * 60_000) {
  const url = `${API_BASE}/agents/deployments/${agentId}`;
  const deadline = Date.now() + timeoutMs;
  let last = "cleanup not started";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (response.ok || response.status === 404 || response.status === 410) return;
      last = `HTTP ${response.status}`;
      if (response.status !== 409) break;
    } catch (error) {
      last = error?.name || "transport error";
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
  }
  fail(`deployment cleanup failed (${last})`);
}

function relayHttpBase() {
  if (RELAY_URL.startsWith("wss://")) return `https://${RELAY_URL.slice(6)}`;
  if (RELAY_URL.startsWith("ws://")) return `http://${RELAY_URL.slice(5)}`;
  fail("BUZZ_DEV_E2E_RELAY_URL must use ws:// or wss://");
}

function ownerSecret() {
  const decoded = nip19.decode(OWNER_NSEC);
  if (decoded.type !== "nsec" || !(decoded.data instanceof Uint8Array)) fail("invalid CI nsec");
  return decoded.data;
}

function authorization(secret, method, url, body) {
  const payload = createHash("sha256").update(body).digest("hex");
  const event = finalizeEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: [
      ["u", url],
      ["method", method],
      ["payload", payload],
      ["nonce", randomUUID()],
    ],
  }, secret);
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

async function relayRequest(secret, pathName, value) {
  const url = `${relayHttpBase()}${pathName}`;
  const body = Buffer.from(JSON.stringify(value));
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authorization(secret, "POST", url, body),
      "Content-Type": "application/json",
    },
    body,
  });
  if (!response.ok) fail(`Buzz relay ${pathName} failed: HTTP ${response.status}`);
  return response.json();
}

async function publishOwnerMessage(secret, channelId, agentPublicKey) {
  const sentAt = Math.floor(Date.now() / 1000) - 2;
  const event = finalizeEvent({
    kind: 9,
    created_at: sentAt + 2,
    content: "What is the capital of France? Reply with any short non-empty answer.",
    tags: [["h", channelId], ["p", agentPublicKey]],
  }, secret);
  const result = await relayRequest(secret, "/events", event);
  if (result.accepted !== true) fail("Buzz relay did not accept the CI message");
  return sentAt;
}

async function waitForReply(secret, channelId, agentPublicKey, since) {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const events = await relayRequest(secret, "/query", [{
      kinds: [9],
      authors: [agentPublicKey],
      "#h": [channelId],
      since,
      limit: 100,
    }]);
    const reply = Array.isArray(events)
      ? events.find((event) => event.pubkey === agentPublicKey && String(event.content || "").trim())
      : null;
    if (reply) return reply;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
  fail("hosted Buzz agent did not publish a non-empty reply within 60 seconds");
}

async function screenshot(browser, name) {
  try {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    await browser.saveScreenshot(path.join(ARTIFACTS_DIR, `${name}.png`));
  } catch {
    // Best effort only.
  }
}

async function main() {
  requiredEnv();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hypercli-desktop-buzz-e2e-"));
  const token = await mintSessionToken();
  const appEnv = {
    ...process.env,
    HOME: home,
    HYPER_API_BASE: API_BASE,
    WEBKIT_DISABLE_DMABUF_RENDERER: "1",
  };
  const driver = spawn(TAURI_DRIVER, ["--port", String(DRIVER_PORT)], {
    env: appEnv,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let driverStderr = "";
  driver.stderr.on("data", (chunk) => {
    driverStderr = `${driverStderr}${chunk}`.slice(-8192);
  });
  let browser;
  let agentId;
  let agentName;
  let connectionId;
  try {
    await waitForDriver(driver, () => driverStderr.trim().slice(-2000));
    browser = await remote({
      hostname: "127.0.0.1",
      port: DRIVER_PORT,
      path: "/",
      logLevel: "warn",
      connectionRetryTimeout: 60_000,
      capabilities: { "tauri:options": { application: APP_BIN } },
    });
    // The deep link is forwarded as a transient Tauri event. Prove the
    // webview has initialized before launching the second instance so the
    // auth-token listener cannot miss it (the ordinary Desktop E2E uses the
    // same startup handshake).
    await (await browser.$("#auth-disconnected")).waitForDisplayed({ timeout: 60_000 });
    await deliverDeepLink(appEnv, token);
    await waitForText(browser, "#status", "created and saved");
    await (await browser.$("#auth-connected")).waitForDisplayed({ timeout: 60_000 });

    await (await browser.$("#create-agent-btn")).click();
    // A clean CI home has no saved Buzz identity, so Create intentionally
    // routes through the first-class connection screen before opening the
    // agent editor. This is the production empty-state flow, not a test-only
    // setup shortcut.
    await (await browser.$("#buzz-connection-screen")).waitForDisplayed({ timeout: 60_000 });
    await (await browser.$("#connection-nsec")).waitForDisplayed({ timeout: 60_000 });
    await (await browser.$("#connection-label")).setValue("CI Buzz");
    await (await browser.$("#connection-relay")).setValue(RELAY_URL);
    await (await browser.$("#connection-nsec")).setValue(OWNER_NSEC);
    await (await browser.$("#connection-save")).click();
    await (await browser.$("#agent-screen")).waitForDisplayed({ timeout: 60_000 });
    const connectionSelect = await browser.$("#agent-connection");
    await browser.waitUntil(async () => (await connectionSelect.getValue()) !== "__add__", {
      timeout: 60_000,
      timeoutMsg: "Buzz connection was not saved",
    });
    connectionId = await connectionSelect.getValue();

    const channelSelect = await browser.$("#agent-community");
    let channelId;
    await browser.waitUntil(async () => {
      const options = await browser.execute(() => Array.from(
        document.querySelectorAll("#agent-community option"),
        (option) => ({ value: option.value, text: option.textContent || "" }),
      ));
      const ci = options.find((option) => (
        option.value && option.text.trim().replace(/^#/, "").toLowerCase() === "ci"
      ));
      channelId = ci?.value;
      return Boolean(channelId);
    }, { timeout: 60_000, timeoutMsg: "private #CI channel was not discovered" });
    if (!channelId) fail("#CI channel has no id");
    await channelSelect.selectByAttribute("value", channelId);

    agentName = `CI Buzz ${randomUUID().slice(0, 8)}`;
    await (await browser.$("#agent-name")).setValue(agentName);
    await (await browser.$("#agent-instructions")).setValue("Answer direct factual questions briefly and always publish the answer to Buzz.");
    await (await browser.$("#agent-runtime")).selectByAttribute("value", "buzz-agent");
    const invalidFields = await browser.execute(() => Array.from(
      document.querySelector("#agent-form").elements,
      (field) => ({ id: field.id, valid: field.checkValidity() }),
    ).filter((field) => !field.valid).map((field) => field.id));
    if (invalidFields.length) fail(`agent form is invalid: ${invalidFields.join(", ")}`);
    await (await browser.$("#agent-save")).click();
    let createError = "";
    await browser.waitUntil(async () => {
      if (await (await browser.$("#dashboard-view")).isDisplayed()) return true;
      createError = await browser.execute(() => {
        const status = document.querySelector("#status");
        return status?.classList.contains("error") ? status.textContent?.trim() || "" : "";
      });
      return Boolean(createError);
    }, { timeout: 60_000, timeoutMsg: "agent creation did not return to the dashboard" });
    if (createError) fail(`agent creation failed: ${createError}`);

    await browser.waitUntil(async () => {
      const candidates = await browser.execute(() => Array.from(
        document.querySelectorAll(".agent-card"),
        (candidate) => ({
          id: candidate.getAttribute("data-agent-id"),
          text: candidate.textContent || "",
        }),
      ));
      agentId = candidates.find((candidate) => candidate.text.includes(agentName))?.id;
      return Boolean(agentId);
    }, { timeout: 60_000, timeoutMsg: "new Buzz agent did not appear in the fleet" });
    const running = await waitForAgent(browser, agentId, "running");
    const agentPublicKey = running.agent_public_key;
    if (!/^[0-9a-f]{64}$/.test(agentPublicKey || "")) fail("running agent has no canonical Buzz public key");
    if (!running.tags.includes("app=buzz")) fail("running agent is missing app=buzz tag");

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10_000));
    const secret = ownerSecret();
    const ownerPublicKey = getPublicKey(secret);
    if (ownerPublicKey === agentPublicKey) fail("owner and agent identities must differ");
    const since = await publishOwnerMessage(secret, channelId, agentPublicKey);
    const reply = await waitForReply(secret, channelId, agentPublicKey, since);
    if (!String(reply.content || "").trim()) fail("agent reply was empty");
    console.log("[ok] Desktop launched a hosted Buzz agent and received a #CI reply");

    await tauriInvoke(browser, "stop_agent", { agentId });
    await waitForAgent(browser, agentId, "stopped");
    await tauriInvoke(browser, "delete_agent", { agentId });
    agentId = undefined;
    await tauriInvoke(browser, "remove_buzz_connection", { connectionId });
    connectionId = undefined;
    console.log("PASS: desktop Buzz dev-relay e2e");
  } catch (error) {
    if (browser) await screenshot(browser, "buzz-failure");
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (browser && (agentId || agentName)) {
      try {
        const agents = await tauriInvoke(browser, "list_agents");
        const agent = agents.find((candidate) => candidate.id === agentId)
          || agents.find((candidate) => candidate.name === agentName);
        if (agent) agentId = agent.id;
        if (agentId) await forceCleanupDeployment(token, agentId);
      } catch (cleanupError) {
        console.error(`CLEANUP: agent cleanup failed: ${cleanupError.message}`);
        process.exitCode = 1;
      }
    }
    if (browser && connectionId) {
      try {
        await tauriInvoke(browser, "remove_buzz_connection", { connectionId });
      } catch (cleanupError) {
        console.error(`CLEANUP: connection cleanup failed: ${cleanupError.message}`);
        process.exitCode = 1;
      }
    }
    if (browser) await browser.deleteSession().catch(() => {});
    driver.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

await main();
