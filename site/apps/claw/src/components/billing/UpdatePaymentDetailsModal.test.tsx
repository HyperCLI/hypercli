import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UpdatePaymentDetailsModal } from "./UpdatePaymentDetailsModal";

describe("UpdatePaymentDetailsModal", () => {
  it("renders editable payment fields and submits values", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn();

    render(
      <UpdatePaymentDetailsModal
        isOpen
        initialValues={{ email: "john@example.com" }}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Update payment details" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name on Card"), "John Smith");
    await user.type(screen.getByLabelText("Card Number"), "4242 4242 4242 4242");
    await user.type(screen.getByLabelText("Expiration date"), "12 / 30");
    await user.type(screen.getByLabelText("Security code"), "123");
    await user.type(screen.getByLabelText("ZIP code"), "94105");
    await user.click(screen.getByLabelText(/accept terms and conditions/i));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          nameOnCard: "John Smith",
          email: "john@example.com",
          cardNumber: "4242 4242 4242 4242",
          expirationDate: "12 / 30",
          securityCode: "123",
          country: "United States",
          zipCode: "94105",
          acceptedTerms: true,
        }),
      );
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not render when closed", () => {
    render(<UpdatePaymentDetailsModal isOpen={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog", { name: "Update payment details" })).not.toBeInTheDocument();
  });
});
