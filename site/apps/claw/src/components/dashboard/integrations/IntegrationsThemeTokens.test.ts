import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { INTEGRATION_BRAND_LOGOS } from "./integration-brand-icons";

const THEMED_SURFACES = [
  "src/components/dashboard/integrations/IntegrationsDirectoryPanel.tsx",
  "src/components/dashboard/integrations/TokenSetupWizard.tsx",
  "src/components/dashboard/integrations/QrLoginWizard.tsx",
  "src/components/dashboard/integrations/integration-brand-icons.ts",
  "src/components/dashboard/chat-integrations/OpenClawChannelSettingsPanel.tsx",
];

const FORBIDDEN_COLOR_PATTERNS = [
  /#[\da-f]{3,8}/i,
  /\b(?:rgb|rgba|hsl|hsla)\(/i,
  /\bcolor-mix\(/i,
  /\b(?:bg|text|border)-success(?:\/|\b)/i,
  /\b(?:bg|text|border|ring)-(?:amber|emerald|red|green|yellow|gray|zinc|neutral|stone|slate)-\d+/i,
];

describe("integrations theme tokens", () => {
  it.each(THEMED_SURFACES)("uses shared theme colors in %s", (relativePath) => {
    const filePath = resolve(process.cwd(), relativePath);
    const source = readFileSync(filePath, "utf8");

    FORBIDDEN_COLOR_PATTERNS.forEach((pattern) => {
      expect(source, `${filePath} contains ${pattern}`).not.toMatch(pattern);
    });
  });

  it("keeps provider colors on logos", () => {
    expect(INTEGRATION_BRAND_LOGOS.telegram.color).toBe("var(--integration-telegram)");
    expect(INTEGRATION_BRAND_LOGOS.discord.color).toBe("var(--integration-discord)");
    expect(INTEGRATION_BRAND_LOGOS.slack.color).toBe("var(--integration-slack)");
    expect(INTEGRATION_BRAND_LOGOS.whatsapp.color).toBe("var(--integration-whatsapp)");
  });

  it.each([
    "src/components/dashboard/chat-integrations/TelegramChatConnectorCard.tsx",
    "src/components/dashboard/chat-integrations/ChannelChatConnectorCard.tsx",
  ])("uses green-theme accents for controls in %s", (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
    expect(source).toContain('"--channel-accent": "var(--selection-accent)"');
    expect(source).toContain('"--channel-accent-foreground": "var(--selection-accent-foreground)"');
  });
});
