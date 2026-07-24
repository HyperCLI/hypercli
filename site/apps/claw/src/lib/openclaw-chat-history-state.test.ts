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

    expect(messages).toEqual([
      expect.objectContaining({
        ...voiceMessage,
        renderId: expect.any(String),
      }),
    ]);
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

    expect(messages).toEqual(current.map((message) => expect.objectContaining({
      ...message,
      renderId: expect.any(String),
    })));
  });

  it("keeps a live assistant reply while history only contains its user turn", () => {
    const current: ChatMessage[] = [
      { role: "user", content: "Summarize the workspace", timestamp: 1 },
      { role: "assistant", content: "The workspace contains three projects.", timestamp: 2 },
    ];

    const messages = reduceChatHistoryMessages(current, {
      type: "merge-history-refresh",
      messages: [{ role: "user", content: "Summarize the workspace", timestamp: 3 }],
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "Summarize the workspace" }),
      expect.objectContaining({ role: "assistant", content: "The workspace contains three projects." }),
    ]);
  });

  it("does not carry an assistant reply onto a different fetched user turn", () => {
    const current: ChatMessage[] = [
      { role: "user", content: "Summarize project alpha", timestamp: 1 },
      { role: "assistant", content: "Alpha contains three services.", timestamp: 2 },
    ];

    const messages = reduceChatHistoryMessages(current, {
      type: "merge-history-refresh",
      messages: [{ role: "user", content: "Summarize project beta", timestamp: 3 }],
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "Summarize project beta" }),
    ]);
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

  it("keeps failed memory-search tool details when refreshed history only has the final answer", () => {
    const current: ChatMessage[] = [
      { role: "user", content: "Find live events and remember that preference", timestamp: 1 },
      {
        role: "assistant",
        content: "I checked the local memory first.",
        toolCalls: [
          {
            id: "memory_search_0",
            name: "memory_search",
            args: JSON.stringify({ query: "live events", corpus: "memory" }),
            result: JSON.stringify({
              results: [],
              disabled: true,
              unavailable: true,
              error: "index provider settings changed",
              warning: "memory search paused",
              action: "run memory index --force",
            }),
          },
        ],
        timestamp: 2,
      },
    ];

    const messages = reduceChatHistoryMessages(current, {
      type: "merge-history-refresh",
      messages: [
        { role: "user", content: "Find live events and remember that preference", timestamp: 3 },
        { role: "assistant", content: "I found the event list by checking files directly.", timestamp: 4 },
      ],
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "Find live events and remember that preference" }),
      expect.objectContaining({
        role: "assistant",
        content: "I found the event list by checking files directly.",
        toolCalls: [
          expect.objectContaining({
            id: "memory_search_0",
            name: "memory_search",
            result: expect.stringContaining("index provider settings changed"),
          }),
        ],
      }),
    ]);
  });

  it("keeps live tool-call assistant rows while history is still missing the assistant response", () => {
    const current: ChatMessage[] = [
      { role: "user", content: "Check the demo calendar", timestamp: 1 },
      {
        role: "assistant",
        content: "Checking the memory index.",
        toolCalls: [
          {
            id: "memory_search_0",
            name: "memory_search",
            args: JSON.stringify({ query: "demo calendar" }),
            result: 'Error: {"error":"index provider settings changed"}',
          },
        ],
        timestamp: 2,
      },
    ];

    const messages = reduceChatHistoryMessages(current, {
      type: "merge-history-refresh",
      messages: [
        { role: "user", content: "Check the demo calendar", timestamp: 3 },
      ],
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "Check the demo calendar" }),
      expect.objectContaining({
        role: "assistant",
        content: "Checking the memory index.",
        toolCalls: [
          expect.objectContaining({
            id: "memory_search_0",
            result: expect.stringContaining("index provider settings changed"),
          }),
        ],
      }),
    ]);
  });

  it("does not roll a fuller identified live reply back to a partial snapshot", () => {
    const current: ChatMessage[] = [
      { role: "user", content: "Explain the migration", renderId: "user-live" },
      {
        role: "assistant",
        content: "The migration has three complete steps.",
        messageId: "message-1",
        turnId: "turn-1",
        runId: "run-1",
        revision: 2,
        status: "interrupted",
        renderId: "assistant-live",
      },
    ];

    const messages = reduceChatHistoryMessages(current, {
      type: "merge-history-refresh",
      messages: [
        { role: "user", content: "Explain the migration", renderId: "user-history" },
        {
          role: "assistant",
          content: "The migration has three",
          messageId: "message-1",
          turnId: "turn-1",
          runId: "run-1",
          revision: 1,
          renderId: "assistant-history",
        },
      ],
    });

    expect(messages[1]).toMatchObject({
      content: "The migration has three complete steps.",
      messageId: "message-1",
      revision: 2,
      status: "interrupted",
      renderId: "assistant-live",
    });
  });

  it("accepts a shorter correction when the history revision is newer", () => {
    const messages = reduceChatHistoryMessages([
      { role: "user", content: "Give the exact total", renderId: "user-live" },
      {
        role: "assistant",
        content: "The total is approximately one hundred and twenty.",
        messageId: "message-1",
        revision: 2,
        renderId: "assistant-live",
      },
    ], {
      type: "merge-history-refresh",
      messages: [
        { role: "user", content: "Give the exact total", renderId: "user-history" },
        {
          role: "assistant",
          content: "The total is 120.",
          messageId: "message-1",
          revision: 3,
          renderId: "assistant-history",
        },
      ],
    });

    expect(messages[1]).toMatchObject({
      content: "The total is 120.",
      revision: 3,
      renderId: "assistant-live",
    });
  });

  it("does not match repeated user text when both turns have different protocol identities", () => {
    const messages = reduceChatHistoryMessages([
      { role: "user", content: "Try again", messageId: "user-live", renderId: "user-live-row" },
      {
        role: "assistant",
        content: "New reply",
        messageId: "assistant-live",
        turnId: "turn-live",
        renderId: "assistant-live-row",
      },
    ], {
      type: "merge-history-refresh",
      messages: [
        { role: "user", content: "Try again", messageId: "user-history", renderId: "user-history-row" },
      ],
    });

    expect(messages).toEqual([
      expect.objectContaining({ messageId: "user-history", renderId: "user-history-row" }),
    ]);
  });

  it("preserves the original retry prompt when history replaces a local user row", () => {
    const messages = reduceChatHistoryMessages([
      {
        role: "user",
        content: "Visible request",
        retryContent: "Internal request sent to the agent",
        renderId: "user-live",
      },
    ], {
      type: "merge-history-refresh",
      messages: [{ role: "user", content: "Visible request", renderId: "user-history" }],
    });

    expect(messages[0]).toEqual(expect.objectContaining({
      content: "Visible request",
      retryContent: "Internal request sent to the agent",
      renderId: "user-live",
    }));
  });

  it("preserves a stopped-reply notice across a lagging same-turn snapshot", () => {
    const current = reduceChatHistoryMessages([
      { role: "user", content: "Stop immediately", renderId: "user-live" },
    ], { type: "mark-interrupted" });

    const messages = reduceChatHistoryMessages(current, {
      type: "merge-history-refresh",
      messages: [{ role: "user", content: "Stop immediately", renderId: "user-history" }],
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "Stop immediately", renderId: "user-live" }),
      expect.objectContaining({ role: "system", content: "Reply stopped", renderId: expect.any(String) }),
    ]);
  });

  it("assigns distinct render ids without globally deduping equal message content", () => {
    const messages = reduceChatHistoryMessages([], {
      type: "restore-cache",
      messages: [
        { role: "assistant", content: "Repeated answer" },
        { role: "assistant", content: "Repeated answer" },
      ],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.renderId).toEqual(expect.any(String));
    expect(messages[1]?.renderId).toEqual(expect.any(String));
    expect(messages[0]?.renderId).not.toBe(messages[1]?.renderId);
  });

  it("retains render ids for unchanged legacy rows when history prepends a message", () => {
    const messages = reduceChatHistoryMessages([
      { role: "user", content: "Existing question", timestamp: 10, renderId: "user-existing" },
      { role: "assistant", content: "Existing answer", timestamp: 20, renderId: "assistant-existing" },
    ], {
      type: "merge-history-refresh",
      messages: [
        { role: "system", content: "Earlier notice", timestamp: 5 },
        { role: "user", content: "Existing question", timestamp: 10 },
        { role: "assistant", content: "Existing answer", timestamp: 20 },
      ],
    });

    expect(messages).toEqual([
      expect.objectContaining({ content: "Earlier notice", renderId: expect.any(String) }),
      expect.objectContaining({ content: "Existing question", renderId: "user-existing" }),
      expect.objectContaining({ content: "Existing answer", renderId: "assistant-existing" }),
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
