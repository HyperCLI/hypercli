import type { AgentChannelSummary } from "@hypercli.com/sdk/channels";
import { describe, expect, it } from "vitest";

import { INTEGRATION_BRAND_LOGOS } from "@/components/dashboard/integrations/integration-brand-icons";
import { detectChatIntegrationIntent, getConnectCommandSuggestions, getConnectionSuggestions } from "./AgentChatConnectionSuggestions";

function channel(channelId: string, configured = false): AgentChannelSummary {
  return {
    channelId,
    configured,
    healthState: "unknown",
  };
}

describe("getConnectionSuggestions", () => {
  it("suggests runtime-reported channels", () => {
    const suggestions = getConnectionSuggestions("please connect telegram", [channel("telegram")]);

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: "telegram",
        displayName: "Telegram",
        directoryPluginId: "telegram",
        connectorId: "telegram",
      }),
    ]);
  });

  it("matches aliases for reported channels", () => {
    const suggestions = getConnectionSuggestions("connect teams", [channel("msteams")]);

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: "msteams",
        displayName: "Microsoft Teams",
      }),
    ]);
  });

  it("keeps core setup channels available without live status", () => {
    expect(getConnectionSuggestions("connect telegram", [channel("discord")])).toEqual([
      expect.objectContaining({ id: "telegram", connectorId: "telegram" }),
    ]);
    expect(getConnectionSuggestions("connect signal", [])).toEqual([]);
    expect(getConnectionSuggestions("connect github", [channel("telegram")])).toEqual([]);
  });

  it("does not suggest configured channels", () => {
    expect(getConnectionSuggestions("connect telegram", [channel("telegram", true)])).toEqual([]);
  });

  it("treats any configured account as an existing channel connection", () => {
    const channels = [channel("telegram"), { ...channel("telegram", true), accountId: "work" }];
    expect(getConnectionSuggestions("connect telegram", channels)).toEqual([]);
  });

  it("supports runtime-reported channels without curated metadata", () => {
    const suggestions = getConnectionSuggestions("connect custom relay", [channel("custom-relay")]);

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: "custom-relay",
        displayName: "Custom Relay",
        directoryPluginId: "custom-relay",
      }),
    ]);
  });

  it("lists core setup channels and unconfigured runtime channels for the connect command", () => {
    const suggestions = getConnectCommandSuggestions("", [
      channel("telegram"),
      channel("discord"),
      channel("msteams", true),
    ]);

    expect(suggestions.map((suggestion) => suggestion.id)).toEqual(["telegram", "discord", "slack", "whatsapp"]);
    expect(suggestions.map((suggestion) => suggestion.connectorId)).toEqual(["telegram", "discord", "slack", "whatsapp"]);
  });

  it("filters connect command suggestions by query", () => {
    const suggestions = getConnectCommandSuggestions("tel", [channel("telegram"), channel("discord")]);

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: "telegram",
        displayName: "Telegram",
        connectorId: "telegram",
      }),
    ]);
  });

  it("lists core setup channels without runtime status", () => {
    expect(getConnectCommandSuggestions("", []).map((suggestion) => suggestion.id)).toEqual([
      "telegram",
      "discord",
      "slack",
      "whatsapp",
    ]);
    expect(getConnectCommandSuggestions("gh", [])).toEqual([]);
  });

  it("uses shared brand icon metadata", () => {
    const telegram = getConnectCommandSuggestions("tel", [channel("telegram")])[0];

    expect(telegram).toEqual(expect.objectContaining({
      Icon: INTEGRATION_BRAND_LOGOS.telegram.icon,
      iconColor: INTEGRATION_BRAND_LOGOS.telegram.color,
    }));
  });

  it("does not suggest setup while merely discussing a channel", () => {
    expect(getConnectionSuggestions("write a Slack announcement", [channel("slack")])).toEqual([]);
    expect(getConnectionSuggestions("summarize this Telegram conversation", [channel("telegram")])).toEqual([]);
  });
});

describe("detectChatIntegrationIntent", () => {
  it.each([
    ["connect Telegram", "telegram"],
    ["please set up Slack", "slack"],
    ["add a Discord integration", "discord"],
    ["configure my WhatsApp channel", "whatsapp"],
    ["how do I connect GitHub?", "github"],
  ] as const)("detects %s", (input, integrationId) => {
    expect(detectChatIntegrationIntent(input)).toEqual({ kind: "connector", integrationId });
  });

  it.each([
    "connect a channel",
    "make integrations for messaging",
    "connect Telegram and Slack",
    "connect Signal",
  ])("routes %s to the integrations directory", (input) => {
    expect(detectChatIntegrationIntent(input)).toEqual({ kind: "directory" });
  });

  it.each([
    "summarize this Telegram conversation",
    "write a Slack announcement",
    "compare Discord and Telegram",
    "what is a Discord integration?",
    "is Slack connected?",
    "do not connect Telegram",
    "I don't want to set up Slack",
    "disconnect Telegram",
  ])("ignores non-setup intent: %s", (input) => {
    expect(detectChatIntegrationIntent(input)).toBeNull();
  });

  it("recognizes unsupported runtime channels and routes them to the directory", () => {
    expect(detectChatIntegrationIntent("connect custom relay", [channel("custom-relay")])).toEqual({ kind: "directory" });
  });
});
