import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { AgentPrivateChatControl } from "./AgentPrivateChatControl";

describe("AgentPrivateChatControl", () => {
  it("starts and ends private chat from the same control", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { rerender } = renderWithClient(
      <AgentPrivateChatControl state="inactive" onStart={onStart} onEnd={onEnd} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start private chat" }));
    expect(onStart).toHaveBeenCalledTimes(1);

    rerender(<AgentPrivateChatControl state="active" onStart={onStart} onEnd={onEnd} />);
    const activeButton = screen.getByRole("button", { name: "End private chat" });
    expect(activeButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(activeButton);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("renders a compact disabled transition state accessibly", () => {
    renderWithClient(
      <AgentPrivateChatControl
        state="starting"
        compact
        disabledReason="Preparing private chat"
        onStart={vi.fn()}
        onEnd={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Starting private chat" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAccessibleDescription("Preparing private chat");
    expect(button).toHaveClass("disabled:cursor-wait");
    expect(button).not.toHaveAttribute("title");
    expect(screen.queryByText("Private")).not.toBeInTheDocument();
  });

  it("exposes an unpressed enabled toggle for an eligible empty new session", () => {
    renderWithClient(
      <AgentPrivateChatControl state="inactive" onStart={vi.fn()} onEnd={vi.fn()} />,
    );

    const button = screen.getByRole("button", { name: "Start private chat" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("is disabled with an accessible reason when the session is not safely empty", () => {
    renderWithClient(
      <AgentPrivateChatControl
        state="inactive"
        disabled
        disabledReason="Clear the current draft before starting a private chat"
        onStart={vi.fn()}
        onEnd={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Start private chat" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleDescription("Clear the current draft before starting a private chat");
  });

  it("routes repeated active-toggle clicks only to the deduplicated end action", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    renderWithClient(
      <AgentPrivateChatControl state="active" onStart={onStart} onEnd={onEnd} />,
    );

    const button = screen.getByRole("button", { name: "End private chat" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it("blocks interaction while a start or end transition is pending", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { rerender } = renderWithClient(
      <AgentPrivateChatControl state="starting" onStart={onStart} onEnd={onEnd} />,
    );

    const startingButton = screen.getByRole("button", { name: "Starting private chat" });
    expect(startingButton).toBeDisabled();
    expect(startingButton).toHaveAttribute("aria-busy", "true");
    fireEvent.click(startingButton);
    expect(onStart).not.toHaveBeenCalled();

    rerender(<AgentPrivateChatControl state="ending" onStart={onStart} onEnd={onEnd} />);
    const endingButton = screen.getByRole("button", { name: "Ending private chat" });
    expect(endingButton).toBeDisabled();
    expect(endingButton).toHaveAttribute("aria-busy", "true");
    expect(endingButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(endingButton);
    expect(onEnd).not.toHaveBeenCalled();
  });
});
