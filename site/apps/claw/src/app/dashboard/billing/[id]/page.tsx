"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ReceiptDetailCard,
  type ReceiptRecord,
} from "@hypercli/shared-ui";
import { useAgentAuth } from "@/hooks/useAgentAuth";

import {
  getAgentBillingProfile,
  getAgentPayment,
  resolveAgentPaymentPlanId,
  type AgentBillingProfileFields,
  type AgentPayment,
} from "@/lib/billing";

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
      plan_id: resolveAgentPaymentPlanId(payment),
      provider: payment.provider,
    },
  };
}

export default function BillingDetailPage() {
  const { getToken } = useAgentAuth();
  const params = useParams<{ id: string }>();
  const [receipt, setReceipt] = useState<ReceiptRecord | null>(null);
  const [fromLines, setFromLines] = useState<string[]>([
    "HyperCLI Agents",
    "Agents billing",
    "support@hypercli.com",
  ]);
  const [paidByLines, setPaidByLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const [payment, billing] = await Promise.all([
          getAgentPayment(token, params.id),
          getAgentBillingProfile(token),
        ]);
        if (cancelled) {
          return;
        }

        const nextReceipt = mapPayment(payment);
        const profile: AgentBillingProfileFields | null = billing.profile;
        const supportEmail = billing.company_billing?.email || "support@hypercli.com";
        const locality = [
          profile?.billing_city,
          profile?.billing_state,
          profile?.billing_postal_code,
        ].filter(Boolean).join(", ");
        const nextPaidByLines = [
          profile?.billing_company || profile?.billing_name || payment.user?.email || "Authenticated Agents account",
          profile?.billing_company && profile?.billing_name ? profile.billing_name : null,
          profile?.billing_line1,
          profile?.billing_line2,
          locality || null,
          profile?.billing_country,
          profile?.billing_tax_id ? `Tax ID: ${profile.billing_tax_id}` : null,
          payment.user?.email,
        ].filter(Boolean) as string[];

        setReceipt(nextReceipt);
        setPaidByLines(nextPaidByLines);
        setFromLines([
          ...(billing.company_billing?.address?.length ? billing.company_billing.address : ["HyperCLI Agents", "Agents billing"]),
          supportEmail,
        ]);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load receipt");
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
  }, [getToken, params?.id]);

  return (
    <div className="space-y-6">
      <Link href="/dashboard/billing" className="text-sm font-medium text-primary hover:underline">
        ← Back to billing
      </Link>

      {loading ? (
        <div className="rounded-lg border border-border bg-surface-low px-6 py-10 text-center text-muted-foreground">
          Loading receipt...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : receipt ? (
        <ReceiptDetailCard
          receipt={receipt}
          title="Receipt"
          formatAmount={formatAgentsAmount}
          fromLabel="Receipt from"
          fromLines={fromLines}
          paidByLabel="Paid by"
          paidByLines={paidByLines.length > 0 ? paidByLines : ["Authenticated Agents account", receipt.userId || "—"]}
          paidByMonospaceLastLine={false}
          noteTitle="Accounting note"
          noteText="This receipt reflects recurring subscription or direct entitlement billing activity. Save it as a PDF if you need a durable accounting record."
        />
      ) : (
        <div className="rounded-lg border border-border bg-surface-low px-6 py-10 text-center text-muted-foreground">
          Receipt not found.
        </div>
      )}
    </div>
  );
}
