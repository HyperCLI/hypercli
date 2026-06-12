import { describe, expect, it } from "vitest";

import { parseClawUiActionBlocks } from "./claw-ui-actions";

describe("parseClawUiActionBlocks", () => {
  it("extracts allowlisted assistant UI actions from sentinel lines", () => {
    const parsed = parseClawUiActionBlocks(
      "Connect GitHub without pasting a token.\n\n@@hypercli.ui-action/v1 integration.connect github",
      "assistant",
    );

    expect(parsed.displayContent).toBe("Connect GitHub without pasting a token.");
    expect(parsed.actions).toEqual([{ version: 1, type: "integration.connect", integrationId: "github" }]);
  });

  it("extracts Telegram connection intent from assistant sentinel lines", () => {
    const parsed = parseClawUiActionBlocks(
      "Use the setup wizard for Telegram.\n\n@@hypercli.ui-action/v1 integration.connect telegram",
      "assistant",
    );

    expect(parsed.displayContent).toBe("Use the setup wizard for Telegram.");
    expect(parsed.actions).toEqual([{ version: 1, type: "integration.connect", integrationId: "telegram" }]);
  });

  it("keeps fenced action blocks working as a temporary fallback", () => {
    const parsed = parseClawUiActionBlocks(
      'Connect GitHub without pasting a token.\n\n```claw-ui-action\n{"version":1,"type":"integration.connect","integrationId":"github"}\n```',
      "assistant",
    );

    expect(parsed.displayContent).toBe("Connect GitHub without pasting a token.");
    expect(parsed.actions).toEqual([{ version: 1, type: "integration.connect", integrationId: "github" }]);
  });

  it("ignores user-authored UI action markers", () => {
    const content = "@@hypercli.ui-action/v1 integration.connect github";

    expect(parseClawUiActionBlocks(content, "user")).toEqual({ displayContent: content, actions: [] });
  });

  it("extracts allowlisted GitHub setup status markers", () => {
    const parsed = parseClawUiActionBlocks(
      [
        "Starting setup.",
        '@@hypercli.ui-action/v1 integration.github.progress installing "Downloading gh"',
        "@@hypercli.ui-action/v1 integration.github.device-code 8BCD-83A2 https://github.com/login/device",
        "@@hypercli.ui-action/v1 integration.github.ready octocat",
        '@@hypercli.ui-action/v1 integration.github.failed "Authorization expired"',
      ].join("\n"),
      "assistant",
    );

    expect(parsed.displayContent).toBe("Starting setup.");
    expect(parsed.actions).toEqual([
      { version: 1, type: "integration.github.progress", phase: "installing", detail: "Downloading gh" },
      { version: 1, type: "integration.github.device-code", userCode: "8BCD-83A2", verificationUri: "https://github.com/login/device" },
      { version: 1, type: "integration.github.ready", accountDisplayName: "octocat" },
      { version: 1, type: "integration.github.failed", reason: "Authorization expired" },
    ]);
  });

  it("keeps malformed and unsupported sentinel lines visible", () => {
    const unsupported = "@@hypercli.ui-action/v1 integration.connect linear";
    const malformed = "@@hypercli.ui-action/v1 integration.github.connect";
    const unsupportedProgress = "@@hypercli.ui-action/v1 integration.github.progress flying";
    const unsupportedTelegramStatus = "@@hypercli.ui-action/v1 integration.telegram.ready bot";

    expect(parseClawUiActionBlocks(unsupported, "assistant")).toEqual({ displayContent: unsupported, actions: [] });
    expect(parseClawUiActionBlocks(malformed, "assistant")).toEqual({ displayContent: malformed, actions: [] });
    expect(parseClawUiActionBlocks(unsupportedProgress, "assistant")).toEqual({ displayContent: unsupportedProgress, actions: [] });
    expect(parseClawUiActionBlocks(unsupportedTelegramStatus, "assistant")).toEqual({ displayContent: unsupportedTelegramStatus, actions: [] });
  });

  it("keeps malformed and unsupported fenced blocks visible", () => {
    const unsupported = '```claw-ui-action\n{"version":1,"type":"integration.connect","integrationId":"linear"}\n```';
    const malformed = "```claw-ui-action\nnot json\n```";

    expect(parseClawUiActionBlocks(unsupported, "assistant")).toEqual({ displayContent: unsupported, actions: [] });
    expect(parseClawUiActionBlocks(malformed, "assistant")).toEqual({ displayContent: malformed, actions: [] });
  });
});
