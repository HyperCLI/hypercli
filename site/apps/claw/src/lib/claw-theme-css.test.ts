import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const clawThemeCss = readFileSync(
  path.resolve(process.cwd(), "../../packages/shared-ui/src/styles/claw.css"),
  "utf8",
);

const fixedGreenBlock = (() => {
  const match = clawThemeCss.match(/\[data-theme="green"\]\s*\{([\s\S]*?)\n\}/);
  if (!match) throw new Error("Missing fixed green theme block");
  return match[1];
})();

describe("claw theme CSS", () => {
  it("defines the fixed green button and selection contract", () => {
    expect(fixedGreenBlock).toContain("--button-primary: #63e452;");
    expect(fixedGreenBlock).toContain("--button-primary-rgb: 99 228 82;");
    expect(fixedGreenBlock).toContain("--selection-accent: #63e452;");
    expect(fixedGreenBlock).toContain("--selection-accent-rgb: 99 228 82;");
    expect(fixedGreenBlock).toContain("--selection-background: rgba(99, 228, 82, 0.3);");
  });

  it("does not include removed theme variants", () => {
    expect(clawThemeCss).not.toContain('[data-theme="default"]');
    expect(clawThemeCss).not.toContain('[data-theme="purple"]');
  });

  it("includes rendering fallbacks and Claw utility classes", () => {
    expect(clawThemeCss).toContain("scrollbar-width: thin");
    expect(clawThemeCss).toContain("scrollbar-color: var(--border-medium) var(--background)");
    expect(clawThemeCss).toContain("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))");
    expect(clawThemeCss).toContain(".glass-card");
    expect(clawThemeCss).toContain(".btn-primary");
  });
});
