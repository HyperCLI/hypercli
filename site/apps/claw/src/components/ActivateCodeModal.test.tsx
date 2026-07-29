import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActivateCodeModal } from "./ActivateCodeModal";

describe("ActivateCodeModal", () => {
  it("submits the entered code through the activation form", async () => {
    const onSubmit = vi.fn(async () => undefined);

    render(
      <ActivateCodeModal
        isOpen
        processing={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Activation code"), { target: { value: " promo-123 " } });
    fireEvent.click(screen.getByRole("button", { name: "Activate Code" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(" promo-123 ");
  });

  it("associates activation errors with the code field", () => {
    render(
      <ActivateCodeModal
        isOpen
        processing={false}
        error="This code is no longer valid."
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Activate a code" })).toBeInTheDocument();
    expect(screen.getByLabelText("Activation code")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("This code is no longer valid.");
  });

  it("uses the close control as the only dismissal path", () => {
    const onClose = vi.fn();

    render(
      <ActivateCodeModal
        isOpen
        processing={false}
        error={null}
        onClose={onClose}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close activation dialog" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open and disables actions while activation is processing", () => {
    const onClose = vi.fn();

    render(
      <ActivateCodeModal
        isOpen
        processing
        error={null}
        onClose={onClose}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByLabelText("Activation code")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Activating..." })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close activation dialog" }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Activate a code" })).toBeInTheDocument();
  });
});
