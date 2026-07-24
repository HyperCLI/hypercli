import { beforeEach, describe, expect, it } from "vitest";

import {
  readCachedOpenClawChatHistory,
  writeCachedOpenClawChatHistory,
} from "./openclaw-chat-history-cache";

describe("openclaw chat history cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("preserves render and protocol identity through cache compaction", () => {
    writeCachedOpenClawChatHistory("agent-1", [{
      role: "assistant",
      content: "Cached answer",
      renderId: "assistant-render-1",
      clientTurnId: "client-turn-1",
      eventId: "event-1",
      messageId: "message-1",
      turnId: "turn-1",
      runId: "run-1",
      sessionKey: "agent:default:main",
      revision: 3,
      status: "interrupted",
    }]);

    expect(readCachedOpenClawChatHistory("agent-1")).toEqual([
      expect.objectContaining({
        content: "Cached answer",
        renderId: "assistant-render-1",
        clientTurnId: "client-turn-1",
        eventId: "event-1",
        messageId: "message-1",
        turnId: "turn-1",
        runId: "run-1",
        sessionKey: "agent:default:main",
        revision: 3,
        status: "interrupted",
      }),
    ]);
  });

  it("assigns a safe render identity when reading a legacy cached message", () => {
    writeCachedOpenClawChatHistory("agent-1", [{ role: "user", content: "Legacy question" }]);

    expect(readCachedOpenClawChatHistory("agent-1")[0]).toMatchObject({
      role: "user",
      content: "Legacy question",
      renderId: expect.any(String),
    });
  });
});
