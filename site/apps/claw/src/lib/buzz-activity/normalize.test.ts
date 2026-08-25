import { describe, expect, it } from "vitest";

import {
  asRecord,
  asString,
  classifyTool,
  compareObserverEvents,
  extractContentText,
  extractPlanText,
  extractToolArgs,
  extractToolIdentity,
  extractToolResult,
  findBuzzToolName,
  friendlyTurnErrorCopy,
  isGenericToolTitle,
  MODEL_NOT_FOUND_COPY,
  normalizeToolName,
  normalizeToolNameText,
  normalizeToolStatus,
  observerEventKey,
  parseBuzzCliCommand,
  RELAY_MESH_DENIED_COPY,
  titleCase,
  tokenizeShellCommand,
  unwrapObserverBatch,
} from "./normalize";
import type { ObserverEvent } from "./types";

function frame(partial: Partial<ObserverEvent>): ObserverEvent {
  return {
    seq: 1,
    timestamp: "2026-08-25T10:00:00.000Z",
    kind: "unknown",
    agentIndex: null,
    channelId: "chan-1",
    sessionId: "sess-1",
    turnId: "turn-1",
    payload: {},
    ...partial,
  };
}

describe("guards", () => {
  it("asRecord returns {} for non-objects", () => {
    expect(asRecord(null)).toEqual({});
    expect(asRecord("x")).toEqual({});
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
  });

  it("asString passes strings only", () => {
    expect(asString("hi")).toBe("hi");
    expect(asString(3)).toBeNull();
  });

  it("titleCase normalizes separators", () => {
    expect(titleCase("turn_error")).toBe("Turn Error");
  });
});

describe("normalizeToolStatus", () => {
  it("maps status strings to the four-state union", () => {
    expect(normalizeToolStatus("completed")).toBe("completed");
    expect(normalizeToolStatus("SUCCESS")).toBe("completed");
    expect(normalizeToolStatus("done")).toBe("completed");
    expect(normalizeToolStatus("failed")).toBe("failed");
    expect(normalizeToolStatus("errored")).toBe("failed");
    expect(normalizeToolStatus("pending")).toBe("pending");
    expect(normalizeToolStatus("in_progress")).toBe("executing");
    expect(normalizeToolStatus("running")).toBe("executing");
  });
});

describe("tool name normalization", () => {
  it("normalizeToolNameText lowercases and underscores", () => {
    expect(normalizeToolNameText("Buzz Dev MCP — Shell!")).toBe(
      "buzz_dev_mcp_shell",
    );
  });

  it("findBuzzToolName resolves aliases and known names", () => {
    expect(findBuzzToolName("Sending message to channel", true)).toBe(
      "send_message",
    );
    expect(findBuzzToolName("buzz_mcp_get_messages", true)).toBe(
      "get_messages",
    );
    expect(findBuzzToolName("totally unknown", true)).toBeNull();
  });

  it("normalizeToolName strips buzz_ prefix", () => {
    expect(normalizeToolName("buzz_send_message")).toBe("send_message");
  });

  it("isGenericToolTitle flags placeholder titles", () => {
    expect(isGenericToolTitle("tool_call")).toBe(true);
    expect(isGenericToolTitle("MCP Tool Call")).toBe(true);
    expect(isGenericToolTitle("Read file")).toBe(false);
  });
});

describe("classifyTool", () => {
  const base = {
    title: "",
    toolName: "",
    buzzToolName: null,
    args: {} as Record<string, unknown>,
    result: "",
    isError: false,
  };

  it("classifies shell commands", () => {
    const result = classifyTool({
      ...base,
      toolName: "buzz_dev_mcp_shell",
      args: { command: "ls -la" },
    });
    expect(result.renderClass).toBe("shell");
    expect(result.label).toBe("Ran command");
    expect(result.preview).toBe("ls -la");
  });

  it("classifies *_shell suffixed names as shell", () => {
    expect(
      classifyTool({ ...base, toolName: "container_shell" }).renderClass,
    ).toBe("shell");
  });

  it("classifies read_file with path preview", () => {
    const result = classifyTool({
      ...base,
      toolName: "read_file",
      args: { path: "/tmp/a.ts" },
    });
    expect(result.renderClass).toBe("file-read");
    expect(result.label).toBe("Read file");
    expect(result.preview).toBe("/tmp/a.ts");
  });

  it("classifies str_replace variants as file edits", () => {
    const result = classifyTool({
      ...base,
      toolName: "buzz_dev_mcp_str_replace",
      args: { path: "/tmp/a.ts" },
    });
    expect(result.renderClass).toBe("file-edit");
    expect(result.label).toBe("Edited file");
    expect(result.preview).toBe("/tmp/a.ts");
  });

  it("classifies view_image and load_skill", () => {
    expect(
      classifyTool({
        ...base,
        toolName: "view_image",
        args: { source: "/img/cat.png" },
      }),
    ).toMatchObject({
      renderClass: "image",
      label: "Viewed image",
      preview: "cat.png",
    });
    expect(
      classifyTool({
        ...base,
        toolName: "load_skill",
        args: { name: "pdf" },
      }),
    ).toMatchObject({ renderClass: "skill-read", label: "Read skill" });
    expect(
      classifyTool({
        ...base,
        toolName: "load_skill",
        args: { name: "pdf/SKILL.md" },
      }).label,
    ).toBe("Read skill file");
  });

  it("classifies todo as plan and stop as suppressed", () => {
    expect(
      classifyTool({
        ...base,
        toolName: "todo",
        args: { todos: [{ text: "ship it" }] },
      }),
    ).toMatchObject({
      renderClass: "plan",
      label: "Updated todos",
      preview: "ship it",
    });
    expect(classifyTool({ ...base, toolName: "stop" }).renderClass).toBe(
      "suppressed",
    );
  });

  it("classifies buzz MCP read/write tools as relay-op/message", () => {
    expect(
      classifyTool({ ...base, toolName: "get_messages" }).renderClass,
    ).toBe("relay-op");
    const send = classifyTool({
      ...base,
      toolName: "send_message",
      args: { content: "hello" },
    });
    expect(send.renderClass).toBe("message");
    expect(send.label).toBe("Send Message");
    expect(send.preview).toBe("hello");
  });

  it("falls back to a generic descriptor", () => {
    expect(
      classifyTool({ ...base, toolName: "some_mcp_thing" }),
    ).toMatchObject({ renderClass: "generic", label: "Ran tool" });
  });

  it("marks errors with renderClass error and a failed label", () => {
    const result = classifyTool({
      ...base,
      toolName: "read_file",
      args: { path: "/tmp/a.ts" },
      isError: true,
    });
    expect(result.renderClass).toBe("error");
    expect(result.label).toBe("Read file failed");
  });
});

describe("parseBuzzCliCommand", () => {
  it("reclassifies buzz messages send to a message", () => {
    const result = parseBuzzCliCommand(
      'buzz messages send --channel general --content "hi there"',
    );
    expect(result).toMatchObject({
      renderClass: "message",
      label: "Send Message",
      preview: "hi there",
    });
  });

  it("reclassifies other buzz CLI invocations to relay-op", () => {
    const result = parseBuzzCliCommand("buzz channels list --channel eng");
    expect(result).toMatchObject({
      renderClass: "relay-op",
      label: "Channels List",
      preview: "eng",
    });
  });

  it("returns null for non-buzz commands", () => {
    expect(parseBuzzCliCommand("ls -la")).toBeNull();
    expect(parseBuzzCliCommand("buzz messages")).toBeNull();
  });

  it("tokenizes quoted shell commands", () => {
    expect(tokenizeShellCommand("buzz messages send 'a b' | jq")).toEqual([
      "buzz",
      "messages",
      "send",
      "a b",
      "|",
      "jq",
    ]);
  });
});

describe("payload extraction helpers", () => {
  it("extractContentText handles strings, arrays, and blocks", () => {
    expect(extractContentText("plain")).toBe("plain");
    expect(
      extractContentText([{ type: "text", text: "a" }, { text: "b" }]),
    ).toBe("a\nb");
    expect(extractContentText({ content: { text: "nested" } })).toBe("nested");
    expect(extractContentText({ rawOutput: "raw" })).toBe("raw");
  });

  it("extractPlanText formats a markdown checklist", () => {
    const text = extractPlanText({
      entries: [
        { status: "completed", content: "done step" },
        { status: "in_progress", content: "active step" },
        { status: "pending", content: "later step" },
      ],
    });
    expect(text).toBe(
      "- [x] done step\n- [ ] active step (in progress)\n- [ ] later step",
    );
  });

  it("extractPlanText falls back to content text then JSON", () => {
    expect(extractPlanText({ content: { type: "text", text: "plan body" } }))
      .toBe("plan body");
    expect(extractPlanText({})).toBe("{}");
  });

  it("extractToolArgs prefers args then arguments then input then rawInput", () => {
    expect(extractToolArgs({ args: { a: 1 }, input: { b: 2 } })).toEqual({
      a: 1,
    });
    expect(extractToolArgs({ arguments: { b: 2 } })).toEqual({ b: 2 });
    expect(extractToolArgs({ rawInput: { c: 3 } })).toEqual({ c: 3 });
    expect(extractToolArgs({ args: [1, 2] })).toEqual({});
  });

  it("extractToolIdentity resolves title, toolName, buzzToolName", () => {
    expect(
      extractToolIdentity({ title: "Sending message to channel" }),
    ).toEqual({
      title: "Sending message to channel",
      toolName: "send_message",
      buzzToolName: "send_message",
    });
    expect(extractToolIdentity({})).toEqual({
      title: "Tool call",
      toolName: "tool_call",
      buzzToolName: null,
    });
  });

  it("extractToolResult reads content then rawOutput", () => {
    expect(extractToolResult({ content: [{ text: "out" }] })).toBe("out");
    expect(extractToolResult({ rawOutput: "raw" })).toBe("raw");
  });
});

describe("friendlyTurnErrorCopy", () => {
  it("maps structured codes to friendly copy", () => {
    expect(friendlyTurnErrorCopy("raw error", -32002)).toBe(
      MODEL_NOT_FOUND_COPY,
    );
    expect(friendlyTurnErrorCopy("raw error", "-32001")).toBe(
      RELAY_MESH_DENIED_COPY,
    );
  });

  it("recovers codes embedded in the message", () => {
    expect(
      friendlyTurnErrorCopy("Agent reported error (code -32001): nope", null),
    ).toBe(RELAY_MESH_DENIED_COPY);
  });

  it("passes through unknown codes and missing codes", () => {
    expect(friendlyTurnErrorCopy("raw error", 12345)).toBe("raw error");
    expect(friendlyTurnErrorCopy("raw error", undefined)).toBe("raw error");
  });

  it("maps legacy llm auth prefix", () => {
    expect(friendlyTurnErrorCopy("llm auth: denied", "garbage")).toBe(
      RELAY_MESH_DENIED_COPY,
    );
  });
});

describe("observer frame plumbing", () => {
  it("unwrapObserverBatch expands a well-formed batch", () => {
    const inner = [frame({ seq: 1 }), frame({ seq: 2 })];
    const batch = frame({
      seq: 0,
      kind: "batch",
      payload: { events: inner },
    });
    expect(unwrapObserverBatch(batch)).toEqual(inner);
  });

  it("unwrapObserverBatch degrades a malformed batch to the envelope", () => {
    const batch = frame({ kind: "batch", payload: { nope: true } });
    expect(unwrapObserverBatch(batch)).toEqual([batch]);
    const empty = frame({ kind: "batch", payload: { events: [] } });
    expect(unwrapObserverBatch(empty)).toEqual([empty]);
  });

  it("compareObserverEvents orders by timestamp then seq", () => {
    const a = frame({ seq: 1, timestamp: "2026-08-25T10:00:00.000Z" });
    const b = frame({ seq: 2, timestamp: "2026-08-25T10:00:01.000Z" });
    const c = frame({ seq: 5, timestamp: a.timestamp });
    expect(compareObserverEvents(a, b)).toBeLessThan(0);
    expect(compareObserverEvents(a, c)).toBeLessThan(0);
    expect(compareObserverEvents(c, a)).toBeGreaterThan(0);
  });

  it("observerEventKey is length-prefixed on timestamp and seq", () => {
    expect(observerEventKey(frame({ seq: 7 }))).toBe(
      "24:2026-08-25T10:00:00.000Z:7",
    );
  });
});
