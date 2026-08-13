import { describe, expect, it } from "vitest";

import {
  controlUiAllowedOriginsFromLaunchConfig,
  normalizeControlUiOrigin,
  parseControlUiAllowedOrigins,
} from "./control-ui-origin";

describe("control UI origin normalization", () => {
  it("normalizes safe HTTP origins and strips non-origin URL fields", () => {
    expect(normalizeControlUiOrigin(" https://agents.hypercli.com/path?token=secret#fragment "))
      .toBe("https://agents.hypercli.com");
    expect(parseControlUiAllowedOrigins("https://one.example, https://two.example/path"))
      .toEqual(["https://one.example", "https://two.example"]);
  });

  it("reads and deduplicates env and config origins from launch config", () => {
    expect(controlUiAllowedOriginsFromLaunchConfig({
      env: {
        OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: "https://env.example/path",
      },
      config: {
        gateway: {
          controlUi: {
            allowedOrigins: ["https://config.example/a", "https://env.example/again"],
          },
        },
      },
    })).toEqual(["https://env.example", "https://config.example"]);
  });

  it("drops malformed or untrusted origins instead of reflecting them", () => {
    expect(controlUiAllowedOriginsFromLaunchConfig({
      env: {
        OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN: "javascript:alert('token-secret')",
      },
      config: {
        gateway: {
          controlUi: {
            allowedOrigins: [
              "not a URL containing token-secret",
              "data:text/plain,token-secret",
              "https://user:token-secret@example.com",
              42,
            ],
          },
        },
      },
    })).toEqual([]);
  });
});
