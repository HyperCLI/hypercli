import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { patchInstalledOpenClaw, patchSessionIdentity } from "./patch-acp-session-id.mjs";

// newSession from OpenClaw 2026.9.8 (MIT), src/acp/translator.session-lifecycle.ts,
// as published in dist/server-Gy7KuxEo.mjs, with only logging omitted and
// whitespace compacted. Dependencies are injected, including notifications.
const source = `class AcpTranslatorSessionLifecycle {
  async newSession(params) {
    this.assertSupportedSessionSetup(params.mcpServers);
    this.enforceSessionCreateRateLimit("newSession");
    const sessionId = randomUUID();
    const meta = parseSessionMeta(params["_meta"]);
    const sessionKey = await this.resolveSessionKeyFromMeta({
      meta,
      fallbackKey: \`acp-bridge:\${sessionId}\`
    });
    const session = this.sessionStore.createSession({sessionId, sessionKey, cwd: params.cwd});
    await this.sessionUpdates.startLedgerSession(session, {complete: true, reset: true});
    const sessionSnapshot = await this.sessionState.getSnapshot(session.sessionKey);
    await this.sessionState.sendSnapshotUpdate(session, sessionSnapshot, {includeControls: false, record: true});
    await this.sessionUpdates.sendAvailableCommands(session, {record: true});
    const { configOptions, modes } = sessionSnapshot;
    return {sessionId: session.sessionId, configOptions, modes};
  }
}
// getRuntimeConfig is supplied by the real bundle's existing import.
AcpTranslatorSessionLifecycle;`;

function lifecycle(patched, gateway, notifications, cfg = { owner: "default" }) {
  const code = patched ? patchSessionIdentity(source, "session-store-key-fixture.mjs", "i").replace(/^import[^\n]+\n/, "") : source;
  let count = 0;
  const Klass = runInNewContext(code, {
    randomUUID: () => `opaque-${gateway.next++}`,
    parseSessionMeta: () => ({}),
    getRuntimeConfig: () => cfg,
    hypercliResolveSessionStoreKey: (params) => {
      count++;
      assert.equal(params.cfg, cfg);
      // The patch must use the resolver's answer verbatim, not parse prefixes.
      return gateway.canonical(params.sessionKey);
    },
  });
  const instance = new Klass();
  const sessions = new Map();
  instance.assertSupportedSessionSetup = (servers) => assert.equal(servers.length, 0);
  instance.enforceSessionCreateRateLimit = () => {};
  instance.resolveSessionKeyFromMeta = async ({ fallbackKey }) => fallbackKey;
  instance.sessionStore = { createSession: (session) => { sessions.set(session.sessionId, session); return session; } };
  instance.sessionUpdates = {
    startLedgerSession: async () => {},
    sendAvailableCommands: async (session) => notifications.push(session.sessionId),
  };
  instance.sessionState = {
    getSnapshot: async () => ({}),
    sendSnapshotUpdate: async (session) => notifications.push(session.sessionId),
  };
  return { instance, sessions, resolverCalls: () => count };
}

for (const [patched, catalogBeforeNewReply] of [[false, true], [false, false], [true, true], [true, false]]) {
  test(`${patched ? "fixed" : "upstream repro"}: restart discovery ${catalogBeforeNewReply ? "during" : "after"} session/new`, async () => {
    const gateway = { next: 1, keys: new Set(), canonical: (key) => key.startsWith("agent:") ? key : `agent:default:${key}` };
    const notifications = [];
    const first = lifecycle(patched, gateway, notifications);
    const original = await first.instance.newSession({ cwd: "/home/node", mcpServers: [] });
    gateway.keys.add(gateway.canonical(first.sessions.get(original.sessionId).sessionKey)); // first turn persisted
    const platformBindings = new Set([original.sessionId]);
    // Runtime process restarted; the backend can list retained identity before
    // the dedicated native catalog request finishes (the production ordering).
    const restarted = lifecycle(patched, gateway, notifications);
    const delayedCatalog = [...gateway.keys];
    assert.equal(platformBindings.size, 1);
    let enteredNew, releaseNew;
    const entered = new Promise((resolve) => { enteredNew = resolve; });
    const release = new Promise((resolve) => { releaseNew = resolve; });
    restarted.instance.resolveSessionKeyFromMeta = async ({ fallbackKey }) => {
      enteredNew();
      await release;
      return fallbackKey;
    };
    const pendingNew = restarted.instance.newSession({ cwd: "/home/node", mcpServers: [] });
    await entered;
    if (catalogBeforeNewReply) {
      // Both observed CI runs committed the duplicate import just before the
      // second managed session. No elapsed-time sleep is needed to reproduce it.
      for (const id of delayedCatalog) platformBindings.add(id);
      assert.equal(platformBindings.size, patched ? 1 : 2);
    }
    releaseNew();
    const next = await pendingNew;
    gateway.keys.add(gateway.canonical(restarted.sessions.get(next.sessionId).sessionKey)); // next turn persisted
    platformBindings.add(next.sessionId);
    for (const id of delayedCatalog) platformBindings.add(id);
    assert.equal(platformBindings.size, patched ? 2 : 3);
    if (patched) {
      assert.ok(gateway.keys.has(original.sessionId));
      assert.ok(gateway.keys.has(next.sessionId));
      assert.equal(first.resolverCalls(), 1);
      assert.equal(restarted.resolverCalls(), 1);
      assert.deepEqual(notifications, [original.sessionId, original.sessionId, next.sessionId, next.sessionId]);
    }
  });
}

test("uses the runtime resolver's opaque identity verbatim", async () => {
  const gateway = { next: 1, keys: new Set(), canonical: () => "Owner/CaseSensitive:ID" };
  const { instance } = lifecycle(true, gateway, []);
  assert.equal((await instance.newSession({ cwd: "/home/node", mcpServers: [] })).sessionId, "Owner/CaseSensitive:ID");
});

test("build patch is version/source guarded and patches the installed bundle", () => {
  const root = mkdtempSync(join(tmpdir(), "openclaw-identity-"));
  try {
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "2026.9.8" }));
    writeFileSync(join(root, "dist/session-store-key-fixture.mjs"), "export { resolveSessionStoreKey as i };");
    const server = join(root, "dist/server-fixture.mjs");
    writeFileSync(server, source);
    patchInstalledOpenClaw(root);
    assert.equal(readFileSync(server, "utf8"), patchSessionIdentity(source, "session-store-key-fixture.mjs", "i"));
    assert.throws(() => patchInstalledOpenClaw(root));
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "future" }));
    assert.throws(() => patchInstalledOpenClaw(root), /Review ACP identity patch/);
    assert.throws(() => patchSessionIdentity(source + source, "session-store-key-fixture.mjs", "i"), /source changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
