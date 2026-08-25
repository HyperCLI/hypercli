import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync(
  path.resolve(process.cwd(), "../../packages/shared-ui/src/styles/style.css"),
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
const hypercliLogoSource = readFileSync(
  path.resolve(process.cwd(), "../../packages/shared-ui/src/components/HyperCLILogo.tsx"),
  "utf8",
);
const cursorPrimitiveSources = [
  "accordion.tsx",
  "button.tsx",
  "input.tsx",
  "navigation-menu.tsx",
  "tabs.tsx",
  "toggle.tsx",
].map((fileName) => readFileSync(
  path.resolve(process.cwd(), `../../packages/shared-ui/src/components/ui/${fileName}`),
  "utf8",
));
const resizableSource = readFileSync(
  path.resolve(process.cwd(), "../../packages/shared-ui/src/components/ui/resizable.tsx"),
  "utf8",
);
const sliderSource = readFileSync(
  path.resolve(process.cwd(), "../../packages/shared-ui/src/components/ui/slider.tsx"),
  "utf8",
);

function themeBlockFor(selector: string) {
  const selectorIndex = themeCss.indexOf(selector);
  if (selectorIndex === -1) throw new Error(`Missing theme selector: ${selector}`);

  const openingBraceIndex = themeCss.indexOf("{", selectorIndex);
  const closingBraceIndex = themeCss.indexOf("\n}", openingBraceIndex);
  if (openingBraceIndex === -1 || closingBraceIndex === -1) {
    throw new Error(`Missing theme block for selector: ${selector}`);
  }

  return themeCss.slice(openingBraceIndex + 1, closingBraceIndex);
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
const lightBlock = themeBlockFor('[data-theme="light"]');
const auroraLightBlock = themeBlockFor('[data-theme="aurora-light"]');
const auroraDarkBlock = themeBlockFor('[data-theme="aurora-dark"]');

describe("shared theme CSS", () => {
  it("defines the fixed default brand, button, and selection contract", () => {
    expect(fixedDefaultBlock).toContain("--primary: #4f7cff;");
    expect(fixedDefaultBlock).toContain("--primary-hover: #5d87ff;");
    expect(fixedDefaultBlock).toContain("--primary-pressed: #3d68e6;");
    expect(fixedDefaultBlock).toContain("--accent: #5d87ff;");
    expect(fixedDefaultBlock).toContain("--accent-hover: #9db4ff;");
    expect(fixedDefaultBlock).toContain("--accent-pressed: #4f7cff;");
    expect(fixedDefaultBlock).toContain("--button-primary: #3d68e6;");
    expect(fixedDefaultBlock).toContain("--button-hover-foreground: #ffffff;");
    expect(fixedDefaultBlock).toContain("--button-primary-rgb: 61 104 230;");
    expect(fixedDefaultBlock).toContain("--selection-accent: #5d87ff;");
    expect(fixedDefaultBlock).toContain("--selection-accent-rgb: 93 135 255;");
    expect(fixedDefaultBlock).toContain("--selection-background: rgba(93, 135, 255, 0.35);");
    expect(fixedDefaultBlock).toContain("--elevation-shadow-medium: 0 18px 48px rgba(0, 0, 0, 0.46);");
    expect(tokenValue(fixedDefaultBlock, "--success")).not.toBe(tokenValue(fixedDefaultBlock, "--primary"));
  });

  it("defines a switchable light theme with the same token contract", () => {
    expect(lightBlock).toContain("--background: #ffffff;");
    expect(lightBlock).toContain("--button-primary: #3d68e6;");
    expect(lightBlock).toContain("--button-primary-rgb: 61 104 230;");
    expect(lightBlock).toContain("--selection-accent: #3d68e6;");
    expect(lightBlock).toContain("--glass-card-background: rgba(255, 255, 255, 0.78);");
    expect(lightBlock).toContain("--elevation-shadow-medium: 0 18px 48px rgba(31, 41, 55, 0.12);");
    expect(lightBlock).toContain("color-scheme: light;");
    expect(fixedDefaultBlock).toContain("color-scheme: dark;");
    expect(tokenNames(lightBlock)).toEqual(tokenNames(fixedDefaultBlock));
  });

  it("defines complete Aurora light and dark themes from the brand palette", () => {
    expect(auroraLightBlock).toContain("--background: #ffffff;");
    expect(auroraLightBlock).toContain("--foreground: #1f2937;");
    expect(auroraLightBlock).toContain("--primary: #3157c7;");
    expect(auroraLightBlock).toContain("--gradient-text-primary: linear-gradient(92deg, #4f7cff 5%, #6ce8c4 48%, #a97eff 100%);");
    expect(auroraLightBlock).toContain('--font-ui: var(--font-figtree, "Figtree")');
    expect(auroraDarkBlock).toContain("--background: #10151f;");
    expect(auroraDarkBlock).toContain("--surface-low: #1b2331;");
    expect(auroraDarkBlock).toContain("--foreground: #e8edf4;");
    expect(auroraDarkBlock).toContain("--link: #9db4ff;");
    expect(auroraDarkBlock).toContain("--terminal-live: #6ce8c4;");
    expect(auroraLightBlock).toContain("color-scheme: light;");
    expect(auroraDarkBlock).toContain("color-scheme: dark;");
    expect(tokenNames(auroraLightBlock)).toEqual(tokenNames(fixedDefaultBlock));
    expect(tokenNames(auroraDarkBlock)).toEqual(tokenNames(fixedDefaultBlock));
  });

  it("keeps Aurora CTAs blue while plan tiers only override wayfinding tokens", () => {
    expect(auroraLightBlock).toContain("--button-primary: #3d68e6;");
    expect(auroraDarkBlock).toContain("--button-primary: #3d68e6;");
    expect(themeCss).toContain('[data-theme="aurora-light"] [data-plan-tier="team"]');
    expect(themeCss).toContain("--plan-accent: #0e7a5f;");
    expect(themeCss).toContain('[data-theme="aurora-dark"] [data-plan-tier="enterprise"]');
    expect(themeCss).toContain("--plan-accent: #c9afff;");
    expect(themeCss).toContain('@custom-variant dark (&:where(.dark, .dark *, [data-color-mode="dark"]');
  });

  it("does not include removed theme variants", () => {
    expect(themeCss).not.toContain('[data-theme="purple"]');
    expect(themeCss).not.toContain('[data-theme="green"]');
    expect(themeCss).not.toContain("#63e452");
  });

  it("includes rendering fallbacks and Claw utility classes", () => {
    expect(themeCss).toContain("scrollbar-width: thin");
    expect(themeCss).toContain("scrollbar-color: var(--border-medium) var(--background)");
    expect(themeCss).toContain("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))");
    expect(themeCss).toContain(".glass-card");
    expect(themeCss).toContain(".btn-primary");
    expect(themeCss).toContain(".elevation-shadow-medium");
    expect(themeCss).toContain(':where(button, a, [role="button"]):hover');
    expect(themeCss).toContain("--button-primary-foreground: var(--button-hover-foreground);");
    expect(themeCss).toContain('.bg-foreground.text-background:hover');
  });

  it("keeps pasted Privy login values readable", () => {
    const privyInputBlock = themeBlockFor("#privy-modal-content input");

    expect(privyInputBlock).toContain("color: var(--privy-color-foreground);");
    expect(privyInputBlock).toContain("-webkit-text-fill-color: var(--privy-color-foreground) !important;");
    expect(privyInputBlock).toContain("caret-color: var(--privy-color-foreground);");
  });

  it("uses semantic cursors for activation, disabled, drag, and resize controls", () => {
    expect(clawGlobalsCss).toContain('button:not(:disabled):not([aria-disabled="true"]):not([role="option"]):not([role^="menuitem"])');
    expect(clawGlobalsCss).toContain('label:has(input:is([type="checkbox"], [type="radio"]):not(:disabled))');
    expect(clawGlobalsCss).toContain('[role="slider"]:not([aria-disabled="true"])');
    expect(clawGlobalsCss).toContain("cursor: pointer;");
    expect(clawGlobalsCss).toContain("cursor: not-allowed;");
    expect(clawGlobalsCss).toContain("cursor: grab;");
    expect(clawGlobalsCss).toContain("cursor: grabbing;");
    expect(clawGlobalsCss).toContain("cursor: inherit;");
    for (const source of cursorPrimitiveSources) {
      expect(source).not.toContain("disabled:pointer-events-none");
    }
    expect(resizableSource).toContain("cursor-col-resize");
    expect(resizableSource).toContain("data-[panel-group-direction=vertical]:cursor-row-resize");
    expect(sliderSource).toContain("cursor-grab");
    expect(sliderSource).toContain("active:cursor-grabbing");
    expect(sliderSource).toContain("data-[disabled]:cursor-not-allowed");
  });

  it("compacts the agent empty state within the available chat dimensions", () => {
    expect(clawGlobalsCss).toContain("align-items: safe center;");
    expect(clawGlobalsCss).toContain("container-name: agent-empty-history;");
    expect(clawGlobalsCss).toContain("container-type: size;");
    expect(clawGlobalsCss).toContain("@container agent-empty-history (max-height: 47rem)");
    expect(clawGlobalsCss).toContain("@container agent-empty-history (max-width: 40rem)");
    expect(clawGlobalsCss).toContain(".agent-empty-history-capability-row");
  });

  it("propagates the canonical switchable theme to main and console", () => {
    expect(sharedThemeCss).toContain('@import "./style.css";');
    expect(baseThemeCss.trim()).toBe('@import "./style.css";');
    expect(clawGlobalsCss).toContain('@import "@hypercli/shared-ui/styles/theme";');
    expect(mainGlobalsCss).toContain('@import "@hypercli/shared-ui/styles/theme";');
    expect(consoleGlobalsCss).toContain('@import "@hypercli/shared-ui/styles/theme";');
    expect(clawLayout).toContain('data-theme="aurora-dark"');
    expect(mainLayout).toContain('data-theme="aurora-dark"');
    expect(consoleLayout).toContain('data-theme="aurora-dark"');
    expect(clawLayout).not.toContain('data-theme="green"');
    expect(mainLayout).not.toContain('data-theme="green"');
    expect(consoleLayout).not.toContain('data-theme="green"');
    expect(clawLayout).toContain('data-color-mode="dark"');
    expect(mainLayout).toContain('data-color-mode="dark"');
    expect(consoleLayout).toContain('data-color-mode="dark"');
    expect(clawLayout).toContain('data-plan-tier="solo"');
  });

  it("selects the full logo from the color mode applied before first paint", () => {
    expect(themeCss).toContain('--hypercli-logo-full-image: url("/logos/hypercli-full-blue.svg");');
    expect(themeCss).toContain('--hypercli-logo-full-image: url("/logos/hypercli-full-blue-light.svg");');
    expect(hypercliLogoSource).toContain("var(--hypercli-logo-full-image");
    expect(hypercliLogoSource).not.toContain("useThemeOptional");
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

  it("does not derive outer elevation shadows from foreground text color", () => {
    const outerForegroundShadow = /shadow-\[(?!inset_)[^\]]*var\(--foreground\)/;
    const offenders = [sharedUiSrcDir, path.resolve(siteRoot, "apps/claw/src")]
      .flatMap(sourceFilesIn)
      .filter((filePath) => outerForegroundShadow.test(readFileSync(filePath, "utf8")))
      .map((filePath) => path.relative(siteRoot, filePath));

    expect(offenders).toEqual([]);
  });
});
