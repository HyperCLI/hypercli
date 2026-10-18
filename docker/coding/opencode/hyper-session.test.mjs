import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import plugin from "./hyper-session.js";

test("each shell/CLI receives its exact platform binding, including concurrent and resumed invocations", async () => {
  const bindings = new Map([
    ["native/New", "11111111-1111-4111-8111-111111111111"],
    ["native/fork", "22222222-2222-4222-8222-222222222222"],
  ]);
  const calls = [];
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer offline-fixture");
    const url = new URL(request.url, "http://fixture");
    assert.equal(url.pathname, "/agents/sessions/resolve");
    const native = url.searchParams.get("native_session_id");
    calls.push(native);
    response.writeHead(bindings.has(native) ? 200 : 404, { "content-type": "application/json" });
    response.end(JSON.stringify({ session_id: bindings.get(native) }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = { ...process.env };
  try {
    process.env.HYPER_ACP_WS_URL = `ws://127.0.0.1:${server.address().port}/ws?discard=yes`;
    process.env.HYPER_AGENTS_API_KEY = "offline-fixture";
    process.env.HYPER_SESSION_ID = "stale-parent";
    const hook = (await plugin())["shell.env"];
    for (const ids of [["native/New", "native/fork"], ["native/New", "native/fork"]]) {
      await Promise.all(ids.map(async (sessionID) => {
        const output = { env: { HYPER_SESSION_ID: "stale-plugin", OTHER: "preserved" } };
        await hook({ sessionID }, output);
        assert.equal(output.env.OTHER, "preserved");
        const child = spawnSync(process.execPath, ["-e", "process.stdout.write(process.env.HYPER_SESSION_ID)"],
          { env: { ...process.env, ...output.env }, encoding: "utf8" });
        assert.equal(child.status, 0);
        assert.equal(child.stdout, bindings.get(sessionID));
      }));
    }
    assert.equal(calls.length, 4, "load/resume must resolve again, not use a cached binding");
    assert.equal(process.env.HYPER_SESSION_ID, "stale-parent", "never mutate shared process env");
    for (const sessionID of ["native/new", "unknown", "malformed"]) {
      if (sessionID === "malformed") bindings.set(sessionID, "native-not-platform");
      const output = { env: { HYPER_SESSION_ID: "stale" } };
      await assert.rejects(hook({ sessionID }, output), /Cannot resolve HYPER_SESSION_ID/);
      assert.equal(output.env.HYPER_SESSION_ID, "");
    }
    delete process.env.HYPER_AGENTS_API_KEY;
    await assert.rejects(hook({ sessionID: "native/New" }, { env: {} }), /Cannot resolve HYPER_SESSION_ID/);
  } finally {
    process.env = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});
