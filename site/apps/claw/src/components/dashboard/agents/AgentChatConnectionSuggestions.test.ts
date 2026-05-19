import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";
import { describe, expect, it } from "vitest";

import { getConnectionSuggestions } from "./AgentChatConnectionSuggestions";

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
});
