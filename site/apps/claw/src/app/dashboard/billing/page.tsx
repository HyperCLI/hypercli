"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  InvoiceSummaryCard,
  ReceiptList,
  type ReceiptRecord,
} from "@hypercli/shared-ui";
import { useAgentAuth } from "@/hooks/useAgentAuth";

import {
  getAgentBillingProfile,
  getAgentPayments,
  resolveAgentPaymentPlanId,
  updateAgentBillingProfile,
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

export default function BillingPage() {
  const { getToken } = useAgentAuth();
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [billingProfile, setBillingProfile] = useState<AgentBillingProfileFields>({
    billing_name: "",
    billing_company: "",
    billing_tax_id: "",
    billing_line1: "",
    billing_line2: "",
    billing_city: "",
    billing_state: "",
    billing_postal_code: "",
    billing_country: "",
  });
  const [companyLines, setCompanyLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const [data, profile] = await Promise.all([
          getAgentPayments(token),
          getAgentBillingProfile(token),
        ]);
        if (!cancelled) {
          setReceipts(data.items.map(mapPayment));
          setCompanyLines([
            ...(profile.company_billing?.address || []),
            profile.company_billing?.email || "support@hypercli.com",
          ]);
          setBillingProfile({
            billing_name: profile.profile?.billing_name ?? "",
            billing_company: profile.profile?.billing_company ?? "",
            billing_tax_id: profile.profile?.billing_tax_id ?? "",
            billing_line1: profile.profile?.billing_line1 ?? "",
            billing_line2: profile.profile?.billing_line2 ?? "",
            billing_city: profile.profile?.billing_city ?? "",
            billing_state: profile.profile?.billing_state ?? "",
            billing_postal_code: profile.profile?.billing_postal_code ?? "",
            billing_country: profile.profile?.billing_country ?? "",
          });
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

  const updateField = (field: keyof AgentBillingProfileFields, value: string) => {
    setBillingProfile((current) => ({ ...current, [field]: value }));
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    setSaveMessage(null);
    setError(null);
    try {
      const token = await getToken();
      const result = await updateAgentBillingProfile(token, billingProfile);
      setBillingProfile({
        billing_name: result.profile?.billing_name ?? "",
        billing_company: result.profile?.billing_company ?? "",
        billing_tax_id: result.profile?.billing_tax_id ?? "",
        billing_line1: result.profile?.billing_line1 ?? "",
        billing_line2: result.profile?.billing_line2 ?? "",
        billing_city: result.profile?.billing_city ?? "",
        billing_state: result.profile?.billing_state ?? "",
        billing_postal_code: result.profile?.billing_postal_code ?? "",
        billing_country: result.profile?.billing_country ?? "",
      });
      setCompanyLines([
        ...(result.company_billing?.address || []),
        result.company_billing?.email || "support@hypercli.com",
      ]);
      setSaveMessage(
        result.synced_stripe_customer_ids?.length
          ? `Saved and synced ${result.synced_stripe_customer_ids.length} Stripe customer${result.synced_stripe_customer_ids.length === 1 ? "" : "s"}.`
          : "Saved.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save billing profile");
    } finally {
      setSaving(false);
    }
  };

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
          Receipts for recurring subscriptions, direct entitlements, and onchain payments.
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
          description="Stripe recurring subscription charges and renewals."
        />
        <InvoiceSummaryCard
          label="x402"
          value={String(x402Count)}
          description="Onchain USDC payments that mint direct entitlements on Base."
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
        <section className="rounded-2xl border border-border bg-surface-low p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Billing details</h2>
            <p className="mt-1 text-sm text-text-secondary">
              These lines appear on Agents receipts and are synced to Stripe customers for future invoices.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="text-text-secondary">Legal name</span>
              <input className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground" value={billingProfile.billing_name ?? ""} onChange={(event) => updateField("billing_name", event.target.value)} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-text-secondary">Company</span>
              <input className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground" value={billingProfile.billing_company ?? ""} onChange={(event) => updateField("billing_company", event.target.value)} />
            </label>
            <label className="space-y-2 text-sm md:col-span-2">
              <span className="text-text-secondary">Tax ID</span>
              <input className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground" value={billingProfile.billing_tax_id ?? ""} onChange={(event) => updateField("billing_tax_id", event.target.value)} />
            </label>
            <label className="space-y-2 text-sm md:col-span-2">
              <span className="text-text-secondary">Address line 1</span>
              <input className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground" value={billingProfile.billing_line1 ?? ""} onChange={(event) => updateField("billing_line1", event.target.value)} />
            </label>
            <label className="space-y-2 text-sm md:col-span-2">
              <span className="text-text-secondary">Address line 2</span>
              <input className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground" value={billingProfile.billing_line2 ?? ""} onChange={(event) => updateField("billing_line2", event.target.value)} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-text-secondary">City</span>
              <input className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground" value={billingProfile.billing_city ?? ""} onChange={(event) => updateField("billing_city", event.target.value)} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-text-secondary">State / region</span>
              <input className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground" value={billingProfile.billing_state ?? ""} onChange={(event) => updateField("billing_state", event.target.value)} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-text-secondary">Postal code</span>
              <input className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground" value={billingProfile.billing_postal_code ?? ""} onChange={(event) => updateField("billing_postal_code", event.target.value)} />
            </label>
            <label className="space-y-2 text-sm">
              <span className="text-text-secondary">Country</span>
              <input className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground" value={billingProfile.billing_country ?? ""} onChange={(event) => updateField("billing_country", event.target.value)} />
            </label>
          </div>
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={handleSaveProfile}
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save billing details"}
            </button>
            {saveMessage ? <span className="text-sm text-[#38D39F]">{saveMessage}</span> : null}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-surface-low p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Invoice sender</h2>
            <p className="mt-1 text-sm text-text-secondary">
              These lines appear in the “Receipt from” block.
            </p>
          </div>
          <div className="space-y-1 text-sm leading-7 text-foreground">
            {companyLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </section>
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
          emptyDescription="Completed recurring and direct entitlement payments will appear here."
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
                {paymentMethod === "x402" ? "Onchain USDC entitlement receipt" : "Recurring subscription receipt"}
              </p>
            );
          }}
        />
      )}
    </div>
  );
}
