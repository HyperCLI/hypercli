import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Rgb = [number, number, number];

const sharedThemeCss = readFileSync(
  resolve(process.cwd(), "../../packages/shared-ui/src/styles/style.css"),
  "utf8",
);
const clawThemeCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function declarations(css: string, selector: string): string {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`Missing CSS selector: ${selector}`);
  const bodyStart = start + marker.length;
  const end = css.indexOf("}", bodyStart);
  return css.slice(bodyStart, end);
}

function hexVariable(css: string, selector: string, name: string): Rgb | null {
  const match = declarations(css, selector).match(new RegExp(`${name}\\s*:\\s*(#[0-9a-f]{6})`, "i"));
  if (!match) return null;
  const channels = match[1].slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16));
  return channels?.length === 3 ? channels as Rgb : null;
}

function requiredHexVariable(css: string, selector: string, name: string): Rgb {
  const value = hexVariable(css, selector, name);
  if (!value) throw new Error(`Missing hex value for ${name} in ${selector}`);
  return value;
}

function blend(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return foreground.map((channel, index) => (
    channel * alpha + background[index] * (1 - alpha)
  )) as Rgb;
}

function relativeLuminance(color: Rgb): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const luminances = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

describe("Claw metadata contrast", () => {
  it.each([
    ["light", '[data-theme="aurora-light"]'],
    ["dark", '[data-theme="aurora-dark"]'],
  ] as const)("keeps affected %s surfaces at WCAG AA contrast", (mode, selector) => {
    const background = requiredHexVariable(sharedThemeCss, selector, "--background");
    const backgroundSecondary = requiredHexVariable(sharedThemeCss, selector, "--background-secondary");
    const surfaceLow = requiredHexVariable(sharedThemeCss, selector, "--surface-low");
    const surfaceHigh = requiredHexVariable(sharedThemeCss, selector, "--surface-high");
    const primary = requiredHexVariable(sharedThemeCss, selector, "--primary");
    const selectionAccent = requiredHexVariable(sharedThemeCss, selector, "--selection-accent");
    const sharedSecondary = requiredHexVariable(sharedThemeCss, selector, "--text-secondary");
    const metadata = mode === "light"
      ? hexVariable(clawThemeCss, '[data-color-mode="light"]', "--text-secondary") ?? sharedSecondary
      : sharedSecondary;

    const surfaces: Array<[string, Rgb]> = [
      ["assistant timestamp", surfaceLow],
      ["user timestamp", blend(primary, background, 0.1)],
      ["roster metadata", backgroundSecondary],
      ["selected roster metadata", blend(selectionAccent, backgroundSecondary, 0.1)],
      ["compact model label", surfaceHigh],
      ["Ready status", blend(selectionAccent, surfaceLow, 0.1)],
    ];

    for (const [surface, color] of surfaces) {
      const ratio = contrastRatio(metadata, color);
      expect(ratio, `${mode} ${surface}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
