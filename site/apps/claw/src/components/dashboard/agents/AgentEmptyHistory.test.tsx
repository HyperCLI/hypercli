import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithClient } from "@/test/utils";
import { AgentEmptyHistory } from "./AgentEmptyHistory";

describe("AgentEmptyHistory", () => {
  it("renders suggested prompts and fills the selected prompt", async () => {
    const user = userEvent.setup();
    const onPromptSelect = vi.fn();

    renderWithClient(
      <AgentEmptyHistory
        onPromptSelect={onPromptSelect}
      />,
    );

    expect(screen.getByRole("heading", { name: "Try these" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /unread emails/i }));
    expect(onPromptSelect).toHaveBeenCalledWith("Summarize unread emails from this morning");
  });
});
