import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLAW_TOOLTIP_DELAY_MS, Tooltip, TooltipContent, TooltipTrigger } from "./ClawTooltip";

describe("ClawTooltip", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the green Claw treatment after a 1.5 second hover delay", () => {
    vi.useFakeTimers();
    render(
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button type="button">Show details</button>
        </TooltipTrigger>
        <TooltipContent>Delayed details</TooltipContent>
      </Tooltip>,
    );

    fireEvent.pointerMove(screen.getByRole("button", { name: "Show details" }), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(CLAW_TOOLTIP_DELAY_MS - 1));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Delayed details");
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveStyle({
      backgroundColor: "var(--selection-accent)",
      color: "var(--selection-accent-foreground)",
    });
  });
});
