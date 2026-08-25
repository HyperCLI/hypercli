import { describe, expect, it } from "vitest";

import { getBubbleClasses, getToolCallClass, getToolCallStatusClass } from "./bubbleStyles";

describe("semantic chat styles", () => {
  it("uses theme-aware surfaces for bubble variants", () => {
    expect(getBubbleClasses("v1", "off", true)).toContain("bg-surface-high");
    expect(getBubbleClasses("off", "v2", false)).toContain("bg-surface-low");
    expect(getBubbleClasses("off", "v3", false)).toContain("bg-surface-low");
  });

  it("uses completed styling for tool results that include a note", () => {
    const toolCallClass = getToolCallClass("v2", "failed");
    const statusClass = getToolCallStatusClass("failed");

    expect(toolCallClass).toBe(getToolCallClass("v2", "done"));
    expect(statusClass).toBe(getToolCallStatusClass("done"));
    expect(`${toolCallClass} ${statusClass}`).not.toContain("warning");
    expect(`${toolCallClass} ${statusClass}`).not.toContain("destructive");
  });

  it("uses green for running tool calls and neutral gray for completed tool calls", () => {
    expect(getToolCallClass("v2", "running")).toContain("border-l-success/70");
    expect(getToolCallStatusClass("running")).toContain("text-success");
    expect(getToolCallClass("v2", "done")).toContain("border-l-border");
    expect(getToolCallStatusClass("done")).toContain("text-text-secondary");
  });
});
