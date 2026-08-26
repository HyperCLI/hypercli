import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentTokenUsage, DailyTokenLimitDialog, resolveAgentTokenUsage } from "./AgentTokenUsage";

describe("resolveAgentTokenUsage", () => {
  it("derives the normal, approaching, and reached boundaries", () => {
    expect(resolveAgentTokenUsage(7_999, 10_000).state).toBe("normal");
    expect(resolveAgentTokenUsage(8_000, 10_000).state).toBe("approaching");
    expect(resolveAgentTokenUsage(10_000, 10_000).state).toBe("reached");
    expect(resolveAgentTokenUsage(12_000, 10_000).progress).toBe(100);
  });

  it("keeps missing and invalid data neutral", () => {
    expect(resolveAgentTokenUsage(null, 10_000)).toMatchObject({ state: "unavailable", label: "-- / 10K" });
    expect(resolveAgentTokenUsage(1_000, Number.NaN)).toMatchObject({ state: "unavailable", label: "1K / --" });
  });
});

describe("AgentTokenUsage", () => {
  it("keeps normal usage calm and free of reset messaging", () => {
    const onUpgrade = vi.fn();
    render(<AgentTokenUsage tokenUsed={8_000_000} tokenLimit={25_000_000} onUpgrade={onUpgrade} />);

    expect(screen.getByTestId("agent-token-usage")).toHaveTextContent("8M / 25M");
    expect(screen.getByTestId("agent-token-usage-panel")).toHaveAttribute("data-token-usage-state", "normal");
    expect(screen.queryByText(/resets/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/near daily limit|daily limit reached/i)).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Daily token usage" })).toHaveAttribute("aria-valuenow", "8000000");

    fireEvent.click(screen.getByRole("button", { name: "Upgrade" }));
    expect(onUpgrade).toHaveBeenCalledOnce();
  });

  it("adds awareness and a capacity action near the limit", () => {
    const onUpgrade = vi.fn();
    render(
      <AgentTokenUsage
        tokenUsed={20_000_000}
        tokenLimit={25_000_000}
        capacityActionLabel="Add capacity"
        onUpgrade={onUpgrade}
      />,
    );

    expect(screen.getByTestId("agent-token-usage-panel")).toHaveAttribute("data-token-usage-state", "approaching");
    expect(screen.getByText("Near daily limit")).toBeInTheDocument();
    expect(screen.getByText("Resets 00:00 UTC")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Daily token usage" }).firstElementChild).toHaveClass("bg-warning");
    expect(screen.getByRole("button", { name: "Add capacity" })).toHaveClass("btn-primary");
  });

  it("caps exhausted usage and communicates the reached state without color alone", () => {
    render(<AgentTokenUsage tokenUsed={30_000_000} tokenLimit={25_000_000} capacityActionLabel="Add capacity" onUpgrade={vi.fn()} />);

    expect(screen.getByTestId("agent-token-usage")).toHaveTextContent("30M / 25M");
    expect(screen.getByText("Daily limit reached")).toBeInTheDocument();
    const progress = screen.getByRole("progressbar", { name: "Daily token usage" });
    expect(progress).toHaveAttribute("aria-valuenow", "25000000");
    expect(progress).toHaveAttribute("aria-valuetext", "30M / 25M. Daily limit reached.");
    expect(progress.firstElementChild).toHaveClass("bg-destructive");
    expect(progress.firstElementChild).toHaveStyle({ width: "100%" });
  });

  it("prioritizes adding capacity over trial management after an active trial is exhausted", () => {
    const onUpgrade = vi.fn();
    const onManageTrial = vi.fn();
    render(
      <AgentTokenUsage
        tokenUsed={25_000_000}
        tokenLimit={25_000_000}
        activeTrial={{
          subscriptionId: "sub-team",
          planId: "team",
          planName: "Team",
          endsAt: new Date("2026-08-30T00:00:00Z"),
          totalDays: 7,
          secondsRemaining: 86_400,
          timeRemainingLabel: "1 day left",
        }}
        capacityActionLabel="Add capacity"
        onUpgrade={onUpgrade}
        onManageTrial={onManageTrial}
      />,
    );

    expect(screen.queryByRole("button", { name: "Manage trial" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add capacity" }));
    expect(onUpgrade).toHaveBeenCalledOnce();
    expect(onManageTrial).not.toHaveBeenCalled();
  });

  it("distinguishes collapsed warning states without relying on color", () => {
    const { rerender } = render(
      <AgentTokenUsage collapsed tokenUsed={20_000_000} tokenLimit={25_000_000} onUpgrade={vi.fn()} />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/daily token limit is near.*resets at 00:00 UTC/i);
    expect(screen.getByTestId("token-usage-state-icon")).toHaveClass("lucide-gauge");

    rerender(<AgentTokenUsage collapsed tokenUsed={25_000_000} tokenLimit={25_000_000} onUpgrade={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/daily token limit reached.*resets at 00:00 UTC/i);
    expect(screen.getByTestId("token-usage-state-icon")).toHaveClass("lucide-circle-alert");
  });
});

describe("DailyTokenLimitDialog", () => {
  it("explains the block, preserves waiting as an option, and opens the relevant capacity action", () => {
    const onOpenChange = vi.fn();
    const onAction = vi.fn();
    render(
      <DailyTokenLimitDialog
        open
        actionLabel="Add capacity"
        onOpenChange={onOpenChange}
        onAction={onAction}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Daily token limit reached" });
    expect(within(dialog).getByText(/shared token allowance has been used for today/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/resets at 00:00 UTC/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Wait for reset" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Add capacity" }));
    expect(onAction).toHaveBeenCalledOnce();
  });
});
