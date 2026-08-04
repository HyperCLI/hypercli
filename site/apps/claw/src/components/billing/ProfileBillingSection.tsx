"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BriefcaseBusiness,
  ChevronDown,
  CircleDot,
  CreditCard,
  Loader2,
  Rocket,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  InvoiceStatusBadge,
  Progress,
  Separator,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type ReceiptRecord,
} from "@hypercli/shared-ui";
import type {
  HyperAgentEntitlement,
  HyperAgentSubscription,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";

import { ActivateCodeModal } from "@/components/ActivateCodeModal";
import { createAgentClient, createHyperAgentClient } from "@/lib/agent-client";
import { getLaunchSlotInventoryFromSummary } from "@/lib/agent-launch-state";
import {
  getAgentPayments,
  resolveAgentPaymentPlanId,
  type AgentPayment,
} from "@/lib/billing";
import { formatTokens } from "@/lib/format";
import type { SdkAgent } from "@/types";
import {
  createPaymentMethodUpdatePortalUrl,
  openBillingPortalUrl,
} from "./stripe-billing-portal";

interface ProfileBillingSectionProps {
  getToken: () => Promise<string>;
}

type BillingTab = "overview" | "invoices";

interface BillingLoadResult {
  payments: AgentPayment[];
  summary: HyperAgentSubscriptionSummary | null;
  agentsById: Record<string, string>;
  dailyTokenUsage: number | null;
  loadedAt: number;
}

interface PaymentAttribution {
  agentIds: string[];
  agentLabels: string[];
  tags: string[];
}

interface AgentCapacityRow {
  tier: string;
  label: string;
  used: number;
  available: number;
}

interface BillingInvoiceRow {
  id: string;
  dueDate: string;
  receipt: string;
  receiptHref?: string;
  status: string;
  total: string;
  context?: string;
}

const BILLING_TIER_ORDER = ["free", "small", "medium", "large"];

function formatAgentsAmount(receipt: ReceiptRecord): string {
  const method = String(receipt.meta?.payment_method || "").toLowerCase();
  const raw = Number.parseFloat(receipt.amountUsd);
  if (!Number.isFinite(raw)) return "$0.00";
  if (method === "x402" || String(receipt.meta?.currency || "").toLowerCase() === "usdc") {
    return `${raw.toFixed(6)} USDC`;
  }
  return `$${raw.toFixed(2)}`;
}

function humanizePlanId(planId: string | null | undefined): string {
  const words = (planId || "").split(/[-_]/).filter(Boolean);
  if (words.length === 0) return "Current plan";
  return words.map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
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

function parseBillingDate(date: Date | string | null | undefined): Date | null {
  if (!date) return null;
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatBillingDate(date: Date | string | null | undefined): string | null {
  const parsed = parseBillingDate(date);
  return parsed?.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }) ?? null;
}

function formatLongBillingDate(date: Date | string | null | undefined): string | null {
  const parsed = parseBillingDate(date);
  return parsed?.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }) ?? null;
}

function compactId(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function compactReceiptId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function formatReceiptDate(value: ReceiptRecord["createdAt"]): string {
  if (typeof value === "string") return formatBillingDate(value) ?? "Unavailable";
  if (typeof value === "number") return formatBillingDate(new Date(value)) ?? "Unavailable";
  return "Unavailable";
}

function receiptTimestamp(receipt: ReceiptRecord): number {
  if (typeof receipt.createdAt === "number") return receipt.createdAt;
  if (typeof receipt.createdAt === "string") {
    const timestamp = new Date(receipt.createdAt).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }
  return 0;
}

function buildAgentNameMap(agents: SdkAgent[]): Record<string, string> {
  return Object.fromEntries(agents.map((agent) => [agent.id, agent.name || agent.id]));
}

function getBillingSubscriptions(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): HyperAgentSubscription[] {
  if (!summary) return [];
  const byId = new Map<string, HyperAgentSubscription>();
  for (const subscription of [
    ...(summary.activeSubscriptions ?? []),
    ...(summary.subscriptions ?? []),
  ]) {
    if (subscription.id) byId.set(subscription.id, subscription);
  }
  return Array.from(byId.values());
}

function getCurrentBillingSubscription(
  summary: HyperAgentSubscriptionSummary | null | undefined,
): HyperAgentSubscription | null {
  const subscriptions = getBillingSubscriptions(summary);
  return subscriptions.find((subscription) => subscription.isCurrent)
    ?? summary?.activeSubscriptions?.[0]
    ?? subscriptions[0]
    ?? null;
}

function getBillingResetAt(
  summary: HyperAgentSubscriptionSummary | null | undefined,
  subscription: HyperAgentSubscription | null,
): Date | null {
  return summary?.entitlements?.billingResetAt
    ?? summary?.billingResetAt
    ?? subscription?.expiresAt
    ?? null;
}

function getActiveBundleRenewal(
  summary: HyperAgentSubscriptionSummary | null | undefined,
  currentSubscription: HyperAgentSubscription | null,
): Date | null {
  const recurringDates = getBillingSubscriptions(summary)
    .filter((subscription) => !subscription.cancelAtPeriodEnd)
    .map((subscription) => subscription.expiresAt)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime());
  return recurringDates[0] ?? getBillingResetAt(summary, currentSubscription);
}

function describeSubscriptionDate(subscription: HyperAgentSubscription): string {
  if (!subscription.expiresAt) {
    return subscription.cancelAtPeriodEnd ? "Ends at period end" : "Renewal unavailable";
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
  return endDate ? `${describeSubscriptionDate(subscription)}.` : "Cancellation is unavailable for this subscription.";
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
  if (receipts.some((receipt) => String(receipt.meta?.payment_method).toLowerCase() === "stripe")) {
    return "Stripe card on file";
  }
  if (receipts.some((receipt) => String(receipt.meta?.payment_method).toLowerCase() === "x402")) {
    return "USDC wallet payments";
  }
  return "No payment method on file";
}

function canManageStripePaymentMethod(subscription: HyperAgentSubscription | null): boolean {
  return subscription?.provider.toLowerCase() === "stripe";
}

function subscriptionStatusVariant(status: string): "success" | "secondary" {
  const normalized = status.toLowerCase();
  const active = normalized === "active" || normalized === "trialing";
  return active ? "success" : "secondary";
}

function extractAgentIdsFromTags(tags: string[]): string[] {
  const ids = new Set<string>();
  for (const tag of tags) {
    const match = /^(?:agent|agent_id|agentId|deployment|deployment_id|deploymentId)[:=](.+)$/i.exec(tag.trim());
    if (match?.[1]) ids.add(match[1].trim());
  }
  return Array.from(ids).filter(Boolean);
}

function addEntitlementAgentIds(
  ids: Set<string>,
  entitlement: HyperAgentEntitlement | null | undefined,
) {
  for (const agentId of entitlement?.activeAgentIds ?? []) {
    if (agentId) ids.add(agentId);
  }
}

function collectPaymentAgentIds(
  payment: AgentPayment,
  summary: HyperAgentSubscriptionSummary | null,
): string[] {
  const ids = new Set<string>();
  for (const entitlement of summary?.entitlementItems ?? []) {
    if (payment.entitlement_id && entitlement.id === payment.entitlement_id) {
      addEntitlementAgentIds(ids, entitlement);
    }
    if (payment.subscription_id && entitlement.subscriptionId === payment.subscription_id) {
      addEntitlementAgentIds(ids, entitlement);
    }
  }
  for (const subscription of getBillingSubscriptions(summary)) {
    if (!payment.subscription_id || subscription.id !== payment.subscription_id) continue;
    for (const entitlement of subscription.entitlements ?? []) addEntitlementAgentIds(ids, entitlement);
  }
  for (const agentId of extractAgentIdsFromTags(payment.entitlement?.tags ?? [])) ids.add(agentId);
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
    status: payment.status.toLowerCase() === "succeeded" ? "completed" : payment.status.toLowerCase(),
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
  const agentLabels = Array.isArray(receipt.meta?.agent_labels)
    ? receipt.meta.agent_labels.filter(Boolean)
    : [];
  const tags = Array.isArray(receipt.meta?.entitlement_tags)
    ? receipt.meta.entitlement_tags.filter(Boolean)
    : [];
  const paymentMethod = String(receipt.meta?.payment_method || "").toLowerCase();
  if (agentLabels.length > 0) return `Agent: ${agentLabels.join(", ")}`;
  if (tags.length > 0) return `Tags: ${tags.join(", ")}`;
  return paymentMethod === "x402" ? "Onchain USDC entitlement" : "Pooled account capacity";
}

function tierLabel(tier: string): string {
  if (tier === "small") return "Solo";
  if (tier === "medium") return "Team";
  if (tier === "large") return "Pro";
  return humanizePlanId(tier);
}

function AgentTypeIcon({ tier }: { tier: string }) {
  if (tier === "medium") return <BriefcaseBusiness className="h-4 w-4" aria-hidden="true" />;
  if (tier === "large") return <Rocket className="h-4 w-4" aria-hidden="true" />;
  return <CircleDot className="h-4 w-4" aria-hidden="true" />;
}

function buildAgentCapacityRows(
  summary: HyperAgentSubscriptionSummary | null,
): AgentCapacityRow[] {
  const inventory = getLaunchSlotInventoryFromSummary(summary);
  return Object.entries(inventory)
    .filter(([, entry]) => Math.max(entry.granted, entry.used, entry.available) > 0)
    .sort(([left], [right]) => {
      const leftIndex = BILLING_TIER_ORDER.indexOf(left);
      const rightIndex = BILLING_TIER_ORDER.indexOf(right);
      if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    })
    .map(([tier, entry]) => ({
      tier,
      label: tierLabel(tier),
      used: Math.max(entry.used, 0),
      available: Math.max(entry.available, 0),
    }));
}

function dailyTokenUsageTotal(
  usage: { history?: Array<{ totalTokens?: unknown }> } | null | undefined,
): number | null {
  if (!usage?.history) return null;
  return usage.history.reduce((total, entry) => {
    const value = Number(entry.totalTokens);
    return total + (Number.isFinite(value) ? Math.max(value, 0) : 0);
  }, 0);
}

function formatTimeUntilUtcReset(timestamp: number): string {
  const now = new Date(timestamp);
  const nextReset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const totalMinutes = Math.max(Math.ceil((nextReset - timestamp) / 60_000), 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function buildInvoiceRows(
  receipts: ReceiptRecord[],
  currentSubscription: HyperAgentSubscription | null,
): BillingInvoiceRow[] {
  const sortedReceipts = [...receipts].sort((left, right) => receiptTimestamp(right) - receiptTimestamp(left));
  const rows: BillingInvoiceRow[] = [];
  if (
    currentSubscription?.provider.toLowerCase() === "stripe"
    && currentSubscription.expiresAt
    && !currentSubscription.cancelAtPeriodEnd
  ) {
    const matchingReceipt = sortedReceipts.find((receipt) => (
      String(receipt.meta?.subscription_id || "") === currentSubscription.id
      && receipt.status.toLowerCase() === "completed"
    )) ?? sortedReceipts.find((receipt) => (
      String(receipt.meta?.payment_method || "").toLowerCase() === "stripe"
      && receipt.status.toLowerCase() === "completed"
    ));
    rows.push({
      id: `upcoming-${currentSubscription.id}`,
      dueDate: formatBillingDate(currentSubscription.expiresAt) ?? "Unavailable",
      receipt: matchingReceipt
        ? compactReceiptId(matchingReceipt.id)
        : compactReceiptId(currentSubscription.stripeSubscriptionId || currentSubscription.id),
      status: "Upcoming",
      total: matchingReceipt ? formatAgentsAmount(matchingReceipt) : "Calculated at renewal",
    });
  }
  for (const receipt of sortedReceipts) {
    rows.push({
      id: receipt.id,
      dueDate: formatReceiptDate(receipt.createdAt),
      receipt: compactReceiptId(receipt.id),
      receiptHref: `/dashboard/billing/${receipt.id}`,
      status: receipt.status,
      total: formatAgentsAmount(receipt),
      context: getReceiptContext(receipt),
    });
  }
  return rows;
}

function InvoiceTable({ rows }: { rows: BillingInvoiceRow[] }) {
  if (rows.length === 0) {
    return (
      <Card className="flex min-h-72 items-center justify-center border-dashed px-5 text-center text-[0.65625rem] leading-4 text-text-secondary">
        Completed billing receipts will appear here.
      </Card>
    );
  }

  return (
    <Card className="min-h-[26rem] gap-0 overflow-hidden rounded-2xl bg-background lg:min-h-[40rem]">
      <Table className="min-w-[640px] table-fixed text-left text-[0.65625rem] leading-4">
        <TableHeader className="text-foreground">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-auto w-1/4 px-4 py-4 text-left font-semibold">Due date</TableHead>
            <TableHead className="h-auto w-1/4 px-4 py-4 text-left font-semibold">Receipt</TableHead>
            <TableHead className="h-auto w-1/4 px-4 py-4 text-left font-semibold">Status</TableHead>
            <TableHead className="h-auto w-1/4 px-4 py-4 text-right font-semibold">Invoice total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="px-4 py-4 text-foreground">{row.dueDate}</TableCell>
              <TableCell className="px-4 py-4 font-medium text-foreground">
                {row.receiptHref ? (
                  <Link
                    href={row.receiptHref}
                    className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {row.receipt}
                    {row.context ? <span className="sr-only">, {row.context}</span> : null}
                  </Link>
                ) : row.receipt}
              </TableCell>
              <TableCell className="px-4 py-4">
                <InvoiceStatusBadge
                  status={row.status}
                  className="h-6 rounded-full px-2.5 py-0 text-[0.5625rem] leading-none"
                >
                  {formatStatus(row.status)}
                </InvoiceStatusBadge>
              </TableCell>
              <TableCell className="px-4 py-4 text-right font-medium tabular-nums text-foreground">{row.total}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function BillingLoadingState({ activeTab }: { activeTab: BillingTab }) {
  if (activeTab === "invoices") {
    return (
      <Card role="status" aria-label="Loading invoices" className="min-h-[26rem] gap-0 overflow-hidden rounded-2xl bg-background lg:min-h-[40rem]">
        <div className="grid grid-cols-4 gap-5 border-b border-border px-4 py-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-3 w-20 bg-surface-high" />)}
        </div>
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="grid grid-cols-4 gap-5 border-b border-border px-4 py-4">
            {Array.from({ length: 4 }).map((__, cell) => <Skeleton key={cell} className="h-4 w-24 bg-surface-high" />)}
          </div>
        ))}
      </Card>
    );
  }

  return (
    <div role="status" aria-label="Loading billing overview" className="space-y-9">
      <Card className="gap-0 rounded-2xl">
        <CardHeader className="grid grid-cols-[1fr_auto] items-center gap-5 p-5">
          <div className="space-y-2">
            <Skeleton className="h-4 w-36 bg-surface-high" />
            <Skeleton className="h-3 w-64 max-w-[55vw] bg-surface-high" />
          </div>
          <Skeleton className="h-10 w-24 rounded-xl bg-surface-high" />
        </CardHeader>
      </Card>
      <Card className="gap-0 rounded-2xl">
        <CardHeader className="gap-2 p-5 pb-0">
          <Skeleton className="h-4 w-28 bg-surface-high" />
          <Skeleton className="h-3 w-36 bg-surface-high" />
        </CardHeader>
        <CardContent className="p-5">
          <div className="flex h-14 items-center gap-3 rounded-xl border border-border px-4">
            <Skeleton className="h-9 w-9 rounded-xl bg-surface-high" />
            <Skeleton className="h-4 w-32 bg-surface-high" />
            <Skeleton className="ml-auto h-10 w-20 rounded-xl bg-surface-high" />
          </div>
        </CardContent>
      </Card>
      <Separator />
      <Card className="gap-0 rounded-2xl">
        <CardHeader className="gap-2 p-5 pb-0">
          <Skeleton className="h-4 w-24 bg-surface-high" />
          <Skeleton className="h-3 w-40 bg-surface-high" />
        </CardHeader>
        <CardContent className="p-5">
          <div className="space-y-4 rounded-xl border border-border p-5">
            <div className="flex justify-between gap-5">
              <Skeleton className="h-4 w-32 bg-surface-high" />
              <Skeleton className="h-4 w-24 bg-surface-high" />
            </div>
            <Skeleton className="h-2 w-full rounded-full bg-surface-high" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ProfileBillingSection({ getToken }: ProfileBillingSectionProps) {
  const [activeTab, setActiveTab] = useState<BillingTab>("overview");
  const [payments, setPayments] = useState<AgentPayment[]>([]);
  const [summary, setSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [agentsById, setAgentsById] = useState<Record<string, string>>({});
  const [dailyTokenUsage, setDailyTokenUsage] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [redeemingCode, setRedeemingCode] = useState(false);
  const [paymentMethodOpening, setPaymentMethodOpening] = useState(false);
  const [mutatingSubscriptionId, setMutatingSubscriptionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionNotice, setSubscriptionNotice] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);

  const fetchBillingData = useCallback(async (): Promise<BillingLoadResult> => {
    const token = await getToken();
    const hyperAgent = createHyperAgentClient(token);
    const [paymentsData, subscriptionSummary, listedAgents, usageHistory] = await Promise.all([
      getAgentPayments(hyperAgent),
      hyperAgent.subscriptionSummary().catch(() => null),
      createAgentClient(token).list().catch(() => [] as SdkAgent[]),
      hyperAgent.usageHistory(1).catch(() => null),
    ]);
    return {
      payments: paymentsData.items,
      summary: subscriptionSummary,
      agentsById: buildAgentNameMap(listedAgents),
      dailyTokenUsage: dailyTokenUsageTotal(usageHistory),
      loadedAt: Date.now(),
    };
  }, [getToken]);

  const applyBillingData = useCallback((data: BillingLoadResult) => {
    setPayments(data.payments);
    setSummary(data.summary);
    setAgentsById(data.agentsById);
    setDailyTokenUsage(data.dailyTokenUsage);
    setLoadedAt(data.loadedAt);
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
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load billing records");
        }
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
  const capacityRows = useMemo(() => buildAgentCapacityRows(summary), [summary]);
  const invoiceRows = useMemo(() => buildInvoiceRows(receipts, currentSubscription), [currentSubscription, receipts]);
  const effectivePlanName = currentSubscription?.planName || humanizePlanId(summary?.effectivePlanId);
  const billingCadence = describeBillingCadence(currentSubscription);
  const paymentMethodSummary = describePaymentMethod(currentSubscription, receipts);
  const showManageCardAction = canManageStripePaymentMethod(currentSubscription);
  const bundleRenewal = getActiveBundleRenewal(summary, currentSubscription);
  const pooledTpd = summary?.entitlements?.pooledTpd ?? summary?.pooledTpd ?? 0;
  const tokenUsagePercent = dailyTokenUsage !== null && pooledTpd > 0
    ? Math.min((dailyTokenUsage / pooledTpd) * 100, 100)
    : null;
  const capacityTotals = capacityRows.reduce(
    (totals, row) => ({ used: totals.used + row.used, available: totals.available + row.available }),
    { used: 0, available: 0 },
  );

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
    } catch (mutationError) {
      setSubscriptionError(mutationError instanceof Error ? mutationError.message : "Failed to cancel subscription");
    } finally {
      setMutatingSubscriptionId(null);
    }
  };

  const handleRedeemCode = async (code: string) => {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      setRedeemError("Enter a code to activate it.");
      return;
    }
    setRedeemError(null);
    setSubscriptionNotice(null);
    setRedeemingCode(true);
    try {
      const hyperAgent = createHyperAgentClient(await getToken());
      const result = await hyperAgent.redeemGrantCode(normalizedCode);
      const planLabel = result.entitlement.planName || result.entitlement.planId;
      const expiryLabel = result.entitlement.expiresAt
        ? ` until ${result.entitlement.expiresAt.toLocaleDateString()}`
        : "";
      setSubscriptionNotice(`Code activated. ${planLabel} is now active${expiryLabel}.`);
      setShowRedeemModal(false);
      await refreshBilling();
    } catch (redemptionError) {
      setRedeemError(redemptionError instanceof Error ? redemptionError.message : "Failed to activate code");
    } finally {
      setRedeemingCode(false);
    }
  };

  const hasNotice = Boolean(error || subscriptionNotice || subscriptionError);
  const notices = (
    <div aria-live="polite" className="space-y-3">
      {error ? <Alert variant="destructive" className="px-3 py-2 text-[0.65625rem] leading-4">{error}</Alert> : null}
      {subscriptionNotice ? (
        <Alert className="border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.05)] px-3 py-2 text-[0.65625rem] leading-4 text-[var(--selection-accent)]">
          {subscriptionNotice}
        </Alert>
      ) : null}
      {subscriptionError ? <Alert variant="destructive" className="px-3 py-2 text-[0.65625rem] leading-4">{subscriptionError}</Alert> : null}
    </div>
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as BillingTab)}
      className="min-w-0 gap-0 text-left"
    >
      <TabsList aria-label="Billing sections" className="h-12 w-full justify-start rounded-none border-b border-border bg-transparent p-0">
        <TabsTrigger
          value="overview"
          className="relative h-12 flex-none rounded-none border-0 bg-transparent px-4 text-[0.65625rem] leading-4 text-text-muted after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:after:bg-[var(--selection-accent)] sm:text-xs dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent"
        >
          Overview
        </TabsTrigger>
        <TabsTrigger
          value="invoices"
          className="relative h-12 flex-none rounded-none border-0 bg-transparent px-4 text-[0.65625rem] leading-4 text-text-muted after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-transparent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:after:bg-[var(--selection-accent)] sm:text-xs dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent"
        >
          Invoices
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="m-0 pt-6">
        {notices}
        <div className={hasNotice ? "mt-5" : undefined}>
          {loading ? (
            <BillingLoadingState activeTab="overview" />
          ) : (
            <div className="space-y-9">
              <Card className="gap-0 rounded-2xl bg-surface-low">
                <CardHeader className="grid grid-cols-1 items-center gap-4 p-5 text-left sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <h2 className="text-[0.9375rem] font-semibold leading-5 tracking-tight text-foreground">Have a promo code?</h2>
                    <CardDescription className="mt-1 text-xs leading-4 text-text-muted">Redeem a code to add capacity to your plan.</CardDescription>
                  </div>
                  <CardAction className="col-start-1 row-start-2 self-center justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={() => {
                        setRedeemError(null);
                        setShowRedeemModal(true);
                      }}
                      className="rounded-xl px-3 text-[0.65625rem] leading-4"
                    >
                      Redeem code
                    </Button>
                  </CardAction>
                </CardHeader>
              </Card>

              <Card className="gap-0 rounded-2xl bg-surface-low" aria-labelledby="active-bundles-heading">
                <CardHeader className="gap-1.5 p-5 pb-0 text-left">
                  <h2 id="active-bundles-heading" className="text-[0.9375rem] font-semibold leading-5 tracking-tight text-foreground">Active Bundles</h2>
                  <CardDescription className="text-xs leading-4 text-text-muted">
                    {bundleRenewal ? `Renews ${formatLongBillingDate(bundleRenewal)}` : "No recurring renewal"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-5">
                  <Card className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-0 overflow-hidden rounded-2xl bg-background/30 px-4 py-2">
                    <Collapsible open={agentsExpanded} onOpenChange={setAgentsExpanded} className="contents">
                      <CollapsibleTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="lg"
                          className="col-start-1 row-start-1 h-11 min-w-0 justify-start rounded-xl px-0 text-xs leading-4"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-high">
                            <ChevronDown className={`h-4 w-4 transition-transform ${agentsExpanded ? "rotate-180" : "-rotate-90"}`} aria-hidden="true" />
                          </span>
                          <span>Agents this cycle</span>
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent id="billing-agent-capacity" className="col-span-2 -mx-4 mt-2 border-t border-border px-4 pt-2">
                        {capacityRows.length > 0 ? (
                          <Table className="min-w-[460px] text-[0.65625rem] leading-4">
                            <TableHeader>
                              <TableRow className="hover:bg-transparent">
                                <TableHead className="h-auto px-4 py-3 font-semibold">Agent type</TableHead>
                                <TableHead className="h-auto w-24 px-2 py-3 text-right font-semibold">In use</TableHead>
                                <TableHead className="h-auto w-24 px-2 py-3 text-right font-semibold">Available</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {capacityRows.map((row) => (
                                <TableRow key={row.tier}>
                                  <TableCell className="px-4 py-3 font-medium text-foreground">
                                    <span className="flex items-center gap-3">
                                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-high">
                                        <AgentTypeIcon tier={row.tier} />
                                      </span>
                                      <span>{row.label}</span>
                                    </span>
                                  </TableCell>
                                  <TableCell className="px-2 py-3 text-right tabular-nums text-foreground">{row.used}</TableCell>
                                  <TableCell className="px-2 py-3 text-right tabular-nums text-foreground">{row.available}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                            <TableFooter className="bg-transparent">
                              <TableRow className="hover:bg-transparent">
                                <TableCell className="px-4 py-3 font-semibold text-foreground">Total</TableCell>
                                <TableCell className="px-2 py-3 text-right font-semibold tabular-nums text-foreground">{capacityTotals.used}</TableCell>
                                <TableCell className="px-2 py-3 text-right font-semibold tabular-nums text-foreground">{capacityTotals.available}</TableCell>
                              </TableRow>
                            </TableFooter>
                          </Table>
                        ) : (
                          <p className="px-4 py-4 text-[0.65625rem] leading-4 text-text-secondary">No agent capacity is active for this billing cycle.</p>
                        )}
                      </CollapsibleContent>
                    </Collapsible>

                    <Collapsible open={managementOpen} onOpenChange={setManagementOpen} className="contents">
                      <CollapsibleTrigger asChild>
                        <Button type="button" variant="outline" size="lg" className="col-start-2 row-start-1 rounded-xl px-3 text-[0.65625rem] leading-4">
                          Manage
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent id="billing-management" className="col-span-2 -mx-4 mt-2 border-t border-border px-4 pt-4">
                        <div className="flex flex-col gap-4 text-left lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <p className="text-[0.65625rem] font-semibold leading-4 text-foreground">{effectivePlanName} <span className="font-normal text-text-muted">/ {billingCadence}</span></p>
                            <p className="mt-1 text-[0.65625rem] leading-4 text-text-secondary">{paymentMethodSummary}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button asChild variant="outline" size="lg" className="rounded-xl px-3 text-[0.65625rem] leading-4">
                              <Link href="/adjust-plan">Adjust plan</Link>
                            </Button>
                            {showManageCardAction ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="lg"
                                onClick={() => { void handleManagePaymentMethod(); }}
                                disabled={paymentMethodOpening}
                                className="rounded-xl px-3 text-[0.65625rem] leading-4"
                              >
                                {paymentMethodOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                                {paymentMethodOpening ? "Opening..." : "Manage card"}
                              </Button>
                            ) : (
                              <span className="flex h-10 items-center text-[0.65625rem] leading-4 text-text-muted">No card settings</span>
                            )}
                          </div>
                        </div>
                        {paymentMethodError ? <p className="mt-3 text-[0.65625rem] leading-4 text-destructive">{paymentMethodError}</p> : null}
                        <div className="mt-4 divide-y divide-border border-t border-border">
                          {subscriptions.length > 0 ? subscriptions.map((subscription) => {
                            const canCancel = subscription.canCancel && !subscription.cancelAtPeriodEnd;
                            const status = subscription.cancelAtPeriodEnd ? "Pending cancellation" : subscription.status;
                            return (
                              <div key={subscription.id} className="flex flex-col gap-3 py-4 text-left lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0">
                                  <p className="text-[0.65625rem] font-medium leading-4 text-foreground">{subscription.planName || humanizePlanId(subscription.planId)}</p>
                                  <p className="mt-1 text-[0.5625rem] leading-3 text-text-muted">{describeCancellationDetail(subscription)}</p>
                                </div>
                                {canCancel ? (
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="lg"
                                    onClick={() => { void handleCancelSubscription(subscription); }}
                                    disabled={Boolean(mutatingSubscriptionId)}
                                    aria-label={`Cancel ${subscription.planName || humanizePlanId(subscription.planId)} at period end`}
                                    className="rounded-xl px-3 text-[0.65625rem] leading-4"
                                  >
                                    {mutatingSubscriptionId === subscription.id ? "Cancelling..." : "Cancel at period end"}
                                  </Button>
                                ) : (
                                  <Badge variant={subscriptionStatusVariant(status)} className="min-h-6 rounded-full px-2 text-[0.5625rem] leading-3">
                                    {formatStatus(status)}
                                  </Badge>
                                )}
                              </div>
                            );
                          }) : (
                            <p className="py-4 text-[0.65625rem] leading-4 text-text-secondary">No active paid subscription returned by billing data.</p>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                </CardContent>
              </Card>

              <Separator />

              <Card className="gap-0 rounded-2xl bg-surface-low" aria-labelledby="token-pool-heading">
                <CardHeader className="gap-1.5 p-5 pb-0 text-left">
                  <h2 id="token-pool-heading" className="text-[0.9375rem] font-semibold leading-5 tracking-tight text-foreground">Token pool</h2>
                  <CardDescription className="text-xs leading-4 text-text-muted">resets daily at 00:00 UTC</CardDescription>
                </CardHeader>
                <CardContent className="p-5">
                  <Card className="gap-0 rounded-2xl bg-background/30 p-5 text-left">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <p className="text-[0.84375rem] font-semibold leading-5 text-foreground">
                        {dailyTokenUsage === null ? "Usage unavailable" : formatTokens(dailyTokenUsage)}
                        {pooledTpd > 0 ? <span className="font-normal text-text-muted"> / {formatTokens(pooledTpd)}</span> : null}
                      </p>
                      <p className="text-[0.65625rem] leading-4 text-text-muted">
                        {loadedAt ? `Resets in ${formatTimeUntilUtcReset(loadedAt)}` : "Resets at 00:00 UTC"}
                      </p>
                    </div>
                    {tokenUsagePercent !== null ? (
                      <Progress
                        value={tokenUsagePercent}
                        aria-label="Daily token pool usage"
                        aria-valuemin={0}
                        aria-valuemax={pooledTpd}
                        aria-valuenow={dailyTokenUsage ?? 0}
                        className="mt-4 bg-surface-high [&_[data-slot=progress-indicator]]:bg-[var(--selection-accent)]"
                      />
                    ) : (
                      <Progress value={0} aria-label="Daily token pool usage unavailable" className="mt-4 bg-surface-high" />
                    )}
                  </Card>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="invoices" className="m-0 pt-6">
        {notices}
        <div className={hasNotice ? "mt-5" : undefined}>
          {loading ? <BillingLoadingState activeTab="invoices" /> : <InvoiceTable rows={invoiceRows} />}
        </div>
      </TabsContent>

      <ActivateCodeModal
        isOpen={showRedeemModal}
        processing={redeemingCode}
        error={redeemError}
        onClose={() => {
          if (redeemingCode) return;
          setShowRedeemModal(false);
          setRedeemError(null);
        }}
        onSubmit={handleRedeemCode}
      />
    </Tabs>
  );
}
