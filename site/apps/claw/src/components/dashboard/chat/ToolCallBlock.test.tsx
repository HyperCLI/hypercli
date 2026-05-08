import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    const { container } = render(
      <ToolCallBlock
        {...baseProps}
        toolCall={{ name: "read_file", args: '{"path":"/tmp/example.txt"}' }}
        isStreaming={false}
      />,
    );

    expect(screen.getByText("Called")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("stops the running animation after the pending timeout", () => {
    vi.useFakeTimers();
    const { container } = render(
      <ToolCallBlock
        {...baseProps}
        toolCall={{ name: "read_file", args: '{"path":"/tmp/example.txt"}' }}
        isStreaming
      />,
    );

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    expect(screen.getByText("Called")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeNull();
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
