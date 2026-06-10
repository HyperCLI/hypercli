import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./AuthImage", () => ({
  AuthImage: () => <div data-testid="auth-image" />,
}));

import { ToolCallStack, shouldStackToolCalls } from "./ToolCallStack";

const toolCalls = [
  { id: "one", name: "one", args: "{}", result: '{"ok":true}' },
  { id: "two", name: "two", args: "{}", result: '{"ok":true}' },
  { id: "three", name: "three", args: "{}", result: '{"ok":true}' },
  { id: "four", name: "four", args: "{}", result: '{"ok":true}' },
];

afterEach(() => {
  vi.useRealTimers();
});

describe("ToolCallStack", () => {
  it("only stacks tool calls after the threshold", () => {
    expect(shouldStackToolCalls(toolCalls.slice(0, 3))).toBe(false);
    expect(shouldStackToolCalls(toolCalls)).toBe(true);
  });

  it("collapses more than three tool calls by default", () => {
    render(<ToolCallStack toolCalls={toolCalls} themeVariant="off" />);

    const stackButton = screen.getByRole("button", { name: /4 tool calls/i });
    expect(stackButton).toHaveAttribute("aria-expanded", "false");
    expect(stackButton).toHaveAttribute("aria-controls");
    expect(screen.queryByText("four")).toBeNull();

    fireEvent.click(stackButton);

    expect(stackButton).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(stackButton.getAttribute("aria-controls") ?? "")).not.toBeNull();
    expect(screen.getByText("four")).toBeInTheDocument();
  });

  it("counts empty tool results as completed", () => {
    const emptyResultToolCalls = toolCalls.map((toolCall) => ({ ...toolCall, result: "" }));
    render(<ToolCallStack toolCalls={emptyResultToolCalls} themeVariant="off" isStreaming />);

    const stackButton = screen.getByRole("button", { name: /4 tool calls/i });
    expect(stackButton).toHaveTextContent("Done");
    expect(screen.queryByText(/0\/4 done/)).not.toBeInTheDocument();
  });

  it("renders duplicate gateway ids without key warnings", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const duplicateIdToolCalls = toolCalls.map((toolCall) => ({ ...toolCall, id: "functions.web_fetch:5" }));
      render(<ToolCallStack toolCalls={duplicateIdToolCalls} themeVariant="off" />);

      fireEvent.click(screen.getByRole("button", { name: /4 tool calls/i }));

      expect(consoleError.mock.calls.some((call) => call.join(" ").includes("same key"))).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("stops the stack running animation after the pending timeout", () => {
    vi.useFakeTimers();
    const pendingToolCalls = toolCalls.map((toolCall) => ({ ...toolCall, result: undefined }));
    const { container } = render(<ToolCallStack toolCalls={pendingToolCalls} themeVariant="off" isStreaming />);

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    expect(screen.getByText("Called")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});
