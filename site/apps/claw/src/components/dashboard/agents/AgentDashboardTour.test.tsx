import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentDashboardTour } from "./AgentDashboardTour";

function renderTour(overrides: Partial<React.ComponentProps<typeof AgentDashboardTour>> = {}) {
  const props: React.ComponentProps<typeof AgentDashboardTour> = {
    open: true,
    onOpenChange: vi.fn(),
    onStartCreating: vi.fn(),
    ...overrides,
  };
  render(<AgentDashboardTour {...props} />);
  return props;
}

describe("AgentDashboardTour", () => {
  it("moves through all three steps before starting the creation flow", async () => {
    const props = renderTour();

    expect(screen.getByRole("heading", { name: "Build a teammate, not another chat window." })).toHaveFocus();
    expect(screen.getByLabelText("Step 1 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Start with a purpose. Add knowledge as you go." })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Choose capacity, then put your agent to work." })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create my agent" }));
    expect(props.onStartCreating).toHaveBeenCalledOnce();
  });

  it("can skip directly to the creation flow", () => {
    const props = renderTour();

    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));

    expect(props.onStartCreating).toHaveBeenCalledOnce();
  });

  it("supports direct step navigation and dismissal", () => {
    const props = renderTour();

    fireEvent.click(screen.getByRole("button", { name: "Open tour step 3" }));
    expect(screen.getByLabelText("Step 3 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close agent tour" }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onStartCreating).not.toHaveBeenCalled();
  });
});
