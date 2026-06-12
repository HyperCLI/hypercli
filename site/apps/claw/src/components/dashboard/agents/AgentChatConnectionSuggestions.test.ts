import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import { describe, expect, it } from "vitest";

import { INTEGRATION_BRAND_LOGOS } from "@/components/dashboard/integrations/integration-brand-icons";
import { getConnectCommandSuggestions, getConnectionSuggestions } from "./AgentChatConnectionSuggestions";

function schemaWith(...paths: string[]): OpenClawConfigSchemaResponse {
  return {
    schema: {},
    uiHints: Object.fromEntries(paths.map((path) => [path, {}])),
  };
}

describe("getConnectionSuggestions", () => {
  it("suggests schema-available registry integrations", () => {
    const suggestions = getConnectionSuggestions("please connect telegram", null, schemaWith("channels.telegram"));

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: "telegram",
        displayName: "Telegram",
        directoryPluginId: "telegram",
        connectorId: "telegram",
      }),
    ]);
  });

  it("matches aliases for registry integrations", () => {
    const suggestions = getConnectionSuggestions("connect teams", null, schemaWith("channels.msteams"));

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: "msteams",
        displayName: "Microsoft Teams",
        directoryPluginId: "msteams",
      }),
    ]);
  });

  it("suggests GitHub when the service connector is advertised", () => {
    const suggestions = getConnectionSuggestions("connect github", null, schemaWith("integrations.github"));

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: "github",
        displayName: "GitHub",
        connectorId: "github",
      }),
    ]);
  });

  it("matches the GitHub gh alias when the service connector is advertised", () => {
    const suggestions = getConnectionSuggestions("connect gh", null, schemaWith("integrations.github"));

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: "github",
        displayName: "GitHub",
        connectorId: "github",
      }),
    ]);
  });

  it("does not suggest unavailable integrations", () => {
    const suggestions = getConnectionSuggestions("connect openai", null, schemaWith("channels.telegram"));

    expect(suggestions).toEqual([]);
  });

  it("does not suggest mock-only or coming-soon connection rows", () => {
    const suggestions = getConnectionSuggestions(
      "connect gmail and google calendar",
      null,
      schemaWith("channels.telegram", "plugins.entries.openai"),
    );

    expect(suggestions).toEqual([]);
  });

  it("does not suggest already connected channel integrations", () => {
    const suggestions = getConnectionSuggestions(
      "connect telegram",
      { channels: { telegram: { enabled: true } } },
      schemaWith("channels.telegram"),
    );

    expect(suggestions).toEqual([]);
  });

  it("does not suggest already connected plugin integrations", () => {
    const suggestions = getConnectionSuggestions(
      "connect openai",
      { plugins: { entries: { openai: { enabled: true } } } },
      schemaWith("plugins.entries.openai"),
    );

    expect(suggestions).toEqual([]);
  });

  it("lists available integrations for the connect slash command", () => {
    const suggestions = getConnectCommandSuggestions(
      "",
      null,
      schemaWith("integrations.github", "channels.telegram", "plugins.entries.openai"),
    );

    expect(suggestions.map((suggestion) => suggestion.id)).toEqual(["github", "telegram", "openai"]);
  });

  it("filters connect slash command suggestions by query", () => {
    const suggestions = getConnectCommandSuggestions(
      "tel",
      null,
      schemaWith("channels.telegram", "plugins.entries.openai"),
    );

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: "telegram",
        displayName: "Telegram",
        connectorId: "telegram",
      }),
    ]);
  });

  it("omits already connected integrations from connect slash command suggestions", () => {
    const suggestions = getConnectCommandSuggestions(
      "",
      { channels: { telegram: { enabled: true } } },
      schemaWith("channels.telegram", "plugins.entries.openai"),
    );

    expect(suggestions.map((suggestion) => suggestion.id)).toEqual(["github", "openai"]);
  });

  it("lists GitHub for the connect slash command without a config schema", () => {
    const suggestions = getConnectCommandSuggestions("", null, null);

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: "github",
        displayName: "GitHub",
        connectorId: "github",
      }),
    ]);
  });

  it("matches the GitHub gh alias for the connect slash command", () => {
    const suggestions = getConnectCommandSuggestions("gh", null, null);

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: "github",
        displayName: "GitHub",
        connectorId: "github",
      }),
    ]);
  });

  it("uses shared brand icon metadata", () => {
    const github = getConnectCommandSuggestions("gh", null, null)[0];
    const telegram = getConnectCommandSuggestions("tel", null, schemaWith("channels.telegram"))[0];

    expect(github).toEqual(expect.objectContaining({
      Icon: INTEGRATION_BRAND_LOGOS.github.icon,
      iconColor: INTEGRATION_BRAND_LOGOS.github.color,
    }));
    expect(telegram).toEqual(expect.objectContaining({
      Icon: INTEGRATION_BRAND_LOGOS.telegram.icon,
      iconColor: INTEGRATION_BRAND_LOGOS.telegram.color,
    }));
  });
});
