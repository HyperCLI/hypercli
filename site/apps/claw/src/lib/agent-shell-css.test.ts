import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  path.resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

describe("agent shell CSS", () => {
  it("does not expose xterm's focused helper textarea as a terminal cursor", () => {
    const helperTextareaRule = globalsCss.match(
      /\.xterm \.xterm-helper-textarea:focus,\s*\.xterm \.xterm-helper-textarea:focus-visible\s*\{([^}]*)\}/,
    );

    expect(helperTextareaRule).not.toBeNull();
    expect(helperTextareaRule?.[1]).toContain("border: 0;");
    expect(helperTextareaRule?.[1]).toContain("box-shadow: none;");
    expect(helperTextareaRule?.[1]).toContain("outline: none;");
    expect(helperTextareaRule?.[1]).toContain("resize: none;");
  });
});
