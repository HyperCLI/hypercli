import { describe, expect, it } from "vitest";

import {
  normalizeOpenClawSessions,
  openClawEventMatchesSession,
  sameOpenClawSelectableSessionKey,
} from "./openclaw-session-sdk-surface";

describe("openclaw-session-sdk-surface", () => {
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

  it("does not treat default main and selectable channel/default rows as the same project", () => {
    expect(sameOpenClawSelectableSessionKey("main", "agent:default:main")).toBe(false);
    expect(sameOpenClawSelectableSessionKey("session-alpha", "agent:default:session-alpha")).toBe(true);
    expect(sameOpenClawSelectableSessionKey("main", "telegram:489595440")).toBe(false);
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
});
