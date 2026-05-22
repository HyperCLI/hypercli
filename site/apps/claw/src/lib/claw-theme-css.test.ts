import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");

function themeBlock(theme: "green" | "purple") {
  const match = globalsCss.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing ${theme} theme block`);
  return match[1];
}

describe("claw theme CSS", () => {
  it.each(["green", "purple"] as const)("keeps %s scoped to buttons and selections", (theme) => {
    const block = themeBlock(theme);

    expect(block).toContain("--button-primary:");
    expect(block).toContain("--button-primary-rgb:");
    expect(block).toContain("--selection-accent:");
    expect(block).toContain("--selection-accent-rgb:");
    expect(block).toContain("--selection-background:");
    expect(block).not.toMatch(/--background\s*:/);
    expect(block).not.toMatch(/--foreground\s*:/);
    expect(block).not.toMatch(/--text-/);
    expect(block).not.toMatch(/--surface-/);
    expect(block).not.toMatch(/--primary\s*:/);
    expect(block).not.toMatch(/--accent\s*:/);
  });

  it("includes Firefox rendering fallbacks", () => {
    expect(globalsCss).toContain("scrollbar-width: thin");
    expect(globalsCss).toContain("scrollbar-color: var(--border-medium) var(--background)");
    expect(globalsCss).toContain("@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))");
    expect(globalsCss).toContain("@supports not (height: 100dvh)");
  });
});
