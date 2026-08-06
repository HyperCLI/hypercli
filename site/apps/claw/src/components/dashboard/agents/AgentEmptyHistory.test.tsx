import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import {
  AgentEmptyHistory,
  RETURNING_AGENT_SALUTATIONS,
  returningAgentSalutation,
} from "./AgentEmptyHistory";

describe("AgentEmptyHistory", () => {
  it("uses the standard new-session salutation", () => {
    renderWithClient(
      <AgentEmptyHistory
        userName="Sam Rivera"
      />,
    );

    const heading = screen.getByRole("heading", { name: "What are we working on today, Sam?" });
    expect(heading).toBeInTheDocument();
    expect(heading.closest("section")).toHaveClass("agent-empty-history", "w-full", "max-w-[44rem]");
    expect(heading.closest("section")).not.toHaveClass("max-h-full");
    expect(screen.queryByRole("heading", { name: "Meet your new AI teammate." })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Say hello" })).not.toBeInTheDocument();
    expect(screen.queryByText(/getting to know each other/i)).not.toBeInTheDocument();
  });

  it("offers ten personalized salutations for new returning sessions", () => {
    expect(RETURNING_AGENT_SALUTATIONS).toHaveLength(10);

    const salutation = returningAgentSalutation(
      "dashboard:019789ab-cdef-4abc-8def-0123456789ab",
      "Sam Rivera",
    );
    expect(RETURNING_AGENT_SALUTATIONS.some((candidate) => salutation === `${candidate}, Sam?`)).toBe(true);
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
