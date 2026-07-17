import { describe, expect, it } from "vitest";

import {
  buildOpenClawDiscordPatch,
  buildOpenClawSlackPatch,
  buildOpenClawTelegramPatch,
  parseOpenClawDiscordConfig,
  parseOpenClawSlackConfig,
  parseOpenClawTelegramConfig,
} from "./openclaw-channel-settings";

describe("OpenClaw configured-channel settings", () => {
  it("hydrates only safe Telegram settings and aggregates mention behavior", () => {
    const parsed = parseOpenClawTelegramConfig({
      enabled: false,
      botToken: "must-not-leave-runtime-config",
      dmPolicy: "allowlist",
      allowFrom: ["123", "456"],
      groupPolicy: "allowlist",
      groupAllowFrom: ["789"],
      groups: {
        "-1001": { requireMention: true, secret: "ignored" },
        "-1002": { requireMention: true },
      },
    });

    expect(parsed).toEqual({
      channelId: "telegram",
      enabled: false,
      dmPolicy: "allowlist",
      allowFrom: ["123", "456"],
      groupPolicy: "allowlist",
      groupAllowFrom: ["789"],
      groupIds: ["-1001", "-1002"],
      existingGroupKeys: ["-1001", "-1002"],
      mentionBehavior: "required",
    });
    expect(JSON.stringify(parsed)).not.toContain("must-not-leave-runtime-config");
    expect(JSON.stringify(parsed)).not.toContain("ignored");
  });

  it("builds explicit Telegram clears and key-level group deletions", () => {
    const current = parseOpenClawTelegramConfig({
      dmPolicy: "allowlist",
      allowFrom: ["123"],
      groupPolicy: "allowlist",
      groupAllowFrom: ["456"],
      groups: {
        "-1001": { requireMention: true },
        "-1002": { requireMention: true },
      },
    });

    expect(buildOpenClawTelegramPatch(current, {
      enabled: true,
      dmPolicy: "runtime-default",
      allowFrom: [],
      groupPolicy: "runtime-default",
      groupAllowFrom: [],
      groupIds: ["-1002", "-1003"],
      mentionBehavior: "runtime-default",
    })).toEqual({
      enabled: true,
      dmPolicy: null,
      allowFrom: null,
      groupPolicy: null,
      groupAllowFrom: null,
      groups: {
        "-1001": null,
        "-1002": { requireMention: null },
        "-1003": { requireMention: null },
      },
    });
  });

  it("keeps Telegram open access explicit", () => {
    const current = parseOpenClawTelegramConfig({});
    expect(buildOpenClawTelegramPatch(current, {
      enabled: true,
      dmPolicy: "open",
      allowFrom: ["123"],
      groupPolicy: "runtime-default",
      groupAllowFrom: [],
      groupIds: [],
      mentionBehavior: "runtime-default",
    })).toMatchObject({
      dmPolicy: "open",
      allowFrom: ["*", "123"],
    });
  });

  it("clears Discord restrictions and deletes every existing guild key", () => {
    const current = parseOpenClawDiscordConfig({
      token: "never-hydrate-this",
      groupPolicy: "allowlist",
      guilds: {
        "100": { users: ["200"] },
        "300": { users: ["400"] },
      },
    });

    expect(current).toEqual({
      channelId: "discord",
      enabled: true,
      guildId: "100",
      userId: "200",
      existingGuildKeys: ["100", "300"],
    });
    expect(buildOpenClawDiscordPatch(current, {
      enabled: true,
      guildId: "100",
      userId: "200",
    })).toEqual({ enabled: true });
    expect(buildOpenClawDiscordPatch(current, {
      enabled: true,
      guildId: "",
      userId: "",
    })).toEqual({
      enabled: true,
      groupPolicy: null,
      guilds: { "100": null, "300": null },
    });
    expect(buildOpenClawDiscordPatch(current, {
      enabled: true,
      guildId: "500",
      userId: "600",
    })).toEqual({
      enabled: true,
      groupPolicy: "allowlist",
      guilds: {
        "100": null,
        "300": null,
        "500": { requireMention: true, users: ["600"] },
      },
    });
  });

  it("preserves mixed Telegram mention rules during an ordinary save", () => {
    const current = parseOpenClawTelegramConfig({
      groups: {
        "-1001": { requireMention: true },
        "-1002": { requireMention: false },
      },
    });

    expect(current.mentionBehavior).toBe("mixed");
    expect(buildOpenClawTelegramPatch(current, {
      enabled: true,
      dmPolicy: "runtime-default",
      allowFrom: [],
      groupPolicy: "runtime-default",
      groupAllowFrom: [],
      groupIds: ["-1001", "-1002"],
      mentionBehavior: "mixed",
    })).not.toHaveProperty("groups");
  });

  it("hydrates safe Slack access settings without exposing credentials or advanced channel fields", () => {
    const parsed = parseOpenClawSlackConfig({
      enabled: true,
      mode: "socket",
      botToken: "old-bot",
      appToken: "old-app",
      dmPolicy: "allowlist",
      allowFrom: ["U0123456789"],
      groupPolicy: "allowlist",
      channels: {
        C0123456789: { enabled: true, requireMention: true, systemPrompt: "private", tools: { allow: ["read"] } },
        C9876543210: { enabled: false, requireMention: false },
      },
    });

    expect(parsed).toEqual({
      channelId: "slack",
      enabled: true,
      mode: "socket",
      enterpriseOrgInstall: false,
      webhookPath: "/slack/events",
      relayUrl: "",
      relayGatewayId: "",
      botTokenConfigured: true,
      appTokenConfigured: true,
      signingSecretConfigured: false,
      relayAuthTokenConfigured: false,
      dmPolicy: "allowlist",
      allowFrom: ["U0123456789"],
      groupPolicy: "allowlist",
      channels: [
        { channelId: "C0123456789", enabled: true, mentionBehavior: "required" },
        { channelId: "C9876543210", enabled: false, mentionBehavior: "not-required" },
      ],
      existingChannelKeys: ["C0123456789", "C9876543210"],
    });
    expect(parsed).not.toHaveProperty("botToken");
    expect(parsed).not.toHaveProperty("appToken");
    expect(JSON.stringify(parsed)).not.toContain("private");
  });

  it("builds minimal Slack access deltas and keeps credential replacements independent", () => {
    const current = parseOpenClawSlackConfig({
      enabled: true,
      mode: "socket",
      channels: {
        C0123456789: { enabled: true, requireMention: true, systemPrompt: "preserve" },
        C9876543210: { enabled: true },
      },
    });
    expect(buildOpenClawSlackPatch(current, {
      enabled: false,
      mode: "socket",
      enterpriseOrgInstall: false,
      webhookPath: "/slack/events",
      relayUrl: "",
      relayGatewayId: "",
      dmPolicy: "open",
      allowFrom: ["U0123456789"],
      groupPolicy: "allowlist",
      channels: [
        { channelId: "C0123456789", enabled: true, mentionBehavior: "not-required" },
        { channelId: "C1111111111", enabled: true, mentionBehavior: "runtime-default" },
      ],
      replacementAppToken: " new-app ",
    })).toEqual({
      enabled: false,
      mode: "socket",
      enterpriseOrgInstall: false,
      dmPolicy: "open",
      allowFrom: ["*", "U0123456789"],
      groupPolicy: "allowlist",
      channels: {
        C0123456789: { requireMention: false },
        C9876543210: null,
        C1111111111: { enabled: true, requireMention: null },
      },
      appToken: "new-app",
    });
  });

  it("removes Slack policy overrides and channel rules explicitly", () => {
    const current = parseOpenClawSlackConfig({ channels: { C0123456789: { requireMention: true } } });
    expect(buildOpenClawSlackPatch(current, {
      enabled: true,
      mode: "socket",
      enterpriseOrgInstall: false,
      webhookPath: "/slack/events",
      relayUrl: "",
      relayGatewayId: "",
      dmPolicy: "runtime-default",
      allowFrom: [],
      groupPolicy: "runtime-default",
      channels: [],
    })).toEqual({
      enabled: true,
      mode: "socket",
      enterpriseOrgInstall: false,
      dmPolicy: null,
      allowFrom: null,
      groupPolicy: null,
      channels: null,
    });
  });

  it("hydrates safe Slack HTTP and Relay transport fields without exposing secrets", () => {
    const parsed = parseOpenClawSlackConfig({
      mode: "relay",
      enterpriseOrgInstall: true,
      botToken: { provider: "env", id: "SLACK_BOT_TOKEN" },
      appToken: { provider: "env", id: "SLACK_APP_TOKEN" },
      signingSecret: { provider: "env", id: "SLACK_SIGNING_SECRET" },
      webhookPath: "hooks/slack",
      relay: {
        url: "wss://relay.example.test/slack",
        gatewayId: "gateway-1",
        authToken: "never-expose-relay-token",
      },
    });

    expect(parsed).toMatchObject({
      mode: "relay",
      enterpriseOrgInstall: true,
      webhookPath: "/hooks/slack",
      relayUrl: "wss://relay.example.test/slack",
      relayGatewayId: "gateway-1",
      botTokenConfigured: true,
      appTokenConfigured: true,
      signingSecretConfigured: true,
      relayAuthTokenConfigured: true,
    });
    expect(JSON.stringify(parsed)).not.toContain("SLACK_BOT_TOKEN");
    expect(JSON.stringify(parsed)).not.toContain("SLACK_APP_TOKEN");
    expect(JSON.stringify(parsed)).not.toContain("SLACK_SIGNING_SECRET");
    expect(JSON.stringify(parsed)).not.toContain("never-expose-relay-token");
  });

  it("builds mode-specific Slack HTTP and Relay patches while preserving dormant credentials", () => {
    const current = parseOpenClawSlackConfig({
      mode: "socket",
      botToken: "stored-bot",
      appToken: "stored-app",
      signingSecret: "stored-signing",
      relay: { url: "wss://old.example.test/ws", gatewayId: "old", authToken: "stored-relay" },
    });
    const common = {
      enabled: true,
      enterpriseOrgInstall: false,
      dmPolicy: "runtime-default" as const,
      allowFrom: [],
      groupPolicy: "runtime-default" as const,
      channels: [],
    };

    expect(buildOpenClawSlackPatch(current, {
      ...common,
      mode: "http",
      webhookPath: "events/slack",
      relayUrl: "wss://relay.example.test/ws",
      relayGatewayId: "gateway-1",
      replacementBotToken: "new-bot",
      replacementSigningSecret: "new-signing",
      replacementAppToken: "must-stay-dormant",
    })).toEqual({
      enabled: true,
      mode: "http",
      enterpriseOrgInstall: false,
      dmPolicy: null,
      allowFrom: null,
      groupPolicy: null,
      botToken: "new-bot",
      webhookPath: "/events/slack",
      signingSecret: "new-signing",
    });

    expect(buildOpenClawSlackPatch(current, {
      ...common,
      mode: "relay",
      enterpriseOrgInstall: true,
      webhookPath: "/slack/events",
      relayUrl: "wss://relay.example.test/ws",
      relayGatewayId: "gateway-1",
      replacementRelayAuthToken: "new-relay",
      replacementSigningSecret: "must-stay-dormant",
    })).toEqual({
      enabled: true,
      mode: "relay",
      enterpriseOrgInstall: false,
      dmPolicy: null,
      allowFrom: null,
      groupPolicy: null,
      relay: {
        url: "wss://relay.example.test/ws",
        gatewayId: "gateway-1",
        authToken: "new-relay",
      },
    });
  });
});
