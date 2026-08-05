import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { AgentEmptyHistory } from "./AgentEmptyHistory";

describe("AgentEmptyHistory", () => {
  it("introduces the agent and fills a hello prompt", async () => {
    const user = userEvent.setup();
    const onPromptSelect = vi.fn();

    renderWithClient(
      <AgentEmptyHistory
        onPromptSelect={onPromptSelect}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Meet your new AI teammate." });
    expect(heading).toBeInTheDocument();
    expect(heading.closest("section")).toHaveClass("agent-empty-history", "w-full", "max-w-[44rem]");
    expect(heading.closest("section")).not.toHaveClass("max-h-full");
    expect(screen.getByText(/getting to know each other/i)).toBeInTheDocument();
    const sayHello = screen.getByRole("button", { name: "Say hello" });
    expect(sayHello).toHaveClass("bg-[var(--button-primary,var(--primary))]");

    await user.click(sayHello);
    expect(onPromptSelect).toHaveBeenCalledWith(
      "Hi! Let's spend a few minutes getting to know each other. Ask me one question at a time to learn how I work and where you can help most.",
    );
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
    expect(screen.getByRole("button", { name: /open integrations/i })).toHaveTextContent("Browse integrations");
    expect(screen.getByText(/apps, APIs, and accounts/i)).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Make It Yours",
      "Uses Your Tools",
      "Empower Your Team",
      "Works Where You Work",
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
