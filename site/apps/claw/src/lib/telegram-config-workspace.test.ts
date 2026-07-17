import { describe, expect, it } from "vitest";

import {
  buildTelegramAgentAccessPrompt,
  buildTelegramAgentAllowlistPrompt,
  shouldHideTelegramAgentConfigMessage,
  TELEGRAM_AGENT_ACCESS_DISPLAY_PROMPT,
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

  it("builds a non-secret access prompt from explicit user choices", () => {
    const prompt = buildTelegramAgentAccessPrompt({
      dmPolicy: "open",
      allowFrom: ["12345", "bad-id"],
      groupPolicy: "allowlist",
      groupAllowFrom: ["67890", "*", "bad-id"],
      groupIds: ["-1001234567890", "bad-id"],
      mentionChoice: "not-required",
    });

    expect(prompt).toContain("channels.telegram.dmPolicy = \"open\"");
    expect(prompt).toContain("channels.telegram.allowFrom = [\"*\",\"12345\"]");
    expect(prompt).toContain("channels.telegram.groupPolicy = \"allowlist\"");
    expect(prompt).toContain("channels.telegram.groupAllowFrom = [\"67890\",\"*\"]");
    expect(prompt).toContain("\"-1001234567890\":{\"requireMention\":false}");
    expect(prompt).toContain("Preserve the existing channels.telegram.botToken exactly as-is.");
    expect(prompt).not.toContain("bad-id");
    expect(shouldHideTelegramAgentConfigMessage({ role: "user", content: TELEGRAM_AGENT_ACCESS_DISPLAY_PROMPT })).toBe(true);
    expect(shouldHideTelegramAgentConfigMessage({ role: "user", content: prompt })).toBe(true);
  });
});
