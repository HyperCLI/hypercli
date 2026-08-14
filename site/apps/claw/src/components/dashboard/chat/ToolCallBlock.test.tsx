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

import { ToolCallBlock } from "./ToolCallBlock";

const baseProps = {
  index: 0,
  isOpen: false,
  onToggle: vi.fn(),
  themeVariant: "off" as const,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("ToolCallBlock", () => {
  it("does not spin forever for non-streaming tool calls without results", () => {
    render(
      <ToolCallBlock
        {...baseProps}
        toolCall={{ name: "read_file", args: '{"path":"/tmp/example.txt"}' }}
        isStreaming={false}
      />,
    );

    expect(screen.getByText("Called")).toBeInTheDocument();
  });

  it("renders readable tool names and scalar query details", () => {
    const query = "OpenCode AI coding assistant IDE integration";

    render(
      <ToolCallBlock
        {...baseProps}
        isOpen
        toolCall={{
          name: "web_search",
          args: JSON.stringify({ query }),
          result: "Found 3 current references.",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /Web Search/i })).toBeInTheDocument();
    expect(screen.queryByText("web_search")).not.toBeInTheDocument();
    expect(screen.getByText("Query")).toBeInTheDocument();
    expect(screen.getByText(query)).toBeInTheDocument();
    expect(screen.getByText("Search results")).toBeInTheDocument();
    expect(screen.getByText("Found 3 current references.")).toBeInTheDocument();
    expect(screen.queryByText(/"query"/)).not.toBeInTheDocument();
  });

  it("puts failed tool details behind a second closed disclosure", () => {
    const error = "Brave Search API error (404): 404 page not found";
    const result = `Error: ${JSON.stringify({
      content: [
        {
          type: "text",
          text: JSON.stringify({ status: "error", tool: "web_search", error }, null, 2),
        },
      ],
      details: { status: "error" },
    }, null, 2)}`;

    const { container } = render(
      <ToolCallBlock
        {...baseProps}
        isOpen
        toolCall={{
          name: "web_search",
          args: JSON.stringify({ query: "OpenCode AI coding assistant IDE integration" }),
          result,
        }}
      />,
    );

    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.getByText("This action did not finish. Review any completed changes before retrying the request.")).toBeInTheDocument();
    expect(screen.getByText("Query")).toBeInTheDocument();

    const technicalDetails = screen.getByRole("button", { name: "Technical details" });
    expect(technicalDetails).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(`Error: ${error}`)).not.toBeInTheDocument();

    fireEvent.click(technicalDetails);

    expect(technicalDetails).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(`Error: ${error}`)).toBeInTheDocument();
    expect(screen.queryByText(/"content"/)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("destructive");
  });

  it("renders memory search as a readable tool name", () => {
    render(
      <ToolCallBlock
        {...baseProps}
        toolCall={{ name: "memory_search", args: JSON.stringify({ query: "billing preferences" }), result: "2 memories found" }}
      />,
    );

    expect(screen.getByRole("button", { name: /Memory Search/i })).toBeInTheDocument();
  });

  it("exposes disclosure state to assistive technology", () => {
    render(
      <ToolCallBlock
        {...baseProps}
        isOpen
        toolCall={{ name: "read_file", args: '{"path":"/tmp/example.txt"}', result: "ok" }}
      />,
    );

    const button = screen.getByRole("button", { name: /Read File/i });
    const controls = button.getAttribute("aria-controls");

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls ?? "")).not.toBeNull();
  });

  it("treats empty tool results as completed", () => {
    render(
      <ToolCallBlock
        {...baseProps}
        toolCall={{ name: "exec", args: '{"command":"true"}', result: "" }}
        isStreaming
      />,
    );

    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("$ true")).toBeInTheDocument();
  });

  it("stops showing running status after the pending timeout", () => {
    vi.useFakeTimers();
    render(
      <ToolCallBlock
        {...baseProps}
        toolCall={{ name: "read_file", args: '{"path":"/tmp/example.txt"}' }}
        isStreaming
      />,
    );

    expect(screen.getByText("Running")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    expect(screen.getByText("Called")).toBeInTheDocument();
  });

  it("clips long open tool results", () => {
    const longResult = "x".repeat(900);
    render(
      <ToolCallBlock
        {...baseProps}
        isOpen
        toolCall={{ name: "read_file", args: '{"path":"/tmp/example.txt"}', result: longResult }}
      />,
    );

    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText(/clipped/)).toBeInTheDocument();
  });
});
