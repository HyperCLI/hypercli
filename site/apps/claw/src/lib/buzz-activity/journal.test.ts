import { describe, expect, it } from "vitest";

import { BuzzActivityJournal } from "./journal";
import type { ObserverEvent } from "./types";

let seq = 0;

function frame(
  kind: string,
  payload: unknown,
  overrides: Partial<ObserverEvent> = {},
): ObserverEvent {
  seq += 1;
  return {
    seq,
    timestamp: new Date(Date.UTC(2026, 7, 25, 10, 0, 0, seq)).toISOString(),
    kind,
    agentIndex: 0,
    channelId: "chan-1",
    sessionId: "sess-1",
    turnId: "turn-1",
    payload,
    ...overrides,
  };
}

function sessionUpdate(update: Record<string, unknown>): ObserverEvent {
  return frame("acp_read", {
    method: "session/update",
    params: { update },
  });
}

describe("BuzzActivityJournal full turn", () => {
  function fullTurnFrames(): ObserverEvent[] {
    return [
      frame("turn_started", { triggeringEventIds: ["a".repeat(64)] }),
      frame("acp_write", {
        method: "session/prompt",
        params: { prompt: [{ type: "text", text: "Fix the bug" }] },
      }),
      sessionUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "shell",
        status: "in_progress",
        args: { command: "npm test" },
      }),
      sessionUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-1",
        status: "completed",
        rawOutput: "all green",
      }),
      sessionUpdate({
        sessionUpdate: "agent_message_chunk",
        content: [{ type: "text", text: "Fixed it. " }],
      }),
      sessionUpdate({
        sessionUpdate: "agent_message_chunk",
        content: [{ type: "text", text: "Tests pass." }],
      }),
      frame("turn_completed", { outcome: "success" }),
    ];
  }

  it("folds a full turn into upserted activity events", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll(fullTurnFrames());

    const events = journal.events();
    expect(events).toHaveLength(4);

    const [turn, prompt, tool, message] = events;
    expect(turn).toMatchObject({
      id: "turn:chan-1:turn-1",
      renderClass: "status",
      label: "Turn started",
      status: "completed",
    });
    expect(prompt).toMatchObject({
      renderClass: "message",
      label: "User",
      detail: "Fix the bug",
    });
    expect(tool).toMatchObject({
      id: "tool:chan-1:tc-1",
      renderClass: "shell",
      label: "Ran command",
      preview: "npm test",
      detail: "all green",
      status: "completed",
      toolCallId: "tc-1",
    });
    expect(message).toMatchObject({
      renderClass: "message",
      label: "Assistant",
      detail: "Fixed it. Tests pass.",
    });
  });

  it("reports inserted-or-updated events per frame", () => {
    const journal = new BuzzActivityJournal();
    const frames = fullTurnFrames();

    const started = journal.append(frames[0]);
    expect(started.map((event) => event.id)).toEqual([
      "turn:chan-1:turn-1",
    ]);

    journal.append(frames[1]);
    journal.append(frames[2]);

    const toolUpdated = journal.append(frames[3]);
    expect(toolUpdated).toHaveLength(1);
    expect(toolUpdated[0]).toMatchObject({
      id: "tool:chan-1:tc-1",
      status: "completed",
    });

    journal.append(frames[4]);
    const appendedChunk = journal.append(frames[5]);
    expect(appendedChunk).toHaveLength(1);
    expect(appendedChunk[0].detail).toBe("Fixed it. Tests pass.");

    const completed = journal.append(frames[6]);
    expect(completed[0]).toMatchObject({
      id: "turn:chan-1:turn-1",
      status: "completed",
    });
  });

  it("orders events by (timestamp, seq)", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll(fullTurnFrames());
    const stamps = journal
      .events()
      .map((event) => `${event.timestamp}#${event.seq}`);
    const sorted = [...stamps].sort();
    expect(stamps).toEqual(sorted);
  });

  it("preserves the raw frame on every event", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll(fullTurnFrames());
    for (const event of journal.events()) {
      expect(event.raw).toBeDefined();
      expect(event.raw.seq).toBe(event.seq);
    }
  });
});

describe("tool classification through the journal", () => {
  it("labels read_file and str_replace with previews", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll([
      sessionUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "r1",
        title: "read_file",
        status: "completed",
        args: { path: "/src/app.ts" },
      }),
      sessionUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "e1",
        title: "buzz_dev_mcp_str_replace",
        status: "completed",
        args: { path: "/src/app.ts" },
      }),
    ]);
    const [read, edit] = journal.events();
    expect(read).toMatchObject({
      renderClass: "file-read",
      label: "Read file",
      preview: "/src/app.ts",
    });
    expect(edit).toMatchObject({
      renderClass: "file-edit",
      label: "Edited file",
      preview: "/src/app.ts",
    });
  });

  it("reclassifies `buzz messages send` shell calls to message", () => {
    const journal = new BuzzActivityJournal();
    journal.append(
      sessionUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "s1",
        title: "shell",
        status: "completed",
        args: { command: 'buzz messages send --content "hi team"' },
      }),
    );
    expect(journal.events()[0]).toMatchObject({
      renderClass: "message",
      label: "Send Message",
      preview: "hi team",
    });
  });

  it("reclassifies other buzz CLI shell calls to relay-op", () => {
    const journal = new BuzzActivityJournal();
    journal.append(
      sessionUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "s2",
        title: "shell",
        status: "completed",
        args: { command: "buzz channels list" },
      }),
    );
    expect(journal.events()[0].renderClass).toBe("relay-op");
  });

  it("marks failed tools with isError and a failed label", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll([
      sessionUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "f1",
        title: "read_file",
        status: "in_progress",
        args: { path: "/missing" },
      }),
      sessionUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId: "f1",
        status: "failed",
        rawOutput: "ENOENT",
      }),
    ]);
    expect(journal.events()).toHaveLength(1);
    expect(journal.events()[0]).toMatchObject({
      renderClass: "error",
      label: "Read file failed",
      isError: true,
      status: "failed",
      detail: "ENOENT",
    });
  });

  it("keeps terminal status sticky across later non-terminal updates", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll([
      sessionUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "shell",
        status: "in_progress",
        args: { command: "make" },
      }),
      sessionUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      }),
      sessionUpdate({
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "in_progress",
      }),
    ]);
    expect(journal.events()[0].status).toBe("completed");
  });
});

describe("permissions", () => {
  function permissionRequest(id: string): ObserverEvent {
    return frame("acp_read", {
      id,
      method: "session/request_permission",
      params: {
        title: "Run rm -rf?",
        toolCallId: "tc-9",
        options: [
          { optionId: "allow", kind: "allow_once", name: "Allow" },
          { optionId: "deny", kind: "reject_once", name: "Deny" },
        ],
      },
    });
  }

  it("correlates request and response by JSON-RPC id", () => {
    const journal = new BuzzActivityJournal();
    journal.append(permissionRequest("perm-1"));
    const updated = journal.append(
      frame("acp_write", {
        id: "perm-1",
        result: { outcome: { outcome: "selected", optionId: "allow" } },
      }),
    );

    expect(journal.events()).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      renderClass: "permission",
      label: "Permission requested",
      status: "completed",
    });
    expect(updated[0].detail).toContain("Approved (allow_once)");
  });

  it("labels denials and cancellations", () => {
    const journal = new BuzzActivityJournal();
    journal.append(permissionRequest("perm-2"));
    journal.append(
      frame("acp_write", {
        id: "perm-2",
        result: { outcome: { outcome: "selected", optionId: "deny" } },
      }),
    );
    expect(journal.events()[0].detail).toContain("Denied (reject_once)");

    const journal2 = new BuzzActivityJournal();
    journal2.append(permissionRequest("perm-3"));
    journal2.append(
      frame("acp_write", {
        id: "perm-3",
        result: { outcome: { outcome: "cancelled" } },
      }),
    );
    expect(journal2.events()[0].detail).toContain("Cancelled");
  });
});

describe("plan, usage, and config updates", () => {
  it("renders plan entries as a markdown checklist", () => {
    const journal = new BuzzActivityJournal();
    journal.append(
      sessionUpdate({
        sessionUpdate: "plan",
        entries: [
          { status: "completed", content: "Repro" },
          { status: "in_progress", content: "Fix" },
        ],
      }),
    );
    expect(journal.events()[0]).toMatchObject({
      renderClass: "plan",
      label: "Plan",
      detail: "- [x] Repro\n- [ ] Fix (in progress)",
    });
  });

  it("replaces usage_update in place", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll([
      sessionUpdate({
        sessionUpdate: "usage_update",
        used: 100,
        size: 200000,
        cost: { amount: 0.0123, currency: "USD" },
      }),
      sessionUpdate({
        sessionUpdate: "usage_update",
        used: 250,
        size: 200000,
        cost: { amount: 0.0456, currency: "USD" },
      }),
    ]);
    expect(journal.events()).toHaveLength(1);
    expect(journal.events()[0]).toMatchObject({
      renderClass: "status",
      label: "Usage",
      detail: "Tokens: 250/200000 ($0.0456 USD)",
    });
  });

  it("renders config_option_update as name=value pairs", () => {
    const journal = new BuzzActivityJournal();
    journal.append(
      sessionUpdate({
        sessionUpdate: "config_option_update",
        configOptions: [
          { name: "model", currentValue: "claude-4" },
          { id: "fast", value: false },
        ],
      }),
    );
    expect(journal.events()[0]).toMatchObject({
      label: "Config",
      detail: "model = claude-4, fast = false",
    });
  });

  it("renders available_commands_update and current_mode_update", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll([
      sessionUpdate({
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "a" }, { name: "b" }],
      }),
      sessionUpdate({
        sessionUpdate: "current_mode_update",
        currentModeId: "code",
      }),
    ]);
    const [commands, mode] = journal.events();
    expect(commands.detail).toBe("Commands available: 2");
    expect(mode.label).toBe("Mode: code");
  });
});

describe("frame-level kinds", () => {
  it("renders session_resolved, harness_started, and lifecycle frames", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll([
      frame("session_resolved", { isNewSession: true }),
      frame("harness_started", {}),
      frame("managed_agent_runtime_lifecycle", { lifecycle: "ready" }),
      frame("managed_agent_runtime_lifecycle", { lifecycle: "failed" }),
    ]);
    const [resolved, harness, ready, failed] = journal.events();
    expect(resolved).toMatchObject({ label: "Session ready" });
    expect(harness).toMatchObject({ label: "Harness started" });
    expect(ready).toMatchObject({ label: "Runtime ready" });
    expect(failed).toMatchObject({
      label: "Runtime failed",
      renderClass: "error",
      isError: true,
    });
  });

  it("renders control_result for model switch and cancel", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll([
      frame("control_result", {
        method: "switch_model",
        status: "ok",
        modelId: "claude-4",
      }),
      frame("control_result", { method: "cancel_turn", status: "done" }),
    ]);
    expect(journal.events()[0].label).toBe("Model switch: ok claude-4");
    expect(journal.events()[1].label).toBe("Cancel: done");
  });

  it("captures session config and summarizes model/mode", () => {
    const journal = new BuzzActivityJournal();
    journal.append(
      frame("session_config_captured", {
        modelId: "claude-4",
        modeId: "code",
      }),
    );
    expect(journal.events()[0]).toMatchObject({
      label: "Session config captured",
      detail: "Model: claude-4 Mode: code",
    });
    expect(journal.getSessionConfig()).toMatchObject({
      modelId: "claude-4",
    });
  });

  it("renders turn_error with friendly copy and acp_parse_error", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll([
      frame("turn_error", {
        outcome: "failed",
        error: "raw error",
        code: -32002,
      }),
      frame("acp_parse_error", { text: "bad json on the wire" }),
    ]);
    const [turnError, parseError] = journal.events();
    expect(turnError).toMatchObject({
      renderClass: "error",
      label: "Turn error",
      isError: true,
    });
    expect(turnError.detail).toBe(
      "failed: The configured model is not available — open agent settings and select a different one from the dropdown.",
    );
    expect(parseError).toMatchObject({
      renderClass: "error",
      label: "Wire parse error",
      detail: "bad json on the wire",
    });
  });

  it("tracks turn_liveness internally without emitting events", () => {
    const journal = new BuzzActivityJournal();
    const changed = journal.append(
      frame("turn_liveness", { state: "awaiting_input" }),
    );
    expect(changed).toEqual([]);
    expect(journal.events()).toHaveLength(0);
    expect(journal.getTurnLiveness("turn-1")).toMatchObject({
      turnId: "turn-1",
    });
  });

  it("suppresses user_message_chunk echo after a steer", () => {
    const journal = new BuzzActivityJournal();
    journal.append(
      frame("acp_write", {
        method: "_goose/unstable/session/steer",
        params: { prompt: [{ type: "text", text: "steered text" }] },
      }),
    );
    const changed = journal.append(
      sessionUpdate({
        sessionUpdate: "user_message_chunk",
        content: [{ type: "text", text: "steered text" }],
      }),
    );
    expect(changed).toEqual([]);
    expect(journal.events()).toHaveLength(1);
    expect(journal.events()[0].detail).toBe("steered text");
  });

  it("upserts thoughts by messageId or turn", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll([
      sessionUpdate({
        sessionUpdate: "agent_thought_chunk",
        messageId: "m1",
        content: [{ type: "text", text: "thinking… " }],
      }),
      sessionUpdate({
        sessionUpdate: "agent_thought_chunk",
        messageId: "m1",
        content: [{ type: "text", text: "still thinking" }],
      }),
    ]);
    expect(journal.events()).toHaveLength(1);
    expect(journal.events()[0]).toMatchObject({
      renderClass: "thought",
      label: "Thinking",
      detail: "thinking… still thinking",
    });
  });
});

describe("tolerance and dedup", () => {
  it("ignores unknown sessionUpdate kinds without title+text", () => {
    const journal = new BuzzActivityJournal();
    const changed = journal.append(
      sessionUpdate({ sessionUpdate: "some_future_update", blob: 1 }),
    );
    expect(changed).toEqual([]);
    expect(journal.events()).toHaveLength(0);
  });

  it("surfaces unknown sessionUpdate kinds with explicit title+text", () => {
    const journal = new BuzzActivityJournal();
    journal.append(
      frame("acp_read", {
        method: "session/update",
        params: { update: { sessionUpdate: "some_future_update" } },
        title: "Notice",
        text: "something happened",
      }),
    );
    expect(journal.events()[0]).toMatchObject({
      renderClass: "status",
      label: "Notice",
      detail: "something happened",
    });
  });

  it("tolerates unknown frame kinds without emitting", () => {
    const journal = new BuzzActivityJournal();
    expect(journal.append(frame("mystery_kind", { a: 1 }))).toEqual([]);
    expect(journal.events()).toHaveLength(0);
  });

  it("ignores acp frames with unrelated methods", () => {
    const journal = new BuzzActivityJournal();
    expect(
      journal.append(frame("acp_write", { method: "session/cancel" })),
    ).toEqual([]);
    expect(journal.events()).toHaveLength(0);
  });

  it("dedups frames on (timestamp, seq)", () => {
    const journal = new BuzzActivityJournal();
    const started = frame("turn_started", {});
    expect(journal.append(started)).toHaveLength(1);
    expect(journal.append(started)).toEqual([]);
    expect(journal.events()).toHaveLength(1);
  });

  it("unwraps batch envelopes and degrades malformed batches", () => {
    const journal = new BuzzActivityJournal();
    const inner = [
      frame("harness_started", {}),
      frame("session_resolved", {}),
    ];
    const batch = frame(
      "batch",
      { events: inner },
      { turnId: null },
    );
    const changed = journal.append(batch);
    expect(changed).toHaveLength(2);
    expect(journal.events()).toHaveLength(2);

    const malformed = frame("batch", { events: "nope" }, { turnId: null });
    expect(journal.append(malformed)).toEqual([]);
    expect(journal.events()).toHaveLength(2);
  });

  it("tolerates elided payloads and elided strings", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll([
      sessionUpdate({
        sessionUpdate: "agent_message_chunk",
        messageId: "m-elide",
        content: { elided: true, originalBytes: 4096 },
      }),
      sessionUpdate({
        sessionUpdate: "agent_thought_chunk",
        messageId: "t-elide",
        content: [{ type: "text", text: "head…[elided 2048 bytes]…tail" }],
      }),
    ]);
    const [message, thought] = journal.events();
    expect(message.detail).toBe("");
    expect(thought.detail).toBe("head…[elided 2048 bytes]…tail");
  });

  it("resets all state", () => {
    const journal = new BuzzActivityJournal();
    journal.appendAll([
      frame("turn_started", {}),
      frame("harness_started", {}),
    ]);
    journal.reset();
    expect(journal.events()).toHaveLength(0);
    expect(journal.rawEvents()).toHaveLength(0);
    expect(journal.append(frame("harness_started", {}))).toHaveLength(1);
  });
});

describe("cap trimming", () => {
  it("trims to 2700 events when exceeding the 3000 cap", () => {
    const journal = new BuzzActivityJournal();
    const frames: ObserverEvent[] = [];
    for (let i = 0; i < 3001; i++) {
      frames.push(frame("acp_parse_error", { text: `err ${i}` }));
    }
    journal.appendAll(frames);
    expect(journal.rawEvents()).toHaveLength(2700);
    expect(journal.events()).toHaveLength(2700);
    expect(journal.events()[0].detail).toBe("err 301");
  });

  it("honours a custom cap", () => {
    const journal = new BuzzActivityJournal({ cap: 30 });
    const frames: ObserverEvent[] = [];
    for (let i = 0; i < 31; i++) {
      frames.push(frame("acp_parse_error", { text: `err ${i}` }));
    }
    journal.appendAll(frames);
    expect(journal.events()).toHaveLength(1);
    // cap 30 → low water max(1, 30 - 300) = 1
  });
});
