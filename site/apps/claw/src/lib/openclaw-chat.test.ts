import { describe, expect, it } from "vitest";

import {
  isInternalHeartbeatMessage,
  normalizeHistoryMessage,
  normalizeLiveToolResult,
  upsertAssistantMessage,
  type ChatMessage,
} from "./openclaw-chat";

describe("openclaw chat normalization", () => {
  it("filters heartbeat text from history thinking blocks", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "The user wants me to read HEARTBEAT.md from the workspace and follow it strictly.",
        },
      ],
    });

    expect(normalized).toBeNull();
  });

  it("filters heartbeat file reads from history tool calls", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "tool_call",
          name: "read",
          args: { path: "/home/node/.openclaw/workspace/HEARTBEAT.md" },
        },
      ],
    });

    expect(normalized).toBeNull();
  });

  it("does not attach live heartbeat tool calls to the previous assistant message", () => {
    const previous: ChatMessage[] = [
      {
        role: "assistant",
        content: "Visible answer",
        timestamp: 1,
      },
    ];

    const next = upsertAssistantMessage(previous, {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          name: "read",
          args: JSON.stringify({ path: "/home/node/.openclaw/workspace/HEARTBEAT.md" }),
        },
      ],
      timestamp: 2,
    });

    expect(next).toEqual(previous);
  });

  it("removes a partial heartbeat prelude when the marker arrives later", () => {
    const previous: ChatMessage[] = [
      {
        role: "assistant",
        content: "The user wants me to read ",
        timestamp: 1,
      },
    ];

    const next = upsertAssistantMessage(previous, {
      role: "assistant",
      content: "HEARTBEAT.md from the workspace and follow it strictly.",
      timestamp: 2,
    });

    expect(next).toEqual([]);
  });

  it("detects heartbeat markers in tool call payloads", () => {
    expect(
      isInternalHeartbeatMessage({
        toolCalls: [
          {
            name: "read",
            args: { path: "/home/node/.openclaw/workspace/HEARTBEAT.md" },
          },
        ],
      }),
    ).toBe(true);
  });

  it("omits raw PDF bytes from hydrated assistant messages", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: "%PDF-1.4\n1 0 obj<</Title (HyperWireframes)>>\nstream\n\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD",
    });

    expect(normalized?.content).toContain("Binary file content omitted");
  });

  it("omits raw PDF bytes from live tool results", () => {
    const normalized = normalizeLiveToolResult({
      name: "read",
      result: "%PDF-1.4\nstream\n\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD",
    });

    expect(normalized?.result).toContain("Binary file content omitted");
  });

  it("keeps binary placeholders compact when additional chunks arrive", () => {
    const previous: ChatMessage[] = [
      {
        role: "assistant",
        content: "%PDF-1.4\n1 0 obj",
        timestamp: 1,
      },
    ];

    const next = upsertAssistantMessage(previous, {
      role: "assistant",
      content: "\nstream\n\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD",
      timestamp: 2,
    });

    expect(next).toHaveLength(1);
    expect(next[0]?.content).toContain("Binary file content omitted");
    expect(next[0]?.content).not.toContain("%PDF-1.4");
  });
});
