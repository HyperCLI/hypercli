import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { AgentEmptyHistory } from "./AgentEmptyHistory";

describe("AgentEmptyHistory", () => {
  it("renders existing helper prompts and fills the selected prompt", async () => {
    const user = userEvent.setup();
    const onPromptSelect = vi.fn();

    renderWithClient(
      <AgentEmptyHistory
        onPromptSelect={onPromptSelect}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Your agent is ready for real work" });
    expect(heading).toBeInTheDocument();
    expect(heading.closest("section")).toHaveClass("agent-empty-history", "max-h-full", "overflow-hidden");
    expect(screen.getByRole("heading", { name: "Start with something concrete" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /map this workspace/i }));
    expect(onPromptSelect).toHaveBeenCalledWith("Explain the current workspace or selected file in plain language.");
  });

  it("opens workspace tools through the provided actions", async () => {
    const user = userEvent.setup();
    const onOpenFiles = vi.fn();
    const onOpenIntegrations = vi.fn();
    const onOpenIntegrationChatCard = vi.fn();
    const onOpenSkills = vi.fn();
    const onOpenScheduled = vi.fn();

    renderWithClient(
      <AgentEmptyHistory
        onPromptSelect={vi.fn()}
        actions={{ onOpenFiles, onOpenIntegrations, onOpenIntegrationChatCard, onOpenSkills, onOpenScheduled }}
      />,
    );

    expect(screen.getByRole("button", { name: /connect slack/i })).toBeInTheDocument();
    expect(screen.getByText(/GitHub, Telegram, Discord, WhatsApp/i)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Build out the workspace",
      "Start with something concrete",
    ]);

    await user.click(screen.getByRole("button", { name: /connect slack/i }));
    await user.click(screen.getByRole("button", { name: /open workspace files/i }));
    await user.click(screen.getByRole("button", { name: /open integrations/i }));
    await user.click(screen.getByRole("button", { name: /open skills/i }));
    await user.click(screen.getByRole("button", { name: /open scheduled work/i }));

    expect(onOpenIntegrationChatCard).toHaveBeenCalledWith("slack");
    expect(onOpenFiles).toHaveBeenCalledTimes(1);
    expect(onOpenIntegrations).toHaveBeenCalledTimes(1);
    expect(onOpenSkills).toHaveBeenCalledTimes(1);
    expect(onOpenScheduled).toHaveBeenCalledTimes(1);
  });

  it("does not advertise workspace tools without an action", () => {
    renderWithClient(
      <AgentEmptyHistory
        onPromptSelect={vi.fn()}
        actions={{ onOpenFiles: vi.fn() }}
      />,
    );

    expect(screen.getByRole("button", { name: /open workspace files/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect slack/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open integrations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open skills/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open scheduled work/i })).not.toBeInTheDocument();
  });
});
