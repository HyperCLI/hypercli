import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./AuthImage", () => ({
  AuthImage: () => <div data-testid="auth-image" />,
}));

import {
  AudioMessageBubble,
  InChatUxKitDemo,
  LongOutputViewer,
  PromptChips,
} from "./InChatUxKit";

describe("InChatUxKit", () => {
  it("renders the full dev demo surface", () => {
    render(<InChatUxKitDemo />);

    expect(screen.getByText("Interactive states for agent workflows")).toBeInTheDocument();
    expect(screen.getByText("4 tool calls")).toBeInTheDocument();
    expect(screen.queryByText("Gateway disconnected")).toBeNull();
    expect(screen.getByText("Reconnecting gateway")).toBeInTheDocument();
    expect(screen.getByText("Session summary")).toBeInTheDocument();
    expect(screen.getByText("/ command palette")).toBeInTheDocument();
  });

  it("expands long output on demand", () => {
    render(<LongOutputViewer title="npm run lint" output={"first line\nsecond line"} />);

    expect(screen.queryByText(/second line/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /npm run lint/i }));
    expect(screen.getByText(/second line/)).toBeInTheDocument();
  });

  it("handles prompt chips and audio playback interactions", () => {
    const onSelect = vi.fn();
    render(
      <>
        <PromptChips prompts={["Run tests", "Open files"]} onSelect={onSelect} />
        <AudioMessageBubble title="Voice note" duration="0:18" />
      </>,
    );

    fireEvent.click(screen.getByText("Run tests"));
    expect(onSelect).toHaveBeenCalledWith("Run tests");

    fireEvent.click(screen.getByTitle("Play"));
    expect(screen.getByTitle("Pause")).toBeInTheDocument();
  });
});
