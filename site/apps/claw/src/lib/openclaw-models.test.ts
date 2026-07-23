import { describe, expect, it } from "vitest";

import {
  buildOpenClawModelUpsertPatch,
  normalizeOpenClawConfiguredProviders,
  normalizeOpenClawModelOptions,
} from "./openclaw-models";

describe("openclaw-models", () => {
  const config = {
    models: {
      mode: "merge",
      providers: {
        openai: {
          name: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "__OPENCLAW_REDACTED__",
          models: [{ id: "gpt-5-mini", name: "GPT-5 Mini" }],
        },
        anthropic: {
          name: "Anthropic",
          models: [],
        },
      },
    },
  };

  it("lists configured providers without exposing provider configuration", () => {
    expect(normalizeOpenClawConfiguredProviders(config)).toEqual([
      { value: "anthropic", label: "Anthropic", modelCount: 0 },
      { value: "openai", label: "OpenAI", modelCount: 1 },
    ]);
  });

  it("appends a model while patching only the provider model array", () => {
    expect(buildOpenClawModelUpsertPatch(config, "openai", "gpt-5.2")).toEqual({
      models: {
        providers: {
          openai: {
            models: [
              { id: "gpt-5-mini", name: "GPT-5 Mini" },
              { id: "gpt-5.2", name: "gpt-5.2" },
            ],
          },
        },
      },
    });
  });

  it("rejects duplicate models and unconfigured providers", () => {
    expect(() => buildOpenClawModelUpsertPatch(config, "openai", "gpt-5-mini"))
      .toThrow('Model "gpt-5-mini" is already configured for openai.');
    expect(() => buildOpenClawModelUpsertPatch(config, "google", "gemini-2.5-pro"))
      .toThrow("Choose a configured provider before adding a model.");
  });

  it("does not offer models that the gateway marks unavailable", () => {
    expect(normalizeOpenClawModelOptions(config, [
      { id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai", available: false },
      { id: "gpt-5.2", name: "GPT-5.2", provider: "openai", available: true },
    ])).toEqual([
      expect.objectContaining({ value: "openai/gpt-5.2", label: "GPT-5.2 (openai)" }),
    ]);
  });
});
