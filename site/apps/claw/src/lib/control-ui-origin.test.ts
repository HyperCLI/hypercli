import { describe, expect, it } from "vitest";

import { controlUiAllowedOriginsFromLaunchConfig } from "./control-ui-origin";

// Origin parsing/normalization itself is canonically covered by
// ts-sdk/tests/openclaw-control-ui-origin.test.ts; this suite only exercises
// the launch-config read this app adds on top.

describe("controlUiAllowedOriginsFromLaunchConfig", () => {
  it("reads and deduplicates env origins from launch config", () => {
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
    })).toEqual(["https://env.example"]);
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
