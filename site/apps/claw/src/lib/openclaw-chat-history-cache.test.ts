import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearCachedOpenClawChatHistory,
  openClawChatHistoryCacheKey,
  readCachedOpenClawChatHistory,
  writeCachedOpenClawChatHistory,
} from "./openclaw-chat-history-cache";

const DECLARED_CACHE_BUDGET_CHARS = 900_000;

function cachedHistoryKeys(agentId: string): string[] {
  return Object.keys(window.localStorage).filter((key) => key.includes(`:${encodeURIComponent(agentId)}`));
}

function requireCacheKey(agentId: string, sessionKey?: string): string {
  const key = openClawChatHistoryCacheKey(agentId, sessionKey);
  if (!key) throw new Error("expected a cache key for this target");
  return key;
}

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

  it("bounds the serialized payload when messages carry oversized inline media", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const oversizedInlineAudio = `data:audio/mpeg;base64,${"A".repeat(1_200_000)}`;
    try {
      writeCachedOpenClawChatHistory("agent-media", [
        { role: "user", content: "What did I say?" },
        { role: "assistant", content: "Transcript answer", mediaUrls: [oversizedInlineAudio] },
        { role: "assistant", content: "Second answer", mediaUrls: [oversizedInlineAudio] },
      ]);

      const write = setItemSpy.mock.calls.find(([key]) => typeof key === "string" && key.includes("agent-media"));
      expect(write).toBeTruthy();
      const serialized = typeof write?.[1] === "string" ? write[1] : "";
      expect(serialized.length).toBeLessThanOrEqual(DECLARED_CACHE_BUDGET_CHARS);

      // The conversation text must survive even when the inline media payloads
      // cannot fit the local-history budget.
      expect(readCachedOpenClawChatHistory("agent-media").map((message) => message.content)).toEqual([
        "What did I say?",
        "Transcript answer",
        "Second answer",
      ]);
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("drops oversized inline media from the cache but keeps short remote URLs", () => {
    const oversizedInlineAudio = `data:audio/webm;base64,${"B".repeat(1_200_000)}`;
    writeCachedOpenClawChatHistory("agent-media-mixed", [
      {
        role: "assistant",
        content: "Two replies attached",
        mediaUrls: [oversizedInlineAudio, "https://cdn.example.com/reply.mp3"],
      },
    ]);

    const restored = readCachedOpenClawChatHistory("agent-media-mixed");
    expect(restored).toHaveLength(1);
    expect(restored[0]?.content).toBe("Two replies attached");
    expect(restored[0]?.mediaUrls).toEqual(["https://cdn.example.com/reply.mp3"]);
  });

  it("survives a corrupt cached payload", () => {
    const key = requireCacheKey("agent-corrupt");
    window.localStorage.setItem(key, "{not-json");
    window.localStorage.setItem(`${key}:session:${encodeURIComponent("dashboard:local-dirty")}`, "[]");

    expect(readCachedOpenClawChatHistory("agent-corrupt")).toEqual([]);
    expect(readCachedOpenClawChatHistory("agent-corrupt", "dashboard:local-dirty")).toEqual([]);
  });

  it("ignores payloads written by a previous cache version", () => {
    const key = requireCacheKey("agent-version");
    window.localStorage.setItem(key, JSON.stringify({
      version: 0,
      updatedAt: Date.now(),
      messages: [{ role: "user", content: "stale" }],
    }));

    expect(readCachedOpenClawChatHistory("agent-version")).toEqual([]);
  });

  it("scopes entries by session and never stores ephemeral private chats", () => {
    expect(openClawChatHistoryCacheKey("agent-scope", "session-hypercli-ephemeral-1234abcd")).toBeNull();
    expect(openClawChatHistoryCacheKey("agent-scope", "agent:default:session-hypercli-ephemeral-1234abcd")).toBeNull();

    writeCachedOpenClawChatHistory("agent-scope", [{ role: "user", content: "main thread" }]);
    writeCachedOpenClawChatHistory("agent-scope", [{ role: "user", content: "side thread" }], "dashboard:local-1");
    writeCachedOpenClawChatHistory("agent-scope", [{ role: "user", content: "private thread" }], "session-hypercli-ephemeral-1234abcd");
    writeCachedOpenClawChatHistory("agent-other", [{ role: "user", content: "other agent" }]);

    expect(readCachedOpenClawChatHistory("agent-scope").map((message) => message.content)).toEqual(["main thread"]);
    expect(readCachedOpenClawChatHistory("agent-scope", "dashboard:local-1").map((message) => message.content)).toEqual(["side thread"]);
    expect(readCachedOpenClawChatHistory("agent-scope", "session-hypercli-ephemeral-1234abcd")).toEqual([]);
    expect(readCachedOpenClawChatHistory("agent-other").map((message) => message.content)).toEqual(["other agent"]);

    clearCachedOpenClawChatHistory("agent-scope", "dashboard:local-1");
    expect(readCachedOpenClawChatHistory("agent-scope", "dashboard:local-1")).toEqual([]);
    expect(cachedHistoryKeys("agent-scope")).toHaveLength(1);
  });

  it("keeps non-generated scoped session keys isolated", () => {
    const alphaSession = "agent:alpha:support-thread";
    const betaSession = "agent:beta:support-thread";

    expect(openClawChatHistoryCacheKey("agent-scoped", alphaSession)).not.toBe(
      openClawChatHistoryCacheKey("agent-scoped", betaSession),
    );
    writeCachedOpenClawChatHistory("agent-scoped", [
      { role: "assistant", content: "Alpha transcript" },
    ], alphaSession);

    expect(readCachedOpenClawChatHistory("agent-scoped", alphaSession)).toEqual([
      expect.objectContaining({ content: "Alpha transcript" }),
    ]);
    expect(readCachedOpenClawChatHistory("agent-scoped", betaSession)).toEqual([]);
  });

  it("shares generated-session history across scoped and route-safe aliases", () => {
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    const scopedSessionKey = `agent:default:${sessionKey}`;

    expect(openClawChatHistoryCacheKey("agent-alias", scopedSessionKey)).toBe(
      openClawChatHistoryCacheKey("agent-alias", sessionKey),
    );
    writeCachedOpenClawChatHistory("agent-alias", [
      { role: "assistant", content: "Shared transcript" },
    ], scopedSessionKey);

    expect(readCachedOpenClawChatHistory("agent-alias", sessionKey)).toEqual([
      expect.objectContaining({ role: "assistant", content: "Shared transcript" }),
    ]);
    clearCachedOpenClawChatHistory("agent-alias", sessionKey);
    expect(readCachedOpenClawChatHistory("agent-alias", scopedSessionKey)).toEqual([]);
  });

  it("migrates an existing scoped generated-session cache entry", () => {
    const sessionKey = "dashboard:11111111-2222-4333-8444-555555555555";
    const scopedSessionKey = `agent:default:${sessionKey}`;
    const legacyKey = [
      "hypercli:openclaw-chat-history:v1",
      encodeURIComponent("agent-legacy-alias"),
      "session",
      encodeURIComponent(scopedSessionKey),
    ].join(":");
    window.localStorage.setItem(legacyKey, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      messages: [{ role: "assistant", content: "Legacy scoped transcript" }],
    }));

    expect(readCachedOpenClawChatHistory("agent-legacy-alias", sessionKey)).toEqual([
      expect.objectContaining({ role: "assistant", content: "Legacy scoped transcript" }),
    ]);
    expect(window.localStorage.getItem(legacyKey)).toBeNull();
    expect(window.localStorage.getItem(requireCacheKey("agent-legacy-alias", sessionKey))).not.toBeNull();
  });

  it("skips a malformed stored key while finding a valid generated-session alias", () => {
    const agentId = "agent-malformed-alias";
    const sessionKey = "dashboard:99999999-8888-4777-8666-555555555555";
    const malformedKey = [
      "hypercli:openclaw-chat-history:v1",
      encodeURIComponent(agentId),
      "session",
      "%E0%A4%A",
    ].join(":");
    const legacyKey = [
      "hypercli:openclaw-chat-history:v1",
      encodeURIComponent(agentId),
      "session",
      encodeURIComponent(`agent:default:${sessionKey}`),
    ].join(":");
    window.localStorage.setItem(malformedKey, "malformed-key-sentinel");
    window.localStorage.setItem(legacyKey, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      messages: [{ role: "assistant", content: "Valid transcript after malformed key" }],
    }));

    expect(readCachedOpenClawChatHistory(agentId, sessionKey)).toEqual([
      expect.objectContaining({ content: "Valid transcript after malformed key" }),
    ]);
    expect(window.localStorage.getItem(malformedKey)).toBe("malformed-key-sentinel");
  });

  it("clears the canonical entry and its legacy scoped generated-session alias", () => {
    const agentId = "agent-clear-aliases";
    const sessionKey = "dashboard:abcdefab-cdef-4abc-8def-abcdefabcdef";
    const payload = JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      messages: [{ role: "assistant", content: "Transcript to clear" }],
    });
    const keys = [
      requireCacheKey(agentId, sessionKey),
      requireCacheKey(agentId, sessionKey).replace(
        encodeURIComponent(sessionKey),
        encodeURIComponent(`agent:default:${sessionKey}`),
      ),
    ];
    for (const key of keys) window.localStorage.setItem(key, payload);

    clearCachedOpenClawChatHistory(agentId, sessionKey);

    for (const key of keys) expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("still reads a scoped alias when migration storage is unavailable", () => {
    const sessionKey = "dashboard:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const scopedSessionKey = `agent:default:${sessionKey}`;
    const legacyKey = [
      "hypercli:openclaw-chat-history:v1",
      encodeURIComponent("agent-read-only-alias"),
      "session",
      encodeURIComponent(scopedSessionKey),
    ].join(":");
    window.localStorage.setItem(legacyKey, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      messages: [{ role: "assistant", content: "Read-only legacy transcript" }],
    }));
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });

    try {
      expect(readCachedOpenClawChatHistory("agent-read-only-alias", sessionKey)).toEqual([
        expect.objectContaining({ role: "assistant", content: "Read-only legacy transcript" }),
      ]);
    } finally {
      setItemSpy.mockRestore();
    }
    expect(window.localStorage.getItem(legacyKey)).not.toBeNull();
  });

  it("prefers the newest valid generated-session cache entry during migration", () => {
    const sessionKey = "dashboard:12345678-1234-4234-8234-123456789abc";
    const scopedSessionKey = `agent:default:${sessionKey}`;
    const canonicalKey = requireCacheKey("agent-newest-alias", sessionKey);
    const legacyKey = [
      "hypercli:openclaw-chat-history:v1",
      encodeURIComponent("agent-newest-alias"),
      "session",
      encodeURIComponent(scopedSessionKey),
    ].join(":");
    window.localStorage.setItem(canonicalKey, JSON.stringify({
      version: 1,
      updatedAt: 1,
      messages: [],
    }));
    window.localStorage.setItem(legacyKey, JSON.stringify({
      version: 1,
      updatedAt: 2,
      messages: [{ role: "assistant", content: "Newest valid transcript" }],
    }));

    expect(readCachedOpenClawChatHistory("agent-newest-alias", sessionKey)).toEqual([
      expect.objectContaining({ role: "assistant", content: "Newest valid transcript" }),
    ]);
    expect(window.localStorage.getItem(legacyKey)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(canonicalKey) ?? "{}").messages).toEqual([
      { role: "assistant", content: "Newest valid transcript" },
    ]);
  });

  it("never throws when the browser refuses the write (quota or private mode)", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    try {
      expect(() => writeCachedOpenClawChatHistory("agent-quota", [
        { role: "user", content: "still fine" },
      ])).not.toThrow();
    } finally {
      setItemSpy.mockRestore();
    }
    expect(readCachedOpenClawChatHistory("agent-quota")).toEqual([]);
  });

  it("re-bounds oversized legacy payloads on read instead of replaying them raw", () => {
    const key = requireCacheKey("agent-legacy-huge");
    window.localStorage.setItem(key, JSON.stringify({
      version: 1,
      updatedAt: Date.now(),
      messages: [{ role: "assistant", content: "x".repeat(2_000_000) }],
    }));

    const restored = readCachedOpenClawChatHistory("agent-legacy-huge");
    expect(restored).toHaveLength(1);
    expect(restored[0]?.content.length ?? 0).toBeLessThanOrEqual(60_000);
  });
});
