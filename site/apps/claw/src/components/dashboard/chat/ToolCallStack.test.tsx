import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@hypercli/shared-ui", async () => ({
  ...(await import("../../../../../../packages/shared-ui/src/components/ui/tooltip")),
  RecoveryDetails: (await import("../../../../../../packages/shared-ui/src/components/patterns/recovery")).RecoveryDetails,
}));

vi.mock("@hypercli/shared-ui/files", async () => {
  const fileTypes = await import("../../../../../../packages/shared-ui/src/files/file-types");
  return {
    ...fileTypes,
    formatFileSize: (bytes?: number) => bytes === undefined ? "" : `${bytes} B`,
  };
});

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
  it("stacks tool calls at the threshold", () => {
    expect(shouldStackToolCalls(toolCalls.slice(0, 2))).toBe(false);
    expect(shouldStackToolCalls(toolCalls.slice(0, 3))).toBe(true);
  });

  it("collapses three tool calls by default", () => {
    render(<ToolCallStack toolCalls={toolCalls.slice(0, 3)} themeVariant="off" />);

    const stackButton = screen.getByRole("button", { name: /3 tool calls/i });
    expect(stackButton).toHaveAttribute("aria-expanded", "false");
    expect(stackButton).toHaveAttribute("aria-controls");
    expect(screen.queryByText("Four")).toBeNull();

    fireEvent.click(stackButton);

    expect(stackButton).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(stackButton.getAttribute("aria-controls") ?? "")).not.toBeNull();
    expect(screen.getByText("Three")).toBeInTheDocument();
  });

  it("counts empty tool results as completed", () => {
    const emptyResultToolCalls = toolCalls.map((toolCall) => ({ ...toolCall, result: "" }));
    render(<ToolCallStack toolCalls={emptyResultToolCalls} themeVariant="off" isStreaming />);

    const stackButton = screen.getByRole("button", { name: /4 tool calls/i });
    expect(stackButton).toHaveTextContent("Done");
    expect(screen.queryByText(/0\/4 returned/)).not.toBeInTheDocument();
  });

  it("marks a completed stack with a failed tool as completed with issues", () => {
    const failedToolCalls = toolCalls.map((toolCall, index) => (
      index === toolCalls.length - 1 ? { ...toolCall, result: 'Error: {"error":"Search failed"}' } : toolCall
    ));

    render(<ToolCallStack toolCalls={failedToolCalls} themeVariant="off" />);

    const stackButton = screen.getByRole("button", { name: /4 tool calls/i });
    expect(stackButton).toHaveTextContent("Completed with issues");
    expect(stackButton).toHaveTextContent("1 of 4 needs review");
    expect(stackButton).not.toHaveTextContent("Failed");
  });

  it("keeps completed-with-issues copy when a successful tool follows a failure", () => {
    const recoveredToolCalls = toolCalls.map((toolCall, index) => (
      index === 1 ? { ...toolCall, result: 'Error: {"error":"Search failed"}' } : toolCall
    ));

    render(<ToolCallStack toolCalls={recoveredToolCalls} themeVariant="off" />);

    const stackButton = screen.getByRole("button", { name: /4 tool calls/i });
    expect(stackButton).toHaveTextContent("Completed with issues");
    expect(stackButton).toHaveTextContent("1 of 4 needs review");
  });

  it("uses no destructive classes for completed stacks that need review", () => {
    const failedToolCalls = toolCalls.map((toolCall, index) => (
      index === 1 ? { ...toolCall, result: 'Error: {"error":"Search failed"}' } : toolCall
    ));

    const { container } = render(<ToolCallStack toolCalls={failedToolCalls} themeVariant="v2" />);

    expect(container.innerHTML).not.toContain("destructive");
  });

  it("shows running when the latest tool call is still pending", () => {
    const runningToolCalls = toolCalls.map((toolCall, index) => (
      index === toolCalls.length - 1 ? { ...toolCall, result: undefined } : toolCall
    ));

    render(<ToolCallStack toolCalls={runningToolCalls} themeVariant="off" isStreaming />);

    const stackButton = screen.getByRole("button", { name: /4 tool calls/i });
    expect(stackButton).toHaveTextContent("Running");
    expect(stackButton).toHaveTextContent("3/4 returned");
  });

  it("keeps the stack running when an earlier tool call is still pending", () => {
    const runningToolCalls = toolCalls.map((toolCall, index) => (
      index === 1 ? { ...toolCall, result: undefined } : toolCall
    ));

    render(<ToolCallStack toolCalls={runningToolCalls} themeVariant="off" isStreaming />);

    const stackButton = screen.getByRole("button", { name: /4 tool calls/i });
    expect(stackButton).toHaveTextContent("Running");
    expect(stackButton).toHaveTextContent("3/4 returned");
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

  it("stops showing running status after the pending timeout", () => {
    vi.useFakeTimers();
    const pendingToolCalls = toolCalls.map((toolCall) => ({ ...toolCall, result: undefined }));
    render(<ToolCallStack toolCalls={pendingToolCalls} themeVariant="off" isStreaming />);

    expect(screen.getByText("Running")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    expect(screen.getByText("Called")).toBeInTheDocument();
  });
});
