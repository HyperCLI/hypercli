import { describe, expect, it } from "vitest";

import type { ChatMessage } from "./openclaw-chat";
import { reduceChatHistoryMessages, sameChatHistoryTarget } from "./openclaw-chat-history-state";

describe("openclaw chat history state", () => {
  it("dedupes restored voice-note history by attached audio file", () => {
    const voiceMessage: ChatMessage = {
      role: "user",
      content: "I recorded a voice message. Run this command to transcribe it:\n`hyper voice transcribe /home/node/.openclaw/workspace/voice-1.webm`",
      files: [{ name: "voice-1.webm", path: "/home/node/.openclaw/workspace/voice-1.webm", type: "audio/webm" }],
      timestamp: 1,
    };

    const messages = reduceChatHistoryMessages([], {
      type: "restore-cache",
      messages: [voiceMessage, { ...voiceMessage, timestamp: 2 }],
    });

    expect(messages).toEqual([voiceMessage]);
  });

  it("preserves optimistic messages when refreshed history is shorter", () => {
    const current: ChatMessage[] = [
      { role: "user", content: "Generate a report", timestamp: 1 },
      { role: "assistant", content: "Working on it", timestamp: 2 },
    ];

    const messages = reduceChatHistoryMessages(current, {
      type: "merge-history-refresh",
      messages: [{ role: "assistant", content: "Old response", timestamp: 3 }],
    });

    expect(messages).toBe(current);
  });

  it("merges streamed tool calls into refreshed assistant history", () => {
    const current: ChatMessage[] = [
      { role: "user", content: "Inspect archive", timestamp: 1 },
      {
        role: "assistant",
        content: "Live summary",
        toolCalls: [{ id: "tool-1", name: "functions.read", args: "{\"path\":\"archive.zip\"}", result: "Read complete" }],
        timestamp: 2,
      },
    ];

    const messages = reduceChatHistoryMessages(current, {
      type: "merge-history-refresh",
      messages: [
        { role: "user", content: "Inspect archive", timestamp: 3 },
        { role: "assistant", content: "History summary", timestamp: 4 },
      ],
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "Inspect archive" }),
      expect.objectContaining({
        role: "assistant",
        content: "History summary",
        toolCalls: [expect.objectContaining({ id: "tool-1", result: "Read complete" })],
      }),
    ]);
  });

  it("marks the latest visible assistant reply as interrupted", () => {
    const messages = reduceChatHistoryMessages([
      { role: "user", content: "Stop after starting", timestamp: 1 },
      { role: "assistant", content: "Partial answer", timestamp: 2 },
    ], { type: "mark-interrupted" });

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "Stop after starting" }),
      expect.objectContaining({ role: "assistant", content: "Partial answer", status: "interrupted" }),
    ]);
  });

  it("adds one stopped notice when no assistant reply is visible", () => {
    const first = reduceChatHistoryMessages([
      { role: "user", content: "Stop immediately", timestamp: 1 },
    ], { type: "mark-interrupted" });
    const second = reduceChatHistoryMessages(first, { type: "mark-interrupted" });

    expect(first).toEqual([
      expect.objectContaining({ role: "user", content: "Stop immediately" }),
      expect.objectContaining({ role: "system", content: "Reply stopped" }),
    ]);
    expect(second).toEqual(first);
  });

  it("compares chat history targets by agent and visible session key", () => {
    expect(sameChatHistoryTarget(
      { agentId: "agent-1", sessionKey: "main" },
      { agentId: "agent-1", sessionKey: "main" },
    )).toBe(true);
    expect(sameChatHistoryTarget(
      { agentId: "agent-1", sessionKey: "main" },
      { agentId: "agent-1", sessionKey: "telegram:123" },
    )).toBe(false);
  });
});
