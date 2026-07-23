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
});
