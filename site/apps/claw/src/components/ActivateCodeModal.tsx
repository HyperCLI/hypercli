"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Gift, Ticket, X } from "lucide-react";

interface ActivateCodeModalProps {
  isOpen: boolean;
  processing: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (code: string) => Promise<void>;
}

export function ActivateCodeModal({
  isOpen,
  processing,
  error,
  onClose,
  onSubmit,
}: ActivateCodeModalProps) {
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setCode("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (processing) return;
    onClose();
  };

  const handleSubmit = async () => {
    await onSubmit(code);
  };

  const modal = (
    <div
      className="fixed inset-0 z-[9999] bg-background/70 backdrop-blur-md"
      onClick={handleClose}
    >
      <div className="flex h-full w-full items-stretch justify-center p-0 sm:p-4">
        <div
          className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden border border-border bg-background-secondary shadow-2xl sm:rounded-[28px]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgb(var(--selection-accent-rgb)_/_0.16),_transparent_42%)]" />
          <div className="relative flex items-center justify-between border-b border-border px-6 py-5 sm:px-8">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-[var(--selection-accent)]">Promo Code</p>
              <h2 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">Activate a Code</h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={processing}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-text-muted transition hover:border-border-strong hover:text-foreground disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="relative flex flex-1 flex-col justify-between gap-8 overflow-y-auto px-6 py-8 sm:px-8 sm:py-10 lg:flex-row lg:gap-10">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-4 py-2 text-sm text-[var(--selection-accent)]">
                <Gift className="h-4 w-4" />
                Codes apply instantly to the signed-in HyperCLI account.
              </div>
              <h3 className="mt-6 text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
                Redeem a grant without leaving the plans page.
              </h3>
              <p className="mt-4 max-w-lg text-base text-text-secondary">
                Enter a promo or grant code to add a plan-backed entitlement. After activation, the billing summary and slot inventory refresh automatically.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-border bg-surface-low/60 p-4">
                  <p className="text-sm font-medium text-foreground">What changes</p>
                  <p className="mt-2 text-sm text-text-secondary">Your active entitlement set, pooled inference budget, and slot inventory update immediately after a valid redemption.</p>
                </div>
                <div className="rounded-2xl border border-border bg-surface-low/60 p-4">
                  <p className="text-sm font-medium text-foreground">Who receives it</p>
                  <p className="mt-2 text-sm text-text-secondary">The currently signed-in HyperCLI account. Codes are not shared across users or teams after redemption.</p>
                </div>
              </div>
            </div>

            <div className="w-full max-w-xl rounded-[28px] border border-border bg-surface-low/70 p-6 sm:p-8">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-[var(--selection-accent)]">
                  <Ticket className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Code Entry</p>
                  <p className="text-sm text-text-secondary">Paste the full activation code exactly as issued.</p>
                </div>
              </div>

              <label className="block text-sm font-medium text-foreground">
                Activation code
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void handleSubmit();
                    }
                  }}
                  placeholder="Enter activation code"
                  autoCapitalize="characters"
                  autoFocus
                  className="mt-3 w-full rounded-2xl border border-border bg-background/70 px-4 py-4 text-base text-foreground outline-none transition focus:border-[var(--selection-accent)]"
                />
              </label>

              {error && (
                <div className="mt-4 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={processing}
                  className="btn-secondary rounded-xl px-5 py-3 text-sm font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={processing}
                  className="btn-primary rounded-xl px-5 py-3 text-sm font-medium disabled:opacity-50"
                >
                  {processing ? "Activating..." : "Activate Code"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
