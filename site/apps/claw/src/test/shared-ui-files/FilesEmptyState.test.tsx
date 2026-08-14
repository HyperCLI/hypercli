import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilesEmptyState } from "@hypercli/shared-ui/files";

describe("FilesEmptyState", () => {
  it("leads with recovery while keeping bounded technical detail closed", () => {
    const onRetry = vi.fn();
    render(
      <FilesEmptyState
        kind="error"
        errorMessage={`token=folder-secret ${"x".repeat(900)}`}
        onRetry={onRetry}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Try again to load this folder");
    expect(status).toHaveTextContent("Your workspace is unchanged");
    expect(screen.queryByText(/folder-secret/)).not.toBeInTheDocument();

    fireEvent.click(within(status).getByRole("button", { name: "Technical details" }));
    const details = within(status).getByText(/token=\[redacted\]/);
    expect(details.textContent?.length).toBeLessThanOrEqual(603);
    expect(status).not.toHaveTextContent("folder-secret");

    fireEvent.click(within(status).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
