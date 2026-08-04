import { describe, expect, it, vi } from "vitest";

import {
  applyOpenClawSessionTitleMap,
  createOpenClawSession,
  displayOpenClawSessionName,
  isEphemeralOpenClawSessionName,
  isOpenClawHeartbeatSessionKey,
  isOpenClawMainSessionKey,
  isOpenClawSubagentSession,
  isOpenClawSubagentSessionKey,
  isRecoverableOpenClawMainSession,
  listOpenClawSessions,
  normalizeOpenClawSessions,
  normalizeOpenClawThinkingLevels,
  openClawEventMatchesSession,
  resolveOpenClawResumeSessionKey,
  sameOpenClawSelectableSessionKey,
  streamOpenClawChat,
} from "./openclaw-session-sdk-surface";

describe("openclaw-session-sdk-surface", () => {
  it("captures a raw gateway history baseline for established conversations", () => {
    const stream = (async function* () {})();
    const chatSend = vi.fn(() => stream);

    expect(streamOpenClawChat({ chatSend } as any, "hello", "main", undefined, true)).toBe(stream);
    expect(chatSend).toHaveBeenCalledWith("hello", "main", undefined, { captureHistoryBaseline: true });
  });

  it("keeps a durable backend label ahead of legacy and local session titles", () => {
    const sessions = normalizeOpenClawSessions([{
      key: "agent:default:session-alpha",
      label: "Durable title",
      title: "Legacy title",
      name: "Legacy name",
    }]);

    expect(sessions[0]).toEqual(expect.objectContaining({
      title: "Durable title",
      clientDisplayName: "Durable title",
    }));
    expect(applyOpenClawSessionTitleMap(sessions, {
      "agent:default:session-alpha": "Stale local title",
      "session-alpha": "Stale local title",
    })[0]).toEqual(expect.objectContaining({
      title: "Durable title",
      clientDisplayName: "Durable title",
    }));
  });

  it("keeps a native dashboard display name ahead of a provisional local title", () => {
    const sessions = normalizeOpenClawSessions([{
      key: "agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab",
      displayName: "Weather Planning",
    }]);

    expect(sessions[0]).toEqual(expect.objectContaining({
      title: "Weather Planning",
      clientDisplayName: "Weather Planning",
    }));
    expect(applyOpenClawSessionTitleMap(sessions, {
      "dashboard:019789ab-cdef-4abc-8def-0123456789ab": "New Session",
    })[0]).toEqual(expect.objectContaining({
      title: "Weather Planning",
      clientDisplayName: "Weather Planning",
    }));
    expect(applyOpenClawSessionTitleMap(sessions, {
      "dashboard:019789ab-cdef-4abc-8def-0123456789ab": "My Weather Notes",
    })[0]).toEqual(expect.objectContaining({
      title: "My Weather Notes",
      clientDisplayName: "My Weather Notes",
    }));
  });

  it("creates dashboard sessions through the native sessions.create RPC", async () => {
    const sessionsSubscribe = vi.fn(async () => true);
    const sessionsReset = vi.fn(async (key: string) => key);
    const sessionsCreate = vi.fn(async () => ({
      ok: true as const,
      key: "agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab",
    }));

    await expect(createOpenClawSession({ sessionsCreate, sessionsSubscribe, sessionsReset }, "dashboard:019789ab-cdef-4abc-8def-0123456789ab"))
      .resolves.toBe("agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab");
    expect(sessionsSubscribe).toHaveBeenCalledOnce();
    expect(sessionsSubscribe.mock.invocationCallOrder[0]).toBeLessThan(sessionsCreate.mock.invocationCallOrder[0] ?? 0);
    expect(sessionsCreate).toHaveBeenCalledWith({
      key: "dashboard:019789ab-cdef-4abc-8def-0123456789ab",
    });
    expect(sessionsReset).not.toHaveBeenCalled();
  });

  it("resets the requested dashboard session when native creation reports main", async () => {
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    const sessionsSubscribe = vi.fn(async () => true);
    const sessionsCreate = vi.fn(async () => ({ ok: true as const, key: "agent:default:main" }));
    const sessionsReset = vi.fn(async (key: string) => `agent:default:${key}`);

    await expect(createOpenClawSession({ sessionsCreate, sessionsSubscribe, sessionsReset }, sessionKey))
      .resolves.toBe(`agent:default:${sessionKey}`);
    expect(sessionsReset).toHaveBeenCalledWith(sessionKey, "new");
  });

  it("rejects a reset that does not preserve the requested dashboard session", async () => {
    const sessionKey = "dashboard:019789ab-cdef-4abc-8def-0123456789ab";
    const sessionsSubscribe = vi.fn(async () => true);
    const sessionsCreate = vi.fn(async () => ({ ok: true as const, key: "main" }));
    const sessionsReset = vi.fn(async () => "agent:default:main");

    await expect(createOpenClawSession({ sessionsCreate, sessionsSubscribe, sessionsReset }, sessionKey))
      .rejects.toThrow(`expected session ${sessionKey}`);
  });

  it("falls back to deterministic dashboard sessions on older gateways", async () => {
    const sessionsSubscribe = vi.fn(async () => {
      throw new Error("unknown method: sessions.subscribe");
    });
    const sessionsCreate = vi.fn();
    const sessionsReset = vi.fn(async (key: string) => `agent:default:${key}`);

    await expect(createOpenClawSession({ sessionsCreate, sessionsSubscribe, sessionsReset } as any, "dashboard:019789ab-cdef-4abc-8def-0123456789ab"))
      .resolves.toBe("agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab");
    expect(sessionsCreate).not.toHaveBeenCalled();
    expect(sessionsReset).toHaveBeenCalledWith("dashboard:019789ab-cdef-4abc-8def-0123456789ab", "new");
  });

  it("preserves gateway thinking-level IDs verbatim", () => {
    expect(normalizeOpenClawThinkingLevels([
      { id: "extra-high", label: "Extra high" },
      "AUTO",
    ])).toEqual([
      { id: "extra-high", label: "Extra high" },
      { id: "AUTO", label: "AUTO" },
    ]);
  });

  it("retains session defaults when the gateway has not created a main row", async () => {
    const sessions = await listOpenClawSessions({
      sessionsList: async () => [],
      sessionsListResult: async () => ({
        sessions: [],
        defaults: {
          modelProvider: "openai",
          model: "gpt-5-mini",
          thinkingLevels: [{ id: "low", label: "Fast" }],
          thinkingDefault: "low",
        },
      }),
    });

    expect(sessions).toEqual([
      expect.objectContaining({
        key: "main",
        model: "openai/gpt-5-mini",
        thinkingLevels: [{ id: "low", label: "Fast" }],
        thinkingDefault: "low",
      }),
    ]);
  });

  it("applies gateway variant defaults to selectable session rows", async () => {
    const sessions = await listOpenClawSessions({
      sessionsList: async () => [],
      sessionsListResult: async () => ({
        defaults: {
          modelProvider: "hypercli",
          model: "kimi-k2.6-anthropic",
          thinkingLevels: ["off", "minimal", "low", "medium", "high"],
          thinkingDefault: "medium",
        },
        sessions: [{
          key: "agent:default:dashboard:test-session",
          thinkingLevel: "low",
        }],
      }),
    });

    expect(sessions.find((session) => session.key === "agent:default:dashboard:test-session"))
      .toEqual(expect.objectContaining({
        model: "hypercli/kimi-k2.6-anthropic",
        thinkingLevel: "low",
        thinkingLevels: [
          { id: "off", label: "off" },
          { id: "minimal", label: "minimal" },
          { id: "low", label: "low" },
          { id: "medium", label: "medium" },
          { id: "high", label: "high" },
        ],
        thinkingDefault: "medium",
      }));
  });

  it("normalizes channel-backed default sessions to a distinct channel session key", () => {
    const sessions = normalizeOpenClawSessions({
      "agent:default:main": {
        origin: { provider: "telegram", from: "telegram:489595440" },
        deliveryContext: { channel: "telegram", to: "telegram:489595440" },
        updatedAt: 1773895319635,
      },
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual(expect.objectContaining({
      key: "telegram:489595440",
      gatewaySessionKey: "agent:default:main",
      sourceSessionKey: "telegram:489595440",
      sourceChannelId: "telegram",
      readOnly: true,
      readOnlyReason: "Telegram conversations are read-only here. Reply from Telegram.",
      raw: expect.objectContaining({
        origin: { provider: "telegram", from: "telegram:489595440" },
      }),
    }));
  });

  it("keeps main and object-shaped Telegram sessions distinct", () => {
    const telegramSession = {
      key: "agent:default:main",
      title: "Telegram DM",
      origin: { provider: "telegram", from: { id: 489595440 } },
      deliveryContext: { channel: "telegram", chat: { id: 489595440 } },
      updatedAt: 1773895319635,
    };
    const sessions = normalizeOpenClawSessions([
      { key: "main", title: "Main" },
      telegramSession,
    ]);

    expect(sessions).toEqual([
      expect.objectContaining({ key: "main", title: "Main" }),
      expect.objectContaining({
        key: "telegram:489595440",
        gatewaySessionKey: "agent:default:main",
        sourceSessionKey: "telegram:489595440",
        sourceChannelId: "telegram",
        readOnly: true,
        title: "Telegram DM",
      }),
    ]);
    expect(openClawEventMatchesSession(telegramSession, "main")).toBe(false);
    expect(openClawEventMatchesSession(telegramSession, "telegram:489595440")).toBe(true);
  });

  it("canonicalizes non-channel scoped main sessions while preserving gateway routing", () => {
    const sessions = normalizeOpenClawSessions([{
      key: "agent:default:main",
      displayName: "Hyper Agent Web (Chrome on Windows, localhost)",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      lastMessageAt: 20,
    }]);

    expect(sessions).toEqual([
      expect.objectContaining({
        key: "main",
        gatewaySessionKey: "agent:default:main",
        clientDisplayName: "Main Session",
        sourceChannelId: "webchat",
      }),
    ]);
  });

  it("classifies internal sessions while preserving recoverable legacy main history", () => {
    const [legacyMain] = normalizeOpenClawSessions([{
      key: "agent:default:main",
      updatedAt: 20,
    }]);
    const [emptyMain] = normalizeOpenClawSessions([{ key: "main" }]);

    expect(isOpenClawMainSessionKey("agent:default:main")).toBe(true);
    expect(isOpenClawHeartbeatSessionKey("agent:default:heartbeat")).toBe(true);
    expect(isOpenClawHeartbeatSessionKey("heartbeat-planning")).toBe(false);
    expect(isRecoverableOpenClawMainSession(legacyMain!)).toBe(true);
    expect(displayOpenClawSessionName(legacyMain!)).toBe("Previous conversation");
    expect(isRecoverableOpenClawMainSession(emptyMain!)).toBe(false);
  });

  it("resumes the most recently active writable user conversation while ignoring internal main", () => {
    const sessions = normalizeOpenClawSessions([
      {
        key: "agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab",
        displayName: "Older dashboard conversation",
        updatedAt: 10,
      },
      {
        key: "agent:default:main",
        origin: { provider: "webchat", surface: "webchat" },
        deliveryContext: { channel: "webchat" },
        updatedAt: 20,
      },
      {
        key: "agent:default:main",
        origin: { provider: "telegram", from: "telegram:489595440" },
        deliveryContext: { channel: "telegram", to: "telegram:489595440" },
        updatedAt: 30,
      },
    ]);

    expect(resolveOpenClawResumeSessionKey(sessions)).toBe(
      "agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab",
    );
  });

  it("does not resume main, archived, private, read-only, or subagent sessions", () => {
    const sessions = normalizeOpenClawSessions([
      { key: "agent:default:heartbeat", updatedAt: 60 },
      { key: "main", updatedAt: 50 },
      { key: "dashboard:archived", updatedAt: 40, archived: true },
      { key: "session-hypercli-ephemeral-019789ab-cdef-4abc-8def-0123456789ab", updatedAt: 30 },
      {
        key: "agent:default:main",
        origin: { provider: "telegram", from: "telegram:489595440" },
        deliveryContext: { channel: "telegram", to: "telegram:489595440" },
        updatedAt: 20,
      },
      { key: "agent:default:subagent:worker", updatedAt: 10 },
    ]);

    expect(resolveOpenClawResumeSessionKey(sessions)).toBeNull();
  });

  it("normalizes the selected model and gateway-provided thinking levels", () => {
    const sessions = normalizeOpenClawSessions([{
      key: "session-alpha",
      modelProvider: "openai",
      model: "gpt-5.2",
      thinkingLevel: "minimal",
      thinkingLevels: [
        "off",
        { id: "minimal", label: "Fast" },
      ],
      thinkingDefault: "off",
    }]);

    expect(sessions[0]).toEqual(expect.objectContaining({
      key: "session-alpha",
      model: "openai/gpt-5.2",
      modelProvider: "openai",
      thinkingLevel: "minimal",
      thinkingLevels: [
        { id: "off", label: "off" },
        { id: "minimal", label: "Fast" },
      ],
      thinkingDefault: "off",
    }));
  });

  it("does not treat default main and selectable channel/default rows as the same session", () => {
    expect(sameOpenClawSelectableSessionKey("main", "agent:default:main")).toBe(false);
    expect(sameOpenClawSelectableSessionKey("session-alpha", "agent:default:session-alpha")).toBe(true);
    expect(sameOpenClawSelectableSessionKey("main", "telegram:489595440")).toBe(false);
  });

  it("falls back from generated browser client labels for UUIDv7 sessions", () => {
    const sessions = normalizeOpenClawSessions([{
      key: "agent:default:session-019789ab-cdef-7abc-8def-0123456789ab",
      displayName: "Hyper Agent Web (Chrome on Windows, localhost)",
      kind: "direct",
      chatType: "direct",
      origin: { provider: "webchat", surface: "webchat" },
      deliveryContext: { channel: "webchat" },
      lastChannel: "webchat",
    }]);

    expect(sessions).toEqual([
      expect.objectContaining({
        key: "agent:default:session-019789ab-cdef-7abc-8def-0123456789ab",
        clientDisplayName: "New Session",
      }),
    ]);
  });

  it("shows unnamed native dashboard sessions as new sessions", () => {
    const sessions = normalizeOpenClawSessions([{
      key: "agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab",
    }]);

    expect(sessions).toEqual([
      expect.objectContaining({
        key: "agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab",
        title: "",
        clientDisplayName: "New Session",
      }),
    ]);
  });

  it.each([
    '{"title":"Weather Planning"}',
    "Here's a concise title: Weather Planning",
    "sk_live_1234567890abcdef",
  ])("rejects malformed or sensitive native dashboard titles: %s", (displayName) => {
    const sessions = normalizeOpenClawSessions([{
      key: "agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab",
      displayName,
    }]);

    expect(sessions).toEqual([
      expect.objectContaining({ title: "", clientDisplayName: "New Session" }),
    ]);
  });

  it("recognizes reserved HyperCLI ephemeral session keys", () => {
    expect(isEphemeralOpenClawSessionName("session-hypercli-ephemeral-019789ab-cdef-7abc-8def-0123456789ab")).toBe(true);
    expect(isEphemeralOpenClawSessionName("agent:default:session-hypercli-ephemeral-019789ab-cdef-7abc-8def-0123456789ab")).toBe(true);
    expect(isEphemeralOpenClawSessionName("session-019789ab-cdef-7abc-8def-0123456789ab")).toBe(false);
  });

  it("classifies OpenClaw subagent sessions by key or spawning metadata", () => {
    const sessions = normalizeOpenClawSessions([
      { key: "agent:main:subagent:research", label: "Research task" },
      { key: "agent:copilot:acp:opaque-child", spawned_by: "agent:main:main", label: "ACP task" },
      { key: "session-dashboard", parentSessionKey: "main", label: "Dashboard session" },
    ]);

    expect(isOpenClawSubagentSessionKey("agent:main:subagent:research")).toBe(true);
    expect(sessions[1]).toEqual(expect.objectContaining({ spawnedBy: "agent:main:main" }));
    expect(sessions.map(isOpenClawSubagentSession)).toEqual([true, true, false]);
  });

  it("keeps explicit non-default channel session keys", () => {
    const sessions = normalizeOpenClawSessions([{ key: "session-telegram", origin: { provider: "telegram", from: "telegram:489595440" } }]);

    expect(sessions).toEqual([
      expect.objectContaining({
        key: "session-telegram",
        gatewaySessionKey: "session-telegram",
        sourceSessionKey: "telegram:489595440",
        sourceChannelId: "telegram",
      }),
    ]);
  });

  it("preserves stored gateway keys for channel-backed selectable sessions", () => {
    const sessions = normalizeOpenClawSessions([{ key: "telegram:489595440", gatewaySessionKey: "agent:default:main", sourceSessionKey: "telegram:489595440", sourceChannelId: "telegram" }]);

    expect(sessions).toEqual([
      expect.objectContaining({
        key: "telegram:489595440",
        gatewaySessionKey: "agent:default:main",
        sourceSessionKey: "telegram:489595440",
        readOnly: true,
      }),
    ]);
  });

  it("matches live channel events against their derived channel session key", () => {
    const payload = {
      sessionKey: "agent:default:main",
      origin: { provider: "telegram", from: "telegram:489595440" },
      deliveryContext: { channel: "telegram" },
    };

    expect(openClawEventMatchesSession(payload, "main")).toBe(false);
    expect(openClawEventMatchesSession(payload, "telegram:489595440")).toBe(true);
  });

  it("fails closed when a live event has no session identity", () => {
    expect(openClawEventMatchesSession({ text: "Uncorrelated" }, "main")).toBe(false);
    expect(openClawEventMatchesSession(null, "main")).toBe(false);
  });
});
