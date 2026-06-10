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

  it("exposes disclosure state to assistive technology", () => {
    render(
      <ToolCallBlock
        {...baseProps}
        isOpen
        toolCall={{ name: "read_file", args: '{"path":"/tmp/example.txt"}', result: "ok" }}
      />,
    );

    const button = screen.getByRole("button", { name: /read_file/i });
    const controls = button.getAttribute("aria-controls");

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls ?? "")).not.toBeNull();
  });

  it("treats empty tool results as completed", () => {
    const { container } = render(
      <ToolCallBlock
        {...baseProps}
        toolCall={{ name: "exec", args: '{"command":"true"}', result: "" }}
        isStreaming
      />,
    );

    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("$ true")).toBeInTheDocument();
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
