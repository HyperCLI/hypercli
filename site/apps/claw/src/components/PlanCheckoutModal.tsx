"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, CreditCard, Coins, Copy, Check, AlertTriangle } from "lucide-react";
import { clawFetch, CLAW_API_BASE } from "@/lib/api";

interface Plan {
  id: string;
  name: string;
  price: number;
  aiu: number;
  tpm_limit: number;
  rpm_limit: number;
  features: string[];
}

interface PlanCheckoutModalProps {
  plan: Plan;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  getToken: () => Promise<string>;
}

type PaymentMethod = "card" | "crypto";

export function PlanCheckoutModal({
  plan,
  isOpen,
  onClose,
  onSuccess,
  getToken,
}: PlanCheckoutModalProps) {
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  const handleClose = () => {
    if (processing) return;
    setError(null);
    setSuccess(false);
    setMethod("card");
    setGeneratedKey(null);
    setKeyCopied(false);
    onClose();
  };

  const handleCard = async () => {
    setProcessing(true);
    setError(null);
    try {
      const token = await getToken();
      const data = await clawFetch<{ checkout_url: string }>(
        "/stripe/checkout",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            plan_id: plan.id,
            success_url: `${window.location.origin}/dashboard/plans?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${window.location.origin}/dashboard/plans?cancelled=true`,
          }),
        }
      );
      window.location.href = data.checkout_url;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create checkout session"
      );
      setProcessing(false);
    }
  };

  const handleCrypto = async () => {
    setProcessing(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await clawFetch<{ ok?: boolean; plan_id?: string }>(
        `/x402/${plan.id}`,
        token,
        { method: "POST" }
      );

      if (!res?.ok) {
        // 402 or incomplete — x402 payment was not attached
        setError(
          "USDC payment requires an x402-compatible client. Use the CLI or SDK to subscribe with crypto."
        );
        return;
      }

      // Subscription activated — generate an API key
      try {
        const keyData = await clawFetch<{ key: string; key_alias: string }>(
          "/keys",
          token,
          {
            method: "POST",
            body: JSON.stringify({ key_alias: `${plan.id}-key` }),
          }
        );
        if (keyData?.key) {
          setGeneratedKey(keyData.key);
        }
      } catch {
        // Key generation optional — plan is still active
      }

      setSuccess(true);
      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Payment failed"
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleSubmit = () => {
    if (method === "card") handleCard();
    else handleCrypto();
  };

  const copyKey = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 2000);
  };

  if (!isOpen) return null;

  const fmtLimit = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);

  const modal = (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
      onClick={handleClose}
    >
      <div
        className="glass-card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-foreground">
              Subscribe to {plan.name}
            </h2>
            <button
              onClick={handleClose}
              disabled={processing}
              className="text-text-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {success ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-[#38D39F]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Subscription Active!
              </h3>
              <p className="text-text-secondary mb-4">
                Your {plan.name} plan is now active.
              </p>

              {generatedKey && (
                <div className="mt-4 text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-medium text-amber-400">
                      Save your API key now
                    </span>
                  </div>
                  <p className="text-xs text-text-muted mb-3">
                    This key will not be displayed again. Copy it and store it
                    securely.
                  </p>
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-low border border-white/10 font-mono text-sm break-all">
                    <span className="flex-1 text-foreground select-all">
                      {generatedKey}
                    </span>
                    <button
                      onClick={copyKey}
                      className="flex-shrink-0 p-1.5 rounded hover:bg-white/10 transition-colors"
                    >
                      {keyCopied ? (
                        <Check className="w-4 h-4 text-primary" />
                      ) : (
                        <Copy className="w-4 h-4 text-text-muted" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Plan summary */}
              <div className="p-4 rounded-lg bg-surface-low/50 border border-white/5 mb-6">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-foreground font-medium">
                    {plan.name}
                  </span>
                  <span className="text-foreground font-bold">
                    ${plan.price}
                    <span className="text-text-muted text-sm font-normal">
                      /mo
                    </span>
                  </span>
                </div>
                <p className="text-sm text-text-tertiary">
                  {plan.aiu} AIU &middot; {fmtLimit(plan.tpm_limit)} TPM
                  &middot; {fmtLimit(plan.rpm_limit)} RPM
                </p>
              </div>

              {/* Payment method */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-foreground mb-3">
                  Payment Method
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setMethod("card")}
                    disabled={processing}
                    className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${
                      method === "card"
                        ? "border-[#38D39F]/60 bg-[#38D39F]/10"
                        : "border-white/10 hover:border-white/20"
                    } disabled:opacity-50`}
                  >
                    <CreditCard className="w-5 h-5 text-foreground" />
                    <div className="text-sm font-medium text-foreground">
                      Credit Card
                    </div>
                    <div className="text-xs text-text-muted">Stripe</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod("crypto")}
                    disabled={processing}
                    className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${
                      method === "crypto"
                        ? "border-[#38D39F]/60 bg-[#38D39F]/10"
                        : "border-white/10 hover:border-white/20"
                    } disabled:opacity-50`}
                  >
                    <Coins className="w-5 h-5 text-foreground" />
                    <div className="text-sm font-medium text-foreground">
                      USDC
                    </div>
                    <div className="text-xs text-text-muted">x402</div>
                  </button>
                </div>
              </div>

              {/* Crypto info */}
              {method === "crypto" && (
                <div className="mb-4 p-3 rounded-lg bg-surface-low/50 border border-white/5 text-sm text-text-secondary">
                  <p className="mb-1">
                    Pay <span className="text-foreground font-medium">${plan.price} USDC</span> on Base via the x402 protocol.
                  </p>
                  <p className="text-xs text-text-muted">
                    Your wallet key will not be stored anywhere on our servers.
                  </p>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mb-4 p-3 rounded-lg bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-sm text-[#d05f5f]">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={processing}
                className="w-full py-3 rounded-lg text-sm font-semibold btn-primary disabled:opacity-50"
              >
                {processing
                  ? "Processing..."
                  : `Pay $${plan.price} with ${method === "card" ? "Card" : "USDC"}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return typeof window !== "undefined"
    ? createPortal(modal, document.body)
    : null;
}
