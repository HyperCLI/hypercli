import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentDashboardTour } from "./AgentDashboardTour";

function renderTour(overrides: Partial<React.ComponentProps<typeof AgentDashboardTour>> = {}) {
  const props: React.ComponentProps<typeof AgentDashboardTour> = {
    open: true,
    onOpenChange: vi.fn(),
    onSkipTour: vi.fn(),
    onCreateAccount: vi.fn(),
    ...overrides,
  };
  render(<AgentDashboardTour {...props} />);
  return props;
}

describe("AgentDashboardTour", () => {
  it("moves through all three steps before opening account creation", async () => {
    const props = renderTour();

    expect(screen.getByRole("heading", { name: "Build a teammate, not another chat window." })).toHaveFocus();
    expect(screen.getByLabelText("Step 1 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Start with a purpose. Add knowledge as you go." })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Choose capacity, then put your agent to work." })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create my account" }));
    expect(props.onCreateAccount).toHaveBeenCalledOnce();
    expect(props.onSkipTour).not.toHaveBeenCalled();
  });

  it("hands Skip tour to the dashboard without opening account creation", () => {
    const props = renderTour();

    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));

    expect(props.onSkipTour).toHaveBeenCalledOnce();
    expect(props.onCreateAccount).not.toHaveBeenCalled();
  });

  it("supports direct step navigation and dismissal", () => {
    const props = renderTour();

    fireEvent.click(screen.getByRole("button", { name: "Open tour step 3" }));
    expect(screen.getByLabelText("Step 3 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close agent tour" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onSkipTour).not.toHaveBeenCalled();
    expect(props.onCreateAccount).not.toHaveBeenCalled();
  });
});
