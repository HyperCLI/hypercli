import { describe, expect, it } from "vitest";

import {
  buildTelegramAgentAllowlistPrompt,
  shouldHideTelegramAgentConfigMessage,
  TELEGRAM_AGENT_ALLOWLIST_DISPLAY_PROMPT,
} from "./telegram-config-workspace";

describe("telegram-config-workspace", () => {
  it("builds a non-secret allowlist prompt that preserves the stored bot token", () => {
    const prompt = buildTelegramAgentAllowlistPrompt(["489595440", "bad-id", "12345"], true);

    expect(prompt).toContain("Update Telegram allowlist settings in this workspace config.");
    expect(prompt).toContain("Preserve the existing channels.telegram.botToken exactly as-is.");
    expect(prompt).toMatch(/do not ask for, print, replace, or expose the Telegram bot token/i);
    expect(prompt).toContain("channels.telegram.allowFrom = [\"489595440\",\"12345\"]");
    expect(prompt).toContain("channels.telegram.groups[\"*\"].requireMention = true");
    expect(prompt).not.toMatch(/restart|reload/i);
    expect(prompt).not.toContain("@@hypercli.ui-action");
    expect(prompt).not.toContain("bad-id");
  });

  it("hides Telegram allowlist prompts, chatter, and config tool calls only", () => {
    expect(shouldHideTelegramAgentConfigMessage({
      role: "user",
      content: TELEGRAM_AGENT_ALLOWLIST_DISPLAY_PROMPT,
    })).toBe(true);
    expect(shouldHideTelegramAgentConfigMessage({
      role: "user",
      content: buildTelegramAgentAllowlistPrompt(["489595440"], false),
    })).toBe(true);
    expect(shouldHideTelegramAgentConfigMessage({
      role: "assistant",
      content: "Telegram allowlist updated.",
    })).toBe(true);
    expect(shouldHideTelegramAgentConfigMessage({
      role: "assistant",
      content: "Updated channels.telegram.allowFrom without changing the bot token 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ.",
    })).toBe(true);
    expect(shouldHideTelegramAgentConfigMessage({
      role: "assistant",
      content: "Done.",
      toolCalls: [{ name: "edit", args: "/home/node/.openclaw/openclaw.json", result: "changed channels.telegram.dmPolicy and allowFrom" }],
    })).toBe(true);

    expect(shouldHideTelegramAgentConfigMessage({
      role: "user",
      content: "Can you summarize the Telegram message I pasted?",
    })).toBe(false);
    expect(shouldHideTelegramAgentConfigMessage({
      role: "assistant",
      content: "I can help draft a Telegram announcement.",
    })).toBe(false);
  });
});
