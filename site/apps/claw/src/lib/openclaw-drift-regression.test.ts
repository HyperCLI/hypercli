import { describe, expect, it } from "vitest";

import { buildToolCallStackView } from "../components/dashboard/chat/helpers";
import {
  normalizeHistoryMessage,
  normalizeLiveToolCall,
  normalizeLiveToolResult,
  upsertAssistantMessage,
  type ChatMessage,
} from "./openclaw-chat";
import { reduceChatHistoryMessages } from "./openclaw-chat-history-state";

type FakeGatewayEvent = {
  event: string;
  sessionId?: string;
  method?: string;
  payload?: Record<string, unknown>;
};

function applyFakeGatewayChatEvent(messages: ChatMessage[], event: FakeGatewayEvent): ChatMessage[] {
  const payload = event.payload ?? {};
  if (event.event === "chat.tool_call") {
    const toolCall = normalizeLiveToolCall(payload);
    return toolCall
      ? upsertAssistantMessage(messages, { role: "assistant", content: "", toolCalls: [toolCall] })
      : messages;
  }
  if (event.event === "chat.tool_result") {
    const toolResult = normalizeLiveToolResult(payload);
    return toolResult
      ? upsertAssistantMessage(messages, { role: "assistant", content: "", toolCalls: [toolResult] })
      : messages;
  }
  if (event.event === "chat.content" && typeof payload.text === "string") {
    return upsertAssistantMessage(messages, { role: "assistant", content: payload.text });
  }
  return messages;
}

function visibleText(messages: ChatMessage[]): string {
  return messages.map((message) => message.content).join("\n");
}

describe("openclaw drift regressions", () => {
  it("ignores startup connector drift before a normal model response", () => {
    const startupEvents: FakeGatewayEvent[] = [
      {
        event: "gateway.close",
        sessionId: "ephemeral-connector-preload-1",
        payload: {
          code: "PAIRING_REQUIRED",
          reason: "pairing required",
          connector: "demo-chat",
          sender: "Example Creator",
        },
      },
      {
        event: "gateway.error",
        method: "integrations.status",
        payload: {
          error: { code: -32601, message: "unknown method: integrations.status" },
          requestId: "demo-request-integrations-status",
        },
      },
      {
        event: "sessions.reset",
        method: "sessions.reset",
        sessionId: "ephemeral-connector-preload-1",
        payload: { sessionKey: "ephemeral:demo-connector:one", cause: "preload retry" },
      },
      {
        event: "sessions.reset",
        method: "sessions.reset",
        sessionId: "ephemeral-connector-preload-2",
        payload: { sessionKey: "ephemeral:demo-connector:two", cause: "approval handoff" },
      },
      {
        event: "chat.content",
        sessionId: "demo-session",
        payload: {
          status: 200,
          model: "demo-model",
          stopReason: "stop",
          text: "Example Creator, the demo workspace is ready.",
        },
      },
    ];

    expect(startupEvents.slice(0, -1).map((event) => normalizeHistoryMessage(event))).toEqual([
      null,
      null,
      null,
      null,
    ]);

    const messages = startupEvents.reduce(applyFakeGatewayChatEvent, [
      { role: "user", content: "Start the creator-agent chat.", timestamp: 1 },
    ] satisfies ChatMessage[]);

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "Start the creator-agent chat." }),
      expect.objectContaining({
        role: "assistant",
        content: "Example Creator, the demo workspace is ready.",
      }),
    ]);
    expect(visibleText(messages)).not.toMatch(/integrations\.status|unknown method|pairing required|ephemeral/i);
  });

  it("keeps live tool calls visible through errors, recovery, final answer, and history refresh", () => {
    const events: FakeGatewayEvent[] = [
      {
        event: "chat.tool_call",
        sessionId: "demo-session",
        payload: {
          type: "chat.tool_call",
          id: "call-memory-0",
          name: "memory_search",
          args: { query: "Example Creator project preferences", source: "demo-session" },
        },
      },
      {
        event: "chat.tool_result",
        sessionId: "demo-session",
        payload: {
          type: "chat.tool_result",
          toolCallId: "call-memory-0",
          toolName: "memory_search",
          isError: true,
          result: {
            results: [],
            disabled: true,
            unavailable: true,
            error: "index provider settings changed",
            warning: "memory search paused",
            action: "run memory index --force",
          },
        },
      },
      {
        event: "chat.tool_call",
        sessionId: "demo-session",
        payload: {
          type: "chat.tool_call",
          id: "call-exec-1",
          name: "exec",
          args: { command: "printf 'demo status ok'" },
        },
      },
      {
        event: "chat.tool_result",
        sessionId: "demo-session",
        payload: {
          type: "chat.tool_result",
          toolCallId: "call-exec-1",
          toolName: "exec",
          result: { exitCode: 0, stdout: "demo status ok", stderr: "" },
        },
      },
      {
        event: "chat.tool_call",
        sessionId: "demo-session",
        payload: {
          type: "chat.tool_call",
          id: "call-web-2",
          name: "web_search",
          args: { query: "demo release notes" },
        },
      },
      {
        event: "chat.tool_result",
        sessionId: "demo-session",
        payload: {
          type: "chat.tool_result",
          toolCallId: "call-web-2",
          toolName: "web_search",
          isError: true,
          result: { status: 429, error: "rate limit", retryAfterSeconds: 30 },
        },
      },
      {
        event: "chat.tool_call",
        sessionId: "demo-session",
        payload: {
          type: "chat.tool_call",
          id: "call-exec-3",
          name: "exec",
          args: { command: "printf 'fallback ok'" },
        },
      },
      {
        event: "chat.tool_result",
        sessionId: "demo-session",
        payload: {
          type: "chat.tool_result",
          toolCallId: "call-exec-3",
          toolName: "exec",
          result: { exitCode: 0, stdout: "fallback ok", stderr: "" },
        },
      },
      {
        event: "chat.tool_call",
        sessionId: "demo-session",
        payload: {
          type: "chat.tool_call",
          id: "call-web-4",
          name: "web_search",
          args: { query: "demo docs cache" },
        },
      },
      {
        event: "chat.tool_result",
        sessionId: "demo-session",
        payload: {
          type: "chat.tool_result",
          toolCallId: "call-web-4",
          toolName: "web_search",
          result: { results: [{ title: "Example docs", snippet: "Cached demo doc." }] },
        },
      },
      {
        event: "chat.content",
        sessionId: "demo-session",
        payload: {
          type: "chat.content",
          stopReason: "stop",
          text: "I checked memory, shell, and search fallbacks, then completed the demo answer.",
        },
      },
    ];

    let messages: ChatMessage[] = [
      { role: "user", content: "Use creator-agent to check the demo status.", timestamp: 1 },
    ];
    for (const event of events.slice(0, 6)) {
      messages = applyFakeGatewayChatEvent(messages, event);
    }

    const failedLatest = messages.at(-1)?.toolCalls ?? [];
    expect(buildToolCallStackView(failedLatest, { isStreaming: true })).toMatchObject({
      status: "failed",
      isFailed: true,
      isRunning: false,
      failedCount: 2,
    });

    messages = applyFakeGatewayChatEvent(messages, events[6]!);
    const runningLatest = messages.at(-1)?.toolCalls ?? [];
    expect(buildToolCallStackView(runningLatest, { isStreaming: true })).toMatchObject({
      status: "running",
      isFailed: false,
      isRunning: true,
      failedCount: 2,
      pendingCount: 1,
    });

    for (const event of events.slice(7)) {
      messages = applyFakeGatewayChatEvent(messages, event);
    }

    const finalAssistant = messages.at(-1);
    const finalToolCalls = finalAssistant?.toolCalls ?? [];
    expect(finalAssistant).toMatchObject({
      role: "assistant",
      content: "I checked memory, shell, and search fallbacks, then completed the demo answer.",
    });
    expect(finalToolCalls.map((toolCall) => toolCall.name)).toEqual([
      "memory_search",
      "exec",
      "web_search",
      "exec",
      "web_search",
    ]);
    expect(buildToolCallStackView(finalToolCalls, { isStreaming: false })).toMatchObject({
      status: "done",
      isFailed: false,
      isRunning: false,
      failedCount: 2,
      pendingCount: 0,
    });

    const refreshedHistory = [
      normalizeHistoryMessage({
        role: "user",
        content: [{ type: "text", text: "Use creator-agent to check the demo status." }],
      }),
      normalizeHistoryMessage({
        role: "assistant",
        stopReason: "toolUse",
        content: [
          {
            type: "toolCall",
            id: "call-memory-0",
            name: "memory_search",
            arguments: { query: "Example Creator project preferences", source: "demo-session" },
          },
        ],
      }),
      normalizeHistoryMessage({
        role: "toolResult",
        toolCallId: "call-memory-0",
        toolName: "memory_search",
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              results: [],
              disabled: true,
              unavailable: true,
              error: "index provider settings changed",
              warning: "memory search paused",
              action: "run memory index --force",
            }),
          },
        ],
      }),
      normalizeHistoryMessage({
        role: "assistant",
        stopReason: "stop",
        content: [
          {
            type: "text",
            text: "I checked memory, shell, and search fallbacks, then completed the demo answer.",
          },
        ],
      }),
    ].filter((message): message is ChatMessage => Boolean(message));

    const refreshed = reduceChatHistoryMessages(messages, {
      type: "merge-history-refresh",
      messages: refreshedHistory,
    });

    expect(refreshed).toEqual([
      expect.objectContaining({ role: "user", content: "Use creator-agent to check the demo status." }),
      expect.objectContaining({
        role: "assistant",
        content: "I checked memory, shell, and search fallbacks, then completed the demo answer.",
        toolCalls: finalToolCalls,
      }),
    ]);
  });

  it("drops disconnect diagnostics and aborted ephemeral sessions before later success", () => {
    const diagnosticRecords = [
      {
        event: "gateway.diagnostic",
        sessionId: "ephemeral-diagnostic-1",
        payload: {
          type: "lane_wait_exceeded",
          message: "lane wait exceeded for ephemeral demo session",
          lane: "chat",
        },
      },
      {
        event: "gateway.diagnostic",
        sessionId: "ephemeral-diagnostic-1",
        payload: {
          type: "stalled_session",
          message: "stalled session detected",
          sessionKey: "ephemeral:demo-session:stalled",
        },
      },
      {
        role: "assistant",
        sessionId: "ephemeral-diagnostic-1",
        stopReason: "aborted",
        errorMessage: "abort recovery for ephemeral demo session",
        content: [],
      },
      {
        event: "sessions.reset",
        sessionId: "ephemeral-diagnostic-1",
        payload: {
          type: "abort_recovery",
          reason: "aborted",
          replacementSessionId: "demo-session",
        },
      },
    ];

    expect(diagnosticRecords.map((record) => normalizeHistoryMessage(record))).toEqual([
      null,
      null,
      null,
      null,
    ]);

    const messages = [
      ...diagnosticRecords.map((record) => ({ event: "diagnostic", payload: record })),
      {
        event: "chat.content",
        sessionId: "demo-session",
        payload: {
          status: 200,
          stopReason: "stop",
          text: "The recovered demo session returned a normal answer.",
        },
      },
    ].reduce(applyFakeGatewayChatEvent, [
      { role: "user", content: "Continue after the disconnect.", timestamp: 1 },
    ] satisfies ChatMessage[]);

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "Continue after the disconnect." }),
      expect.objectContaining({
        role: "assistant",
        content: "The recovered demo session returned a normal answer.",
      }),
    ]);
    expect(visibleText(messages)).not.toMatch(/lane wait exceeded|stalled session|abort recovery|aborted|ephemeral/i);
  });
});
