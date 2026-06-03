"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Loader2, Rocket } from "lucide-react";
import type { ReceiptRecord } from "@hypercli/shared-ui";
import type {
  HyperAgentEntitlement,
  HyperAgentSubscription,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";

import { createAgentClient, createHyperAgentClient } from "@/lib/agent-client";
import {
  getAgentPayments,
  resolveAgentPaymentPlanId,
  type AgentPayment,
} from "@/lib/billing";
import type { SdkAgent } from "@/types";
import {
  createPaymentMethodUpdatePortalUrl,
  openBillingPortalUrl,
} from "./stripe-billing-portal";
import { Skeleton } from "@/components/dashboard/Skeleton";

interface ProfileBillingSectionProps {
  getToken: () => Promise<string>;
}

interface BillingLoadResult {
  payments: AgentPayment[];
  summary: HyperAgentSubscriptionSummary | null;
  agentsById: Record<string, string>;
}

interface PaymentAttribution {
  agentIds: string[];
  agentLabels: string[];
  tags: string[];
}

const BILLING_SECONDARY_BUTTON_CLASS =
  "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground transition-colors hover:bg-surface-low disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const BILLING_DANGER_BUTTON_CLASS =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-3 text-xs font-semibold text-[#d05f5f] transition-colors hover:bg-[#d05f5f]/20 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d05f5f]/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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

function formatProvider(provider: string | null | undefined): string {
  if (!provider) return "Provider unavailable";
  if (provider.toLowerCase() === "stripe") return "Stripe";
  return humanizePlanId(provider);
}

function formatStatus(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return humanizePlanId(status);
}

function formatBillingDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function humanizePlanId(planId: string | null | undefined): string {
  const words = (planId || "").split(/[-_]/).filter(Boolean);
  if (words.length === 0) return "Current plan";
  return words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
}

function compactId(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatReceiptDate(value: ReceiptRecord["createdAt"]): string {
  if (typeof value === "string") {
    return formatBillingDate(value) ?? "Unavailable";
  }
  if (typeof value === "number") {
    return formatBillingDate(new Date(value)) ?? "Unavailable";
  }
  return "Unavailable";
}

function buildAgentNameMap(agents: SdkAgent[]): Record<string, string> {
  return Object.fromEntries(
    agents.map((agent) => [agent.id, agent.name || agent.id]),
  );
}

function getBillingSubscriptions(summary: HyperAgentSubscriptionSummary | null | undefined): HyperAgentSubscription[] {
  if (!summary) return [];
  const byId = new Map<string, HyperAgentSubscription>();
  for (const subscription of [...(summary.activeSubscriptions ?? []), ...(summary.subscriptions ?? [])]) {
    if (!subscription.id) continue;
    byId.set(subscription.id, subscription);
  }
  return Array.from(byId.values());
}

function getCurrentBillingSubscription(summary: HyperAgentSubscriptionSummary | null | undefined): HyperAgentSubscription | null {
  const subscriptions = getBillingSubscriptions(summary);
  return subscriptions.find((subscription) => subscription.isCurrent) ?? summary?.activeSubscriptions?.[0] ?? subscriptions[0] ?? null;
}

function describePlanRenewal(subscription: HyperAgentSubscription | null, resetAt: Date | null): string {
  if (subscription?.cancelAtPeriodEnd) {
    const endDate = formatBillingDate(subscription.expiresAt);
    return endDate ? `Your subscription is scheduled to cancel on ${endDate}.` : "Your subscription is scheduled to cancel at period end.";
  }
  if (subscription?.expiresAt) {
    return `Your subscription will auto renew on ${formatBillingDate(subscription.expiresAt) ?? "the next billing date"}.`;
  }
  if (resetAt) {
    return `Usage resets on ${formatBillingDate(resetAt) ?? "the next billing date"}.`;
  }
  if (subscription) {
    return "Renewal date unavailable from billing data.";
  }
  return "No active paid subscription returned by billing data.";
}

function describeSubscriptionDate(subscription: HyperAgentSubscription): string {
  if (!subscription.expiresAt) {
    return subscription.cancelAtPeriodEnd ? "Ends at period end" : "Unavailable";
  }
  const label = subscription.cancelAtPeriodEnd ? "Ends" : "Renews";
  return `${label} ${formatBillingDate(subscription.expiresAt) ?? "at period end"}`;
}

function describeCancellationDetail(subscription: HyperAgentSubscription): string {
  const endDate = formatBillingDate(subscription.expiresAt);
  if (subscription.cancelAtPeriodEnd) {
    return endDate ? `Access ends on ${endDate}.` : "Access ends at the end of the current billing period.";
  }
  if (subscription.canCancel) {
    return endDate ? `Keeps access until ${endDate}.` : "Keeps access through the current billing period.";
  }
  return endDate ? `${describeSubscriptionDate(subscription)}.` : "Cancellation is not available for this subscription.";
}

function getBillingResetAt(
  summary: HyperAgentSubscriptionSummary | null | undefined,
  subscription: HyperAgentSubscription | null,
): Date | null {
  return summary?.entitlements?.billingResetAt ?? summary?.billingResetAt ?? subscription?.expiresAt ?? null;
}

function describeBillingCadence(subscription: HyperAgentSubscription | null): string {
  if (!subscription) return "Account";
  return subscription.provider.toLowerCase() === "stripe" ? "Monthly" : formatProvider(subscription.provider);
}

function describePaymentMethod(
  subscription: HyperAgentSubscription | null,
  receipts: ReceiptRecord[],
): string {
  const provider = subscription?.provider?.toLowerCase();
  if (provider === "stripe") return "Stripe card on file";
  if (provider === "x402") return "USDC wallet payments";
  if (provider) return `${formatProvider(provider)} payment method`;
  if (receipts.some((receipt) => String(receipt.meta?.payment_method).toLowerCase() === "stripe")) return "Stripe card on file";
  if (receipts.some((receipt) => String(receipt.meta?.payment_method).toLowerCase() === "x402")) return "USDC wallet payments";
  return "No payment method on file";
}

function canManageStripePaymentMethod(subscription: HyperAgentSubscription | null): boolean {
  return subscription?.provider.toLowerCase() === "stripe";
}

function BillingStatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const active = normalized === "active" || normalized === "trialing" || normalized === "completed" || normalized === "succeeded";
  const pending = normalized === "incomplete" || normalized === "past_due" || normalized === "pending" || normalized === "pending cancellation";
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full px-3 text-xs font-medium ${
        active
          ? "bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]"
          : pending
            ? "bg-[#4d3a12] text-[#f0c36a]"
            : "bg-surface-low text-text-secondary"
      }`}
    >
      {formatStatus(status)}
    </span>
  );
}

function extractAgentIdsFromTags(tags: string[]): string[] {
  const ids = new Set<string>();
  for (const tag of tags) {
    const match = /^(?:agent|agent_id|agentId|deployment|deployment_id|deploymentId)[:=](.+)$/i.exec(tag.trim());
    if (match?.[1]) ids.add(match[1].trim());
  }
  return Array.from(ids).filter(Boolean);
}

function addEntitlementAgentIds(ids: Set<string>, entitlement: HyperAgentEntitlement | null | undefined) {
  for (const agentId of entitlement?.activeAgentIds ?? []) {
    if (agentId) ids.add(agentId);
  }
}

function collectPaymentAgentIds(
  payment: AgentPayment,
  summary: HyperAgentSubscriptionSummary | null,
): string[] {
  const ids = new Set<string>();
  const entitlementItems = summary?.entitlementItems ?? [];

  for (const entitlement of entitlementItems) {
    if (payment.entitlement_id && entitlement.id === payment.entitlement_id) {
      addEntitlementAgentIds(ids, entitlement);
    }
    if (payment.subscription_id && entitlement.subscriptionId === payment.subscription_id) {
      addEntitlementAgentIds(ids, entitlement);
    }
  }

  for (const subscription of getBillingSubscriptions(summary)) {
    if (!payment.subscription_id || subscription.id !== payment.subscription_id) continue;
    for (const entitlement of subscription.entitlements ?? []) {
      addEntitlementAgentIds(ids, entitlement);
    }
  }

  for (const agentId of extractAgentIdsFromTags(payment.entitlement?.tags ?? [])) {
    ids.add(agentId);
  }

  return Array.from(ids);
}

function buildPaymentAttribution(
  payment: AgentPayment,
  summary: HyperAgentSubscriptionSummary | null,
  agentsById: Record<string, string>,
): PaymentAttribution {
  const tags = payment.entitlement?.tags ?? [];
  const agentIds = collectPaymentAgentIds(payment, summary);
  const agentLabels = agentIds.map((agentId) => {
    const name = agentsById[agentId];
    return name && name !== agentId ? `${name} (${compactId(agentId)})` : compactId(agentId);
  });
  return { agentIds, agentLabels, tags };
}

function mapPayment(payment: AgentPayment, attribution: PaymentAttribution): ReceiptRecord {
  const provider = payment.provider.toLowerCase();
  const amountValue = Number.parseFloat(payment.amount);
  const amount = Number.isFinite(amountValue)
    ? provider === "x402" || payment.currency.toLowerCase() === "usdc"
      ? (amountValue / 1_000_000).toFixed(6)
      : (amountValue / 100).toFixed(2)
    : "0.00";

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
      subscription_id: payment.subscription_id,
      entitlement_id: payment.entitlement_id,
      entitlement_tags: attribution.tags,
      agent_ids: attribution.agentIds,
      agent_labels: attribution.agentLabels,
    },
  };
}

function getReceiptContext(receipt: ReceiptRecord): string {
  const agentLabels = Array.isArray(receipt.meta?.agent_labels) ? receipt.meta.agent_labels.filter(Boolean) : [];
  const tags = Array.isArray(receipt.meta?.entitlement_tags) ? receipt.meta.entitlement_tags.filter(Boolean) : [];
  const paymentMethod = String(receipt.meta?.payment_method || "").toLowerCase();

  if (agentLabels.length > 0) return `Agent: ${agentLabels.join(", ")}`;
  if (tags.length > 0) return `Tags: ${tags.join(", ")}`;
  return paymentMethod === "x402" ? "Onchain USDC entitlement" : "Pooled account capacity";
}

function CompactReceiptTable({ receipts }: { receipts: ReceiptRecord[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background/65">
      {receipts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background/40 px-4 py-5 text-sm text-text-secondary">
          Completed recurring and direct entitlement payments will appear here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-border bg-background/50 text-[12px] text-text-secondary">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Receipt</th>
                <th className="px-4 py-2.5 font-semibold">Total</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {receipts.map((receipt) => (
                <tr key={receipt.id} className="align-middle transition-colors hover:bg-surface-low/35">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/dashboard/billing/${receipt.id}`}
                      className="font-semibold text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {receipt.id.slice(0, 8)}
                    </Link>
                    <p className="mt-1 max-w-[280px] truncate text-xs text-text-muted" title={getReceiptContext(receipt)}>
                      {getReceiptContext(receipt)}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-foreground">{formatAgentsAmount(receipt)}</td>
                  <td className="px-4 py-2.5"><BillingStatusPill status={receipt.status} /></td>
                  <td className="px-4 py-2.5 font-medium text-text-secondary">{formatReceiptDate(receipt.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BillingLoadingState() {
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-border bg-background/65">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-low">
              <span className="absolute h-6 w-6 animate-ping rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.12)]" />
              <Rocket className="relative h-4 w-4 text-text-secondary" />
            </div>
            <div className="min-w-0">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="mt-1.5 h-3 w-72 max-w-[55vw]" />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-1.5 h-4 w-44" />
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        </div>
      </section>

      <section className="space-y-2.5">
        <Skeleton className="h-5 w-24" />
        <div className="overflow-hidden rounded-xl border border-border bg-background/65">
          <div className="grid grid-cols-4 gap-4 border-b border-border px-4 py-2.5">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-20" />
            ))}
          </div>
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="grid grid-cols-4 gap-4 border-b border-border px-4 py-3 last:border-b-0">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2.5">
        <Skeleton className="h-5 w-32" />
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background/65 px-4 py-3">
          <div>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-1.5 h-4 w-44" />
          </div>
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
      </section>
    </div>
  );
}

export function ProfileBillingSection({ getToken }: ProfileBillingSectionProps) {
  const [payments, setPayments] = useState<AgentPayment[]>([]);
  const [summary, setSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [agentsById, setAgentsById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [paymentMethodOpening, setPaymentMethodOpening] = useState(false);
  const [mutatingSubscriptionId, setMutatingSubscriptionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionNotice, setSubscriptionNotice] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);

  const fetchBillingData = useCallback(async (): Promise<BillingLoadResult> => {
    const token = await getToken();
    const hyperAgent = createHyperAgentClient(token);
    const [paymentsData, subscriptionSummary, listedAgents] = await Promise.all([
      getAgentPayments(hyperAgent),
      hyperAgent.subscriptionSummary().catch(() => null),
      createAgentClient(token).list().catch(() => [] as SdkAgent[]),
    ]);

    return {
      payments: paymentsData.items,
      summary: subscriptionSummary,
      agentsById: buildAgentNameMap(listedAgents),
    };
  }, [getToken]);

  const applyBillingData = useCallback((data: BillingLoadResult) => {
    setPayments(data.payments);
    setSummary(data.summary);
    setAgentsById(data.agentsById);
  }, []);

  const refreshBilling = useCallback(async () => {
    const data = await fetchBillingData();
    applyBillingData(data);
  }, [applyBillingData, fetchBillingData]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchBillingData();
        if (!cancelled) applyBillingData(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load billing records");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const timeout = window.setTimeout(() => { void load(); }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [applyBillingData, fetchBillingData]);

  const receipts = useMemo(
    () => payments.map((payment) => mapPayment(payment, buildPaymentAttribution(payment, summary, agentsById))),
    [agentsById, payments, summary],
  );

  const subscriptions = useMemo(() => getBillingSubscriptions(summary), [summary]);
  const currentSubscription = useMemo(() => getCurrentBillingSubscription(summary), [summary]);
  const resetAt = getBillingResetAt(summary, currentSubscription);
  const effectivePlanName = currentSubscription?.planName || humanizePlanId(summary?.effectivePlanId);
  const billingCadence = describeBillingCadence(currentSubscription);
  const paymentMethodSummary = describePaymentMethod(currentSubscription, receipts);
  const showManageCardAction = canManageStripePaymentMethod(currentSubscription);

  const handleManagePaymentMethod = async () => {
    setPaymentMethodOpening(true);
    setPaymentMethodError(null);
    try {
      const hyperAgent = createHyperAgentClient(await getToken());
      const portalUrl = await createPaymentMethodUpdatePortalUrl(hyperAgent);
      openBillingPortalUrl(portalUrl);
    } catch {
      setPaymentMethodError("Unable to open payment settings. Please try again.");
    } finally {
      setPaymentMethodOpening(false);
    }
  };

  const handleCancelSubscription = async (subscription: HyperAgentSubscription) => {
    if (!subscription.canCancel || subscription.cancelAtPeriodEnd) return;
    if (!window.confirm(`Cancel ${subscription.planName || humanizePlanId(subscription.planId)} at the end of the current billing period?`)) return;

    setSubscriptionNotice(null);
    setSubscriptionError(null);
    setMutatingSubscriptionId(subscription.id);
    try {
      const hyperAgent = createHyperAgentClient(await getToken());
      const result = await hyperAgent.cancelSubscription(subscription.id);
      if (!result.ok) throw new Error(result.message || "Failed to cancel subscription");
      setSubscriptionNotice(result.message || "Subscription cancellation scheduled");
      await refreshBilling();
    } catch (err) {
      setSubscriptionError(err instanceof Error ? err.message : "Failed to cancel subscription");
    } finally {
      setMutatingSubscriptionId(null);
    }
  };

  if (loading) {
    return <BillingLoadingState />;
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      ) : null}
      {subscriptionNotice ? (
        <div className="rounded-lg border border-[#38D39F]/20 bg-[#38D39F]/5 px-4 py-3 text-sm text-[#B7F5DF]">
          {subscriptionNotice}
        </div>
      ) : null}
      {subscriptionError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
          {subscriptionError}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-border bg-background/65">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-low">
              <Rocket className="h-4 w-4 text-text-secondary" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-foreground">
                {effectivePlanName} <span className="text-sm text-text-muted">/ {billingCadence}</span>
              </p>
              <p className="mt-1 truncate text-sm text-text-secondary">{describePlanRenewal(currentSubscription, resetAt)}</p>
            </div>
          </div>

          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            {currentSubscription?.status ? <BillingStatusPill status={currentSubscription.status} /> : null}
            <Link href="/adjust-plan" className={BILLING_SECONDARY_BUTTON_CLASS}>Adjust plan</Link>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Payment</p>
            <p className="mt-1 truncate text-sm text-text-secondary">{paymentMethodSummary}</p>
          </div>

          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            {showManageCardAction ? (
              <button
                type="button"
                onClick={() => { void handleManagePaymentMethod(); }}
                disabled={paymentMethodOpening}
                className={BILLING_SECONDARY_BUTTON_CLASS}
              >
                {paymentMethodOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                {paymentMethodOpening ? "Opening..." : "Manage card"}
              </button>
            ) : (
              <span className="text-xs font-medium text-text-muted">No card settings</span>
            )}
          </div>
        </div>
        {paymentMethodError ? <p className="mt-2 text-xs font-medium text-red-300">{paymentMethodError}</p> : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Invoices</h2>
          <span className="rounded-full border border-border bg-background/50 px-3 py-1 text-xs font-semibold text-text-secondary">
            {receipts.length} total
          </span>
        </div>
        <CompactReceiptTable receipts={receipts} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Cancellation</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-background/65">
          {subscriptions.length > 0 ? (
            subscriptions.map((subscription, index) => {
              const canCancel = subscription.canCancel && !subscription.cancelAtPeriodEnd;
              return (
                <div key={subscription.id} className={`flex items-center justify-between gap-3 px-4 py-3 sm:px-5 ${index === 0 ? "" : "border-t border-border"}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">Cancel {subscription.planName || humanizePlanId(subscription.planId)}</p>
                    <p className="mt-1 truncate text-sm text-text-secondary">{describePaymentMethod(subscription, receipts)}</p>
                    <p className="mt-1 text-xs text-text-muted">{describeCancellationDetail(subscription)}</p>
                  </div>
                  {canCancel ? (
                    <button
                      type="button"
                      onClick={() => { void handleCancelSubscription(subscription); }}
                      disabled={Boolean(mutatingSubscriptionId)}
                      aria-label={`Cancel ${subscription.planName || humanizePlanId(subscription.planId)} at period end`}
                      className={BILLING_DANGER_BUTTON_CLASS}
                    >
                      {mutatingSubscriptionId === subscription.id ? "Cancelling..." : "Cancel at period end"}
                    </button>
                  ) : (
                    <BillingStatusPill status={subscription.cancelAtPeriodEnd ? "Pending cancellation" : subscription.status} />
                  )}
                </div>
              );
            })
          ) : (
            <div className="px-4 py-3 text-sm text-text-secondary sm:px-5">
              No cancellable subscription returned by billing data.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
