import { readFileSync, readdirSync, statSync } from "node:fs";
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
const baseThemeCss = readFileSync(
  path.resolve(process.cwd(), "../../packages/shared-ui/src/styles/base.css"),
  "utf8",
);
const siteRoot = path.resolve(process.cwd(), "../..");
const sharedUiSrcDir = path.resolve(siteRoot, "packages/shared-ui/src");
const oldBrandScanTargets = [
  sharedUiSrcDir,
  path.resolve(siteRoot, "apps/claw/src"),
  path.resolve(siteRoot, "apps/main/src"),
  path.resolve(siteRoot, "apps/console/src"),
  path.resolve(siteRoot, "CLAUDE.md"),
  path.resolve(siteRoot, "AGENTS.md"),
];
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

function tokenValue(block: string, token: string) {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`${escapedToken}:\\s*([^;]+);`));
  return match?.[1].trim();
}

function tokenNames(block: string): string[] {
  return Array.from(block.matchAll(/(--[\w-]+):/g), (match) => match[1]).sort();
}

function sourceFilesIn(dir: string): string[] {
  const stats = statSync(dir);
  if (!stats.isDirectory()) return /\.(ts|tsx|css|md|mdx)$/.test(dir) ? [dir] : [];

  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) return sourceFilesIn(fullPath);
    return /\.(ts|tsx|css|md|mdx)$/.test(fullPath) ? [fullPath] : [];
  });
}

const fixedDefaultBlock = themeBlockFor('[data-theme="default"]');
const greenAliasBlock = themeBlockFor('[data-theme="green"]');
const lightBlock = themeBlockFor('[data-theme="light"]');

describe("claw theme CSS", () => {
  it("defines the fixed default brand, button, and selection contract", () => {
    expect(fixedDefaultBlock).toContain("--primary: #63e452;");
    expect(fixedDefaultBlock).toContain("--primary-hover: #75ef64;");
    expect(fixedDefaultBlock).toContain("--primary-pressed: #52c943;");
    expect(fixedDefaultBlock).toContain("--accent: #63e452;");
    expect(fixedDefaultBlock).toContain("--accent-hover: #75ef64;");
    expect(fixedDefaultBlock).toContain("--accent-pressed: #52c943;");
    expect(fixedDefaultBlock).toContain("--button-primary: #63e452;");
    expect(fixedDefaultBlock).toContain("--button-primary-rgb: 99 228 82;");
    expect(fixedDefaultBlock).toContain("--selection-accent: #63e452;");
    expect(fixedDefaultBlock).toContain("--selection-accent-rgb: 99 228 82;");
    expect(fixedDefaultBlock).toContain("--selection-background: rgba(99, 228, 82, 0.3);");
    expect(tokenValue(fixedDefaultBlock, "--success")).not.toBe(tokenValue(fixedDefaultBlock, "--primary"));
  });

  it("keeps green as a compatibility alias, not the canonical theme", () => {
    expect(clawThemeCss.indexOf('[data-theme="default"]')).toBeLessThan(clawThemeCss.indexOf('[data-theme="green"]'));
    expect(greenAliasBlock).toBe(fixedDefaultBlock);
  });

  it("defines a switchable light theme with the same token contract", () => {
    expect(lightBlock).toContain("--background: #f7f8f4;");
    expect(lightBlock).toContain("--button-primary: #177a55;");
    expect(lightBlock).toContain("--button-primary-rgb: 23 122 85;");
    expect(lightBlock).toContain("--selection-accent: #177a55;");
    expect(lightBlock).toContain("--glass-card-background: rgba(255, 255, 255, 0.78);");
    expect(lightBlock).toContain("color-scheme: light;");
    expect(fixedDefaultBlock).toContain("color-scheme: dark;");
    expect(tokenNames(lightBlock)).toEqual(tokenNames(fixedDefaultBlock));
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
    expect(baseThemeCss.trim()).toBe('@import "./claw.css";');
    expect(clawGlobalsCss).toContain('@import "@hypercli/shared-ui/styles/theme";');
    expect(mainGlobalsCss).toContain('@import "@hypercli/shared-ui/styles/theme";');
    expect(consoleGlobalsCss).toContain('@import "@hypercli/shared-ui/styles/theme";');
    expect(clawLayout).toContain('data-theme="dark"');
    expect(mainLayout).toContain('data-theme="dark"');
    expect(consoleLayout).toContain('data-theme="dark"');
    expect(clawLayout).not.toContain('data-theme="green"');
    expect(mainLayout).not.toContain('data-theme="green"');
    expect(consoleLayout).not.toContain('data-theme="green"');
  });

  it("does not use the old teal brand palette in active source or docs", () => {
    const removedHexPalette = ["38" + "d39f", "45" + "e4ae", "2d" + "b789", "2d" + "c890"];
    const removedRgb = [7 * 8, 200 + 11, 3 * 53].join("\\s*,\\s*");
    const oldBrandPalette = new RegExp(
      String.raw`(?:#|%23)?(?:${removedHexPalette.join("|")})|rgba?\(\s*${removedRgb}\s*(?:,|/)`,
      "i",
    );
    const offenders = oldBrandScanTargets.flatMap(sourceFilesIn)
      .filter((filePath) => oldBrandPalette.test(readFileSync(filePath, "utf8")))
      .map((filePath) => path.relative(siteRoot, filePath));

    expect(offenders).toEqual([]);
  });
});
