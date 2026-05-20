import { describe, expect, it } from "vitest";

import { integrationDisplayName } from "./integration-display-name";

describe("integrationDisplayName", () => {
  it("uses registry display names for integration ids", () => {
    expect(integrationDisplayName("slack", "slack")).toBe("Slack");
    expect(integrationDisplayName("msteams", "msteams")).toBe("Microsoft Teams");
    expect(integrationDisplayName("plugins.entries.openai", "plugins.entries.openai")).toBe("OpenAI");
    expect(integrationDisplayName("channels.googlechat", "channels.googlechat")).toBe("Google Chat");
  });

  it("falls back from missing names to ids", () => {
    expect(integrationDisplayName("", "telegram")).toBe("Telegram");
    expect(integrationDisplayName(null, "builtin-voice")).toBe("Voice");
  });

  it("humanizes unknown ids instead of showing raw ids", () => {
    expect(integrationDisplayName("custom-webhook", "custom-webhook")).toBe("Custom Webhook");
    expect(integrationDisplayName("", "api_key")).toBe("API Key");
  });
});
