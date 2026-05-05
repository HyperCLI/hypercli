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
      className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md"
      onClick={handleClose}
    >
      <div className="flex h-full w-full items-stretch justify-center p-0 sm:p-4">
        <div
          className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden border border-white/10 bg-[#0b0d10] shadow-2xl sm:rounded-[28px]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,211,159,0.18),_transparent_42%),linear-gradient(180deg,_rgba(255,255,255,0.02),_rgba(255,255,255,0))]" />
          <div className="relative flex items-center justify-between border-b border-white/10 px-6 py-5 sm:px-8">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-[#7ee7c0]">Promo Code</p>
              <h2 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">Activate a Code</h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={processing}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-text-muted transition hover:border-white/20 hover:text-foreground disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="relative flex flex-1 flex-col justify-between gap-8 overflow-y-auto px-6 py-8 sm:px-8 sm:py-10 lg:flex-row lg:gap-10">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#38D39F]/20 bg-[#38D39F]/10 px-4 py-2 text-sm text-[#b7f5df]">
                <Gift className="h-4 w-4" />
                Codes apply instantly to the signed-in HyperClaw account.
              </div>
              <h3 className="mt-6 text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
                Redeem a grant without leaving the plans page.
              </h3>
              <p className="mt-4 max-w-lg text-base text-text-secondary">
                Enter a promo or grant code to add a plan-backed entitlement. After activation, the billing summary and slot inventory refresh automatically.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <p className="text-sm font-medium text-foreground">What changes</p>
                  <p className="mt-2 text-sm text-text-secondary">Your active entitlement set, pooled inference budget, and slot inventory update immediately after a valid redemption.</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <p className="text-sm font-medium text-foreground">Who receives it</p>
                  <p className="mt-2 text-sm text-text-secondary">The currently signed-in HyperClaw account. Codes are not shared across users or teams after redemption.</p>
                </div>
              </div>
            </div>

            <div className="w-full max-w-xl rounded-[28px] border border-white/10 bg-black/30 p-6 sm:p-8">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#38D39F]/12 text-[#7ee7c0]">
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
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-base text-foreground outline-none transition focus:border-[#38D39F]/70"
                />
              </label>

              {error && (
                <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                  <p className="text-sm text-red-200">{error}</p>
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
