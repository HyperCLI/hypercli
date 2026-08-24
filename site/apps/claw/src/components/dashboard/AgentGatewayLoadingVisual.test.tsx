import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AgentGatewayErrorVisual } from "./AgentGatewayLoadingVisual";

describe("AgentGatewayErrorVisual", () => {
  it("keeps a long origin error fully visible beside fixed controls", () => {
    const onRetry = vi.fn();
    const detail = "This agent allows connections from https://agents.hypercli.com/a/very/long/unbroken/path/that/must/not/render/under/the/error/icon, but you opened it from https://agents.feat.hypercli.com. Did you create it from the other dashboard?";
    render(
      <AgentGatewayErrorVisual
        detail={detail}
        actionLabel="Retry"
        onAction={onRetry}
      />,
    );

    const alert = screen.getByRole("alert", { name: new RegExp(detail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    const message = within(alert).getByText(detail);
    expect(message).toBeVisible();
    expect(message).toHaveClass("whitespace-pre-wrap", "[overflow-wrap:anywhere]");
    expect(message).not.toHaveClass("truncate");
    expect(alert.querySelector("svg")?.closest('[aria-hidden="true"]')).not.toBeNull();

    const retry = within(alert).getByRole("button", { name: "Retry" });
    expect(retry).toBeVisible();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
