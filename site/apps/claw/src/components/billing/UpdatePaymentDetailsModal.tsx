"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface UpdatePaymentDetailsValues {
  nameOnCard: string;
  email: string;
  cardNumber: string;
  expirationDate: string;
  securityCode: string;
  country: string;
  zipCode: string;
  acceptedTerms: boolean;
}

interface UpdatePaymentDetailsModalProps {
  initialValues?: Partial<UpdatePaymentDetailsValues>;
  isOpen: boolean;
  onClose: () => void;
  onSubmit?: (values: UpdatePaymentDetailsValues) => void | Promise<void>;
}

const DEFAULT_VALUES: UpdatePaymentDetailsValues = {
  nameOnCard: "",
  email: "",
  cardNumber: "",
  expirationDate: "",
  securityCode: "",
  country: "United States",
  zipCode: "",
  acceptedTerms: false,
};

export function UpdatePaymentDetailsModal({ isOpen, ...contentProps }: UpdatePaymentDetailsModalProps) {
  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(<UpdatePaymentDetailsModalContent {...contentProps} />, document.body);
}

function UpdatePaymentDetailsModalContent({
  initialValues,
  onClose,
  onSubmit,
}: Omit<UpdatePaymentDetailsModalProps, "isOpen">) {
  const titleId = useId();
  const descriptionId = useId();
  const [values, setValues] = useState<UpdatePaymentDetailsValues>(() => ({
    ...DEFAULT_VALUES,
    ...initialValues,
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setValues({ ...DEFAULT_VALUES, ...initialValues });
  }, [initialValues]);

  const setField = <Key extends keyof UpdatePaymentDetailsValues>(
    key: Key,
    value: UpdatePaymentDetailsValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit?.(values);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <form
        className="w-full max-w-[520px] overflow-hidden rounded-[10px] border border-border bg-surface text-foreground shadow-2xl"
        onSubmit={(event) => { void handleSubmit(event); }}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold leading-6 text-foreground">
            Update payment details
          </h2>
          <p id={descriptionId} className="sr-only">
            Update the card and billing details used for future renewals.
          </p>
          <button
            type="button"
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-6 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledInput
              label="Name on Card"
              name="nameOnCard"
              placeholder="Jane Doe"
              value={values.nameOnCard}
              onChange={(value) => setField("nameOnCard", value)}
            />
            <LabeledInput
              label="Email"
              name="email"
              placeholder="you@company.com"
              type="email"
              value={values.email}
              onChange={(value) => setField("email", value)}
            />
          </div>

          <LabeledInput
            label="Card Number"
            name="cardNumber"
            placeholder="1234 1234 1234 1234"
            value={values.cardNumber}
            onChange={(value) => setField("cardNumber", value)}
            trailing={<span className="text-[10px] font-semibold text-text-muted">MC VISA AMEX</span>}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <LabeledInput
              label="Expiration date"
              name="expirationDate"
              placeholder="MM / YY"
              value={values.expirationDate}
              onChange={(value) => setField("expirationDate", value)}
            />
            <LabeledInput
              label="Security code"
              name="securityCode"
              placeholder="CVV"
              value={values.securityCode}
              onChange={(value) => setField("securityCode", value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-foreground">
              Country
              <select
                name="country"
                value={values.country}
                onChange={(event) => setField("country", event.target.value)}
                className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-[var(--selection-accent)]"
              >
                <option>United States</option>
                <option>Canada</option>
                <option>United Kingdom</option>
                <option>Mexico</option>
              </select>
            </label>
            <LabeledInput
              label="ZIP code"
              name="zipCode"
              placeholder="12345"
              value={values.zipCode}
              onChange={(value) => setField("zipCode", value)}
            />
          </div>

          <label className="flex items-start gap-3 text-sm text-foreground">
            <input
              checked={values.acceptedTerms}
              name="acceptedTerms"
              type="checkbox"
              onChange={(event) => setField("acceptedTerms", event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border bg-background"
            />
            <span>
              <span className="block font-medium">Accept terms and conditions</span>
              <span className="mt-1 block text-xs leading-5 text-text-muted">
                Your plan will auto-renew each month at the current price per agent.
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-border bg-background/40 px-5 py-4">
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface-low"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Confirming..." : "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}

function LabeledInput({
  label,
  name,
  onChange,
  placeholder,
  trailing,
  type = "text",
  value,
}: {
  label: string;
  name: string;
  onChange: (value: string) => void;
  placeholder?: string;
  trailing?: ReactNode;
  type?: string;
  value: string;
}) {
  const inputId = useId();

  return (
    <div className="block text-sm font-medium text-foreground">
      <label htmlFor={inputId}>
      {label}
      </label>
      <span className="relative mt-2 block">
        <input
          id={inputId}
          name={name}
          placeholder={placeholder}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-[var(--selection-accent)] ${
            trailing ? "pr-24" : ""
          }`}
        />
        {trailing ? <span className="absolute right-3 top-1/2 -translate-y-1/2">{trailing}</span> : null}
      </span>
    </div>
  );
}
