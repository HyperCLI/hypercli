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

  it("keeps Slack credential replacements independent", () => {
    const parsed = parseOpenClawSlackConfig({ enabled: true, botToken: "old-bot", appToken: "old-app" });
    expect(parsed).toEqual({ channelId: "slack", enabled: true });
    expect(buildOpenClawSlackPatch({ enabled: false, replacementAppToken: " new-app " })).toEqual({
      enabled: false,
      appToken: "new-app",
    });
  });
});
