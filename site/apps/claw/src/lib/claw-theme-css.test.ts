import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const clawThemeCss = readFileSync(
  path.resolve(process.cwd(), "../../packages/shared-ui/src/styles/claw.css"),
  "utf8",
);
const sharedThemeCss = readFileSync(
  path.resolve(process.cwd(), "../../packages/shared-ui/src/styles/theme.css"),
  "utf8",
);
const mainGlobalsCss = readFileSync(
  path.resolve(process.cwd(), "../main/src/app/globals.css"),
  "utf8",
);
const clawGlobalsCss = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
const consoleGlobalsCss = readFileSync(
  path.resolve(process.cwd(), "../console/src/app/globals.css"),
  "utf8",
);
const clawLayout = readFileSync(path.resolve(process.cwd(), "src/app/layout.tsx"), "utf8");
const mainLayout = readFileSync(path.resolve(process.cwd(), "../main/src/app/layout.tsx"), "utf8");
const consoleLayout = readFileSync(path.resolve(process.cwd(), "../console/src/app/layout.tsx"), "utf8");

function themeBlockFor(selector: string) {
  const selectorIndex = clawThemeCss.indexOf(selector);
  if (selectorIndex === -1) throw new Error(`Missing theme selector: ${selector}`);

  const openingBraceIndex = clawThemeCss.indexOf("{", selectorIndex);
  const closingBraceIndex = clawThemeCss.indexOf("\n}", openingBraceIndex);
  if (openingBraceIndex === -1 || closingBraceIndex === -1) {
    throw new Error(`Missing theme block for selector: ${selector}`);
  }

  return clawThemeCss.slice(openingBraceIndex + 1, closingBraceIndex);
}

const fixedDefaultBlock = themeBlockFor('[data-theme="default"]');
const greenAliasBlock = themeBlockFor('[data-theme="green"]');
const lightBlock = themeBlockFor('[data-theme="light"]');

describe("claw theme CSS", () => {
  it("defines the fixed default button and selection contract", () => {
    expect(fixedDefaultBlock).toContain("--button-primary: #63e452;");
    expect(fixedDefaultBlock).toContain("--button-primary-rgb: 99 228 82;");
    expect(fixedDefaultBlock).toContain("--selection-accent: #63e452;");
    expect(fixedDefaultBlock).toContain("--selection-accent-rgb: 99 228 82;");
    expect(fixedDefaultBlock).toContain("--selection-background: rgba(99, 228, 82, 0.3);");
  });

  it("keeps green as a compatibility alias, not the canonical theme", () => {
    expect(clawThemeCss.indexOf('[data-theme="default"]')).toBeLessThan(clawThemeCss.indexOf('[data-theme="green"]'));
    expect(greenAliasBlock).toBe(fixedDefaultBlock);
  });

  it("defines a switchable light theme with the same token contract", () => {
    expect(lightBlock).toContain("--background: #f7f8f4;");
    expect(lightBlock).toContain("--button-primary: #1f8f65;");
    expect(lightBlock).toContain("--button-primary-rgb: 31 143 101;");
    expect(lightBlock).toContain("--selection-accent: #1f8f65;");
    expect(lightBlock).toContain("--glass-card-background: rgba(255, 255, 255, 0.78);");
  });

  it("does not include removed theme variants", () => {
    expect(clawThemeCss).not.toContain('[data-theme="purple"]');
  });

  it("includes rendering fallbacks and Claw utility classes", () => {
    expect(clawThemeCss).toContain("scrollbar-width: thin");
    expect(clawThemeCss).toContain("scrollbar-color: var(--border-medium) var(--background)");
    expect(clawThemeCss).toContain("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))");
    expect(clawThemeCss).toContain(".glass-card");
    expect(clawThemeCss).toContain(".btn-primary");
  });

  it("propagates the canonical switchable theme to main and console", () => {
    expect(sharedThemeCss).toContain('@import "./claw.css";');
    expect(clawGlobalsCss).toContain('@import "@hypercli/shared-ui/styles/theme";');
    expect(mainGlobalsCss).toContain('@import "@hypercli/shared-ui/styles/theme";');
    expect(consoleGlobalsCss).toContain('@import "@hypercli/shared-ui/styles/theme";');
    expect(clawLayout).toContain('data-theme="default"');
    expect(mainLayout).toContain('data-theme="default"');
    expect(consoleLayout).toContain('data-theme="default"');
    expect(clawLayout).not.toContain('data-theme="green"');
    expect(mainLayout).not.toContain('data-theme="green"');
    expect(consoleLayout).not.toContain('data-theme="green"');
  });
});
