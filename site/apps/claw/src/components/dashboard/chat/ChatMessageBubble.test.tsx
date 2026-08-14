import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@hypercli/shared-ui", async () => ({
  ...(await import("../../../../../../packages/shared-ui/src/components/ui/tooltip")),
  RecoveryDetails: (await import("../../../../../../packages/shared-ui/src/components/patterns/recovery")).RecoveryDetails,
}));

vi.mock("@hypercli/shared-ui/files", async () => {
  const fileTypes = await import("../../../../../../packages/shared-ui/src/files/file-types");
  return {
    ...fileTypes,
    formatFileSize: (bytes?: number) => bytes === undefined ? "" : `${bytes} B`,
  };
});

import { ChatMessageBubble } from "./ChatMessageBubble";

describe("modular ChatMessageBubble system notices", () => {
  it("uses neutral styling for stopped replies", () => {
    const { container } = render(
      <ChatMessageBubble message={{ role: "system", content: "Reply stopped" }} />,
    );

    expect(screen.getByRole("status", { name: "Reply stopped" })).toHaveClass(
      "border-border",
      "bg-surface-low/70",
      "text-text-muted",
    );
    expect(container.innerHTML).not.toContain("destructive");
  });

  it("hides technical provider errors behind calm amber copy", () => {
    const rawProviderError = "Error: upstream provider statusCode=502 requestId=req-private";
    const { container } = render(
      <ChatMessageBubble message={{ role: "system", content: rawProviderError }} />,
    );

    const notice = screen.getByRole("status", { name: "Reply needs attention" });
    expect(notice).toHaveTextContent("This reply did not finish. Try again when you're ready.");
    expect(notice).toHaveClass("border-warning/30", "bg-warning/10", "text-text-secondary");
    expect(container).not.toHaveTextContent(rawProviderError);
    expect(container.innerHTML).not.toContain("destructive");
  });
});
