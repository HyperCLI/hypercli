"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  InvoiceSummaryCard,
  ReceiptList,
  type ReceiptRecord,
} from "@hypercli/shared-ui";
import { useAgentAuth } from "@/hooks/useAgentAuth";

import { getAgentPayments, type AgentPayment } from "@/lib/billing";

function formatAgentsAmount(receipt: ReceiptRecord): string {
  const method = String(receipt.meta?.payment_method || "").toLowerCase();
  const raw = Number.parseFloat(receipt.amountUsd);
  if (!Number.isFinite(raw)) {
    return "$0.00";
  }
  if (method === "x402" || String(receipt.meta?.currency || "").toLowerCase() === "usdc") {
    return `${raw.toFixed(6)} USDC`;
  }
  return `$${raw.toFixed(2)}`;
}

function mapPayment(payment: AgentPayment): ReceiptRecord {
  const provider = payment.provider.toLowerCase();
  const amount =
    provider === "x402" || payment.currency.toLowerCase() === "usdc"
      ? (Number.parseFloat(payment.amount) / 1_000_000).toFixed(6)
      : (Number.parseFloat(payment.amount) / 100).toFixed(2);

  return {
    id: payment.id,
    userId: payment.user_id,
    amountUsd: amount,
    status:
      payment.status.toLowerCase() === "succeeded"
        ? "completed"
        : payment.status.toLowerCase(),
    transactionType: provider === "stripe" ? "subscription" : "x402",
    createdAt: payment.created_at ?? "",
    updatedAt: payment.updated_at ?? payment.created_at ?? "",
    meta: {
      payment_method: provider,
      currency: payment.currency,
      stripe_payment_intent: provider === "stripe" ? payment.external_payment_id : null,
      settlement_tx_hash:
        provider === "x402" && payment.external_payment_id?.startsWith("0x")
          ? payment.external_payment_id
          : null,
      wallet: payment.user?.wallet_address ?? null,
      plan_id: payment.subscription?.plan_id ?? payment.user?.plan_id ?? null,
      provider: payment.provider,
    },
  };
}

export default function BillingPage() {
  const { getToken } = useAgentAuth();
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const data = await getAgentPayments(token);
        if (!cancelled) {
          setReceipts(data.items.map(mapPayment));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load billing records");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const stripeCount = useMemo(
    () => receipts.filter((receipt) => String(receipt.meta?.payment_method) === "stripe").length,
    [receipts],
  );
  const x402Count = useMemo(
    () => receipts.filter((receipt) => String(receipt.meta?.payment_method) === "x402").length,
    [receipts],
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-foreground">Billing</h1>
        <p className="text-text-secondary">
          Receipts for Agents subscription charges and onchain payments.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <InvoiceSummaryCard
          label="Receipts"
          value={String(receipts.length)}
          description="All recorded Agents billing receipts for this account."
        />
        <InvoiceSummaryCard
          label="Credit card"
          value={String(stripeCount)}
          description="Stripe subscription payments and renewals."
        />
        <InvoiceSummaryCard
          label="x402"
          value={String(x402Count)}
          description="Onchain USDC subscription payments on Base."
        />
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-surface-low px-6 py-10 text-center text-muted-foreground">
          Loading billing records...
        </div>
      ) : (
        <ReceiptList
          receipts={receipts}
          title="Receipts"
          description="Use the receipt UUID directly in the URL for Agents billing detail views."
          emptyTitle="No receipts yet"
          emptyDescription="Completed subscription payments will appear here."
          formatAmount={formatAgentsAmount}
          renderActions={(receipt) => (
            <Link
              href={`/dashboard/billing/${receipt.id}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open
            </Link>
          )}
          renderMeta={(receipt) => {
            const paymentMethod = String(receipt.meta?.payment_method || "").toLowerCase();
            return (
              <p className="text-muted-foreground">
                {paymentMethod === "x402" ? "Onchain USDC subscription receipt" : "Subscription billing receipt"}
              </p>
            );
          }}
        />
      )}
    </div>
  );
}
