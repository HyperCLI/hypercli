"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
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
  RecoveryState,
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
  notifyBillingPlanChanged,
  type ReceiptRecord,
} from "@hypercli/shared-ui";
import type {
  HyperAgentEntitlement,
  HyperAgentPlan,
  HyperAgentSubscription,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";

import { ActivateCodeModal } from "@/components/ActivateCodeModal";
import { createAgentClient, createHyperAgentClient } from "@/lib/agent-client";
import { isVisibleCurrentAgentPlan } from "@/lib/agent-plan-catalog";
import { getLaunchSlotInventoryFromSummary } from "@/lib/agent-launch-state";
import {
  getAgentPayments,
  resolveAgentPaymentPlanId,
  type AgentPayment,
} from "@/lib/billing";
import { formatTokens } from "@/lib/format";
import { getActiveAgentTrial, type ActiveAgentTrial } from "@/lib/agent-trial";
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

interface BillingRecovery {
  title: string;
  description: string;
}

interface PlanMutationRecovery extends BillingRecovery {
  action: "review-options" | "refresh-billing" | "finish-confirmed-change";
}

type PlanChangeDirection = "upgrade" | "downgrade" | "change";

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

function finitePlanNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function planMonthlyPrice(plan: HyperAgentPlan): number {
  return finitePlanNumber(plan.priceUsd ?? plan.price);
}

function formatPlanMonthlyPrice(plan: HyperAgentPlan, quantity = 1): string {
  const price = planMonthlyPrice(plan) * Math.max(quantity, 1);
  if (price <= 0) return "Included";
  return `${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(price) ? 0 : 2,
  }).format(price)}/month`;
}

function planCapacityLabel(plan: HyperAgentPlan): string {
  const grants = Object.entries(plan.slotGrants ?? {})
    .filter(([, count]) => finitePlanNumber(count) > 0)
    .map(([tier, count]) => {
      const amount = finitePlanNumber(count);
      return `${amount} ${tierLabel(tier)} slot${amount === 1 ? "" : "s"}`;
    });
  if (grants.length > 0) return grants.join(", ");
  if (plan.agents > 0) return `${plan.agents} agent slot${plan.agents === 1 ? "" : "s"}`;
  return "Capacity details unavailable";
}

function planDailyTokensLabel(plan: HyperAgentPlan): string {
  const dailyTokens = finitePlanNumber(plan.limits?.tpd);
  return dailyTokens > 0 ? `${formatTokens(dailyTokens)} tokens/day` : "Daily token limit unavailable";
}

function getPlanChangeDirection(
  currentPlan: HyperAgentPlan | null,
  targetPlan: HyperAgentPlan,
): PlanChangeDirection {
  if (!currentPlan) return "change";
  const comparisons = [
    planMonthlyPrice(targetPlan) - planMonthlyPrice(currentPlan),
    finitePlanNumber(targetPlan.agents) - finitePlanNumber(currentPlan.agents),
    finitePlanNumber(targetPlan.limits?.tpd) - finitePlanNumber(currentPlan.limits?.tpd),
  ];
  const difference = comparisons.find((value) => value !== 0);
  if (!difference) return "change";
  return difference > 0 ? "upgrade" : "downgrade";
}

function planChangeLabel(direction: PlanChangeDirection): string {
  if (direction === "upgrade") return "Upgrade";
  if (direction === "downgrade") return "Downgrade";
  return "Change";
}

function canAdjustSubscription(subscription: HyperAgentSubscription): boolean {
  const status = subscription.status.toLowerCase();
  return subscription.provider.toLowerCase() === "stripe"
    && !subscription.cancelAtPeriodEnd
    && (status === "active" || status === "trialing");
}

function formatProvider(provider: string | null | undefined): string {
  if (!provider) return "Billing source unavailable";
  if (provider.toLowerCase() === "stripe") return "Card billing";
  if (provider.toLowerCase() === "x402") return "USDC billing";
  return "Account billing";
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
  if (subscription.trial?.active && subscription.trial.endsAt) {
    return `Trial ends ${formatBillingDate(subscription.trial.endsAt) ?? "at the scheduled time"}`;
  }
  if (!subscription.expiresAt) {
    return subscription.cancelAtPeriodEnd ? "Ends at period end" : "Renewal unavailable";
  }
  const label = subscription.cancelAtPeriodEnd ? "Ends" : "Renews";
  return `${label} ${formatBillingDate(subscription.expiresAt) ?? "at period end"}`;
}

function describeCancellationDetail(subscription: HyperAgentSubscription): string {
  if (subscription.trial?.active && subscription.trial.endsAt) {
    const trialEndDate = formatBillingDate(subscription.trial.endsAt);
    if (subscription.cancelAtPeriodEnd) {
      return trialEndDate ? `Trial access ends on ${trialEndDate}.` : "Trial access ends at the scheduled time.";
    }
    return trialEndDate
      ? `No charge until the trial ends on ${trialEndDate}. Cancel before then to avoid renewal.`
      : "No charge until the trial ends. Cancel before then to avoid renewal.";
  }
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

function formatCardBrand(brand: string | null | undefined): string {
  const normalized = String(brand || "").trim().toLowerCase();
  if (!normalized) return "Card";
  if (normalized === "amex") return "American Express";
  return normalized
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function describePaymentMethod(
  subscription: HyperAgentSubscription | null,
  receipts: ReceiptRecord[],
): string {
  const provider = subscription?.provider?.toLowerCase();
  if (provider === "stripe") {
    const paymentMethod = subscription?.paymentMethod;
    if (paymentMethod?.last4) {
      return `${formatCardBrand(paymentMethod.brand)} ending in ${paymentMethod.last4}`;
    }
    return "Stripe card on file";
  }
  if (provider === "x402") return "USDC wallet payments";
  if (provider) return "Account payment method";
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
  if (tags.length > 0) return "Tagged entitlement";
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
  activeTrial: ActiveAgentTrial | null,
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
    const upcomingDate = activeTrial?.subscriptionId === currentSubscription.id
      ? activeTrial.endsAt
      : currentSubscription.expiresAt;
    rows.push({
      id: `upcoming-${currentSubscription.id}`,
      dueDate: formatBillingDate(upcomingDate) ?? "Unavailable",
      receipt: matchingReceipt
        ? compactReceiptId(matchingReceipt.id)
        : compactReceiptId(currentSubscription.stripeSubscriptionId || currentSubscription.id),
      status: "Upcoming",
      total: activeTrial?.subscriptionId === currentSubscription.id
        ? "Calculated at trial end"
        : matchingReceipt
          ? formatAgentsAmount(matchingReceipt)
          : "Calculated at renewal",
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

function SubscriptionPlanAdjustment({
  subscription,
  getToken,
  onBack,
  onChanged,
  onRefreshBilling,
}: {
  subscription: HyperAgentSubscription;
  getToken: () => Promise<string>;
  onBack: () => void;
  onChanged: (targetPlan: HyperAgentPlan) => Promise<void>;
  onRefreshBilling: () => Promise<void>;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const optionsHeadingRef = useRef<HTMLHeadingElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const [plans, setPlans] = useState<HyperAgentPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<BillingRecovery | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [mutationError, setMutationError] = useState<PlanMutationRecovery | null>(null);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const hyperAgent = createHyperAgentClient(await getToken());
      const catalog = await hyperAgent.plans();
      setPlans(
        catalog
          .filter(isVisibleCurrentAgentPlan)
          .sort((left, right) => {
            const priceDifference = planMonthlyPrice(left) - planMonthlyPrice(right);
            return priceDifference || left.name.localeCompare(right.name);
          }),
      );
    } catch {
      setPlans([]);
      setPlansError({
        title: "Retry to load plan options",
        description: "Plan options are temporarily unavailable. This bundle has not been changed.",
      });
    } finally {
      setPlansLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    headingRef.current?.focus();
    const timeout = window.setTimeout(() => { void loadPlans(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadPlans]);

  useEffect(() => {
    if (reviewing) reviewHeadingRef.current?.focus();
  }, [reviewing]);

  const currentPlan = plans.find((plan) => plan.id === subscription.planId) ?? null;
  const availablePlans = plans.filter((plan) => plan.id !== subscription.planId);
  const selectedPlan = availablePlans.find((plan) => plan.id === selectedPlanId) ?? null;
  const direction = selectedPlan ? getPlanChangeDirection(currentPlan, selectedPlan) : null;
  const quantity = Number.isInteger(subscription.quantity) && subscription.quantity > 0
    ? subscription.quantity
    : 1;
  const currentPlanName = subscription.planName || humanizePlanId(subscription.planId);
  const renewalLabel = describeSubscriptionDate(subscription);

  const selectPlan = (planId: string) => {
    setSelectedPlanId(planId);
    setReviewing(false);
    setMutationError(null);
  };

  const confirmChange = async () => {
    if (!selectedPlan || !direction) return;
    setUpdating(true);
    setMutationError(null);
    let updateConfirmed = false;
    try {
      const hyperAgent = createHyperAgentClient(await getToken());
      const result = await hyperAgent.updateSubscription(subscription.id, {
        planId: selectedPlan.id,
        quantity,
      });
      if (!result.ok) {
        setMutationError({
          title: "Plan change was not applied",
          description: "No change was confirmed. Review the selected tier and try again.",
          action: "review-options",
        });
        return;
      }
      updateConfirmed = true;
      await onChanged(selectedPlan);
    } catch {
      setMutationError(updateConfirmed ? {
        title: "Refresh to confirm the new tier",
        description: "The plan changed, but the latest billing details did not load. Refresh Billing before making another change.",
        action: "finish-confirmed-change",
      } : {
        title: "Check billing before retrying the plan change",
        description: "Refresh Billing before sending this request again. We could not confirm whether the change was applied.",
        action: "refresh-billing",
      });
    } finally {
      setUpdating(false);
    }
  };

  const backToOptions = () => {
    setMutationError(null);
    setReviewing(false);
    window.setTimeout(() => optionsHeadingRef.current?.focus(), 0);
  };

  const recoverFromMutationError = async () => {
    if (!mutationError) return;
    if (mutationError.action === "review-options") {
      backToOptions();
      return;
    }

    setUpdating(true);
    try {
      if (mutationError.action === "finish-confirmed-change" && selectedPlan) {
        await onChanged(selectedPlan);
        return;
      }
      await onRefreshBilling();
      setSelectedPlanId(null);
      setMutationError(null);
      setReviewing(false);
      window.setTimeout(() => optionsHeadingRef.current?.focus(), 0);
    } catch {
      setMutationError({
        title: "Retry to refresh billing",
        description: "The latest bundle details are still unavailable. Retry before making another plan change.",
        action: mutationError.action,
      });
    } finally {
      setUpdating(false);
    }
  };

  const impactRows = selectedPlan ? [
    {
      label: "Monthly catalog price",
      current: currentPlan ? formatPlanMonthlyPrice(currentPlan, quantity) : "Current amount unavailable",
      target: formatPlanMonthlyPrice(selectedPlan, quantity),
    },
    {
      label: "Included capacity",
      current: currentPlan ? planCapacityLabel(currentPlan) : "Current capacity unavailable",
      target: planCapacityLabel(selectedPlan),
    },
    {
      label: "Daily tokens",
      current: currentPlan ? planDailyTokensLabel(currentPlan) : "Current limit unavailable",
      target: planDailyTokensLabel(selectedPlan),
    },
  ] : [];

  return (
    <div data-testid="subscription-plan-adjustment" className="min-w-0 text-left">
      <div className="border-b border-border pb-6">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 h-8 rounded-lg px-2 text-xs text-text-secondary hover:bg-surface-low hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to billing
        </Button>
        <div className="mt-5">
          <div className="min-w-0">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-xl font-semibold tracking-tight text-foreground focus:outline-none"
            >
              Adjust {currentPlanName} bundle
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-text-secondary">
              Choose a different tier for this recurring bundle. Other active bundles stay unchanged.
            </p>
          </div>
          <Badge variant="secondary" className="mt-3 w-fit rounded-full px-2.5 py-1 text-[0.625rem] leading-4">
            Bundle {compactId(subscription.id)}
          </Badge>
        </div>
      </div>

      {mutationError ? (
        <RecoveryState
          presentation="compact"
          title={mutationError.title}
          description={mutationError.description}
          primaryAction={{
            label: mutationError.action === "review-options" ? "Review options" : "Refresh billing",
            onAction: () => { void recoverFromMutationError(); },
          }}
          onDismiss={mutationError.action === "review-options" ? backToOptions : undefined}
          className="mt-5"
        />
      ) : null}

      {plansLoading ? (
        <div role="status" aria-label="Loading plan options" className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
          <div className="space-y-4 rounded-2xl border border-border p-5">
            <Skeleton className="h-3 w-20 bg-surface-high" />
            <Skeleton className="h-7 w-32 bg-surface-high" />
            <Skeleton className="h-4 w-24 bg-surface-high" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-5 w-44 bg-surface-high" />
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-24 w-full rounded-2xl bg-surface-high" />
            ))}
          </div>
        </div>
      ) : plansError ? (
        <RecoveryState
          presentation="compact"
          title={plansError.title}
          description={plansError.description}
          primaryAction={{ label: "Retry", onAction: () => { void loadPlans(); } }}
          className="mt-6"
        />
      ) : reviewing && selectedPlan && direction ? (
        <section aria-labelledby="plan-change-review-heading" className="mt-6">
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-text-muted">Final review</p>
          <h3
            ref={reviewHeadingRef}
            id="plan-change-review-heading"
            tabIndex={-1}
            className="mt-2 text-lg font-semibold tracking-tight text-foreground focus:outline-none"
          >
            Confirm {direction}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-text-secondary">
            This changes only bundle {compactId(subscription.id)}. Its quantity stays at {quantity}.
          </p>

          <div className="mt-6 grid items-center gap-3 rounded-2xl border border-border bg-surface-low/40 p-5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="text-[0.625rem] font-medium text-text-muted">Current tier</p>
              <p className="mt-1 truncate text-base font-semibold text-foreground">{currentPlanName}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-text-muted max-sm:rotate-90" aria-hidden="true" />
            <div className="min-w-0 sm:text-right">
              <p className="text-[0.625rem] font-medium text-text-muted">New tier</p>
              <p className="mt-1 truncate text-base font-semibold text-foreground">{selectedPlan.name}</p>
            </div>
          </div>

          <dl className="mt-5 divide-y divide-border rounded-2xl border border-border">
            {impactRows.map((row) => (
              <div key={row.label} className="grid gap-2 px-4 py-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,2fr)] sm:items-center">
                <dt className="text-xs font-medium text-text-secondary">{row.label}</dt>
                <dd className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:justify-end">
                  <span className="text-text-secondary">{row.current}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
                  <span className="font-semibold text-foreground">{row.target}</span>
                </dd>
              </div>
            ))}
          </dl>

          <Alert className="mt-5 px-4 py-3 text-xs leading-5 text-text-secondary">
            <span className="col-start-2">
              {direction === "downgrade"
                ? "This tier reduces the bundle's included capacity. If that capacity is already in use, the change may need attention before it can be applied. "
                : "The new capacity becomes part of this bundle after the change is applied. "}
              Any charge or credit is calculated when the change is applied.
            </span>
          </Alert>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={backToOptions}
              disabled={updating || Boolean(mutationError && mutationError.action !== "review-options")}
              className="rounded-xl"
            >
              Back to options
            </Button>
            <Button
              type="button"
              size="lg"
              onClick={() => { void confirmChange(); }}
              disabled={updating || Boolean(mutationError)}
              data-testid="plan-change-confirm"
              className="rounded-xl"
            >
              {updating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
              {updating ? "Applying change..." : `Confirm ${direction}`}
            </Button>
          </div>
        </section>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-start">
          <section aria-labelledby="current-bundle-tier-heading" className="rounded-2xl border border-[var(--plan-accent-border)] bg-[var(--plan-accent-soft)] p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-[var(--plan-accent)]">Current tier</p>
              <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[0.5625rem]">Active</Badge>
            </div>
            <h3 id="current-bundle-tier-heading" className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
              {currentPlanName}
            </h3>
            <p className="mt-1 text-sm font-medium text-foreground">
              {currentPlan ? formatPlanMonthlyPrice(currentPlan, quantity) : "Current price unavailable"}
            </p>
            <dl className="mt-6 space-y-4 border-t border-[var(--plan-accent-border)] pt-4">
              <div>
                <dt className="text-[0.625rem] text-text-muted">Included capacity</dt>
                <dd className="mt-1 text-xs font-medium text-foreground">
                  {currentPlan ? planCapacityLabel(currentPlan) : "Current capacity unavailable"}
                </dd>
              </div>
              <div>
                <dt className="text-[0.625rem] text-text-muted">Billing schedule</dt>
                <dd className="mt-1 text-xs font-medium text-foreground">{renewalLabel}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="new-bundle-tier-heading" className="min-w-0">
            <h3
              ref={optionsHeadingRef}
              id="new-bundle-tier-heading"
              tabIndex={-1}
              className="text-base font-semibold tracking-tight text-foreground focus:outline-none"
            >
              Choose a higher or lower tier
            </h3>
            <p className="mt-1 text-xs leading-5 text-text-secondary">Select one option to review its impact before confirming.</p>

            {availablePlans.length > 0 ? (
              <fieldset className="mt-4 space-y-3">
                <legend className="sr-only">New tier for {currentPlanName} bundle</legend>
                {availablePlans.map((plan) => {
                  const optionDirection = getPlanChangeDirection(currentPlan, plan);
                  const selected = selectedPlanId === plan.id;
                  return (
                    <label
                      key={plan.id}
                      data-testid={`plan-change-option-${plan.id}`}
                      className={`group flex cursor-pointer items-center gap-4 rounded-2xl border px-4 py-4 transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-ring ${
                        selected
                          ? "border-[var(--plan-accent-border)] bg-[var(--plan-accent-soft)]"
                          : "border-border bg-background hover:border-border-strong hover:bg-surface-low"
                      }`}
                    >
                      <input
                        type="radio"
                        name="bundle-plan-tier"
                        value={plan.id}
                        checked={selected}
                        onChange={() => selectPlan(plan.id)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          selected ? "border-[var(--plan-accent)] bg-[var(--plan-accent)] text-primary-foreground" : "border-border-strong bg-background"
                        }`}
                      >
                        {selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{plan.name}</span>
                          <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[0.5625rem]">
                            {planChangeLabel(optionDirection)}
                          </Badge>
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-text-secondary">
                          {planCapacityLabel(plan)} · {planDailyTokensLabel(plan)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs font-semibold text-foreground">
                        {formatPlanMonthlyPrice(plan, quantity)}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-border px-5 py-8 text-center">
                <p className="text-sm font-semibold text-foreground">No alternative tiers are available.</p>
                <p className="mt-1 text-xs text-text-secondary">This bundle has not been changed.</p>
              </div>
            )}

            {selectedPlan && direction ? (
              <div aria-live="polite" className="mt-5 rounded-2xl border border-border bg-surface-low/40 p-4">
                <p className="text-xs font-semibold text-foreground">{planChangeLabel(direction)} to {selectedPlan.name}</p>
                <p className="mt-1 text-xs leading-5 text-text-secondary">
                  {formatPlanMonthlyPrice(selectedPlan, quantity)}, {planCapacityLabel(selectedPlan)}, and {planDailyTokensLabel(selectedPlan)}.
                  Other bundles stay unchanged.
                </p>
                <Button
                  type="button"
                  size="lg"
                  onClick={() => setReviewing(true)}
                  className="mt-4 w-full rounded-xl sm:w-auto"
                >
                  Review {direction}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
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
  const adjustmentButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const subscriptionNoticeRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<BillingTab>("overview");
  const [payments, setPayments] = useState<AgentPayment[]>([]);
  const [summary, setSummary] = useState<HyperAgentSubscriptionSummary | null>(null);
  const [agentsById, setAgentsById] = useState<Record<string, string>>({});
  const [dailyTokenUsage, setDailyTokenUsage] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [trialClock, setTrialClock] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [showRedeemModal, setShowRedeemModal] = useState(false);
  const [redeemingCode, setRedeemingCode] = useState(false);
  const [paymentMethodOpening, setPaymentMethodOpening] = useState(false);
  const [mutatingSubscriptionId, setMutatingSubscriptionId] = useState<string | null>(null);
  const [adjustingSubscriptionId, setAdjustingSubscriptionId] = useState<string | null>(null);
  const [error, setError] = useState<BillingRecovery | null>(null);
  const [subscriptionNotice, setSubscriptionNotice] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<BillingRecovery | null>(null);
  const [redeemError, setRedeemError] = useState<BillingRecovery | null>(null);
  const [paymentMethodError, setPaymentMethodError] = useState<BillingRecovery | null>(null);

  const fetchBillingData = useCallback(async (): Promise<BillingLoadResult> => {
    const token = await getToken();
    const hyperAgent = createHyperAgentClient(token);
    const [paymentsData, subscriptionSummary, listedAgents, usageHistory] = await Promise.all([
      getAgentPayments(hyperAgent),
      hyperAgent.subscriptionSummary(),
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
      } catch {
        if (!cancelled) {
          setError({
            title: "Retry to load billing",
            description: "Billing activity is temporarily unavailable. Retry to reopen the latest account view.",
          });
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
  const adjustingSubscription = adjustingSubscriptionId
    ? subscriptions.find((subscription) => subscription.id === adjustingSubscriptionId) ?? null
    : null;
  const capacityRows = useMemo(() => buildAgentCapacityRows(summary), [summary]);
  const activeTrial = useMemo(
    () => getActiveAgentTrial(summary, trialClock, loadedAt || trialClock),
    [loadedAt, summary, trialClock],
  );
  const invoiceRows = useMemo(
    () => buildInvoiceRows(receipts, currentSubscription, activeTrial),
    [activeTrial, currentSubscription, receipts],
  );
  const effectivePlanName = currentSubscription?.planName || humanizePlanId(summary?.effectivePlanId);
  const billingCadence = activeTrial && activeTrial.subscriptionId === currentSubscription?.id
    ? `${activeTrial.totalDays ? `${activeTrial.totalDays}-day ` : ""}trial`
    : describeBillingCadence(currentSubscription);
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

  useEffect(() => {
    if (!activeTrial) return;
    const interval = window.setInterval(() => setTrialClock(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [activeTrial]);

  const handleManagePaymentMethod = async () => {
    setPaymentMethodOpening(true);
    setPaymentMethodError(null);
    try {
      const hyperAgent = createHyperAgentClient(await getToken());
      const portalUrl = await createPaymentMethodUpdatePortalUrl(hyperAgent);
      openBillingPortalUrl(portalUrl);
    } catch {
      setPaymentMethodError({
        title: "Retry to open card settings",
        description: "Card settings did not open. Retry when you are ready to continue.",
      });
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
    let cancellationConfirmed = false;
    try {
      const hyperAgent = createHyperAgentClient(await getToken());
      const result = await hyperAgent.cancelSubscription(subscription.id);
      if (!result.ok) throw new Error(result.message || "The cancellation request was not confirmed.");
      cancellationConfirmed = true;
      setSubscriptionNotice("Cancellation scheduled");
      await refreshBilling();
      notifyBillingPlanChanged();
    } catch {
      setSubscriptionError(cancellationConfirmed ? {
        title: "Refresh to confirm cancellation details",
        description: "The cancellation was scheduled, but the latest billing details did not load. Refresh to see the updated period end.",
      } : {
        title: "Check billing before retrying cancellation",
        description: "Refresh billing before sending this request again. We could not confirm whether the cancellation was applied.",
      });
    } finally {
      setMutatingSubscriptionId(null);
    }
  };

  const handleRedeemCode = async (code: string) => {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      setRedeemError({
        title: "Enter an activation code",
        description: "Enter the complete code before activating it.",
      });
      return;
    }
    setRedeemError(null);
    setSubscriptionNotice(null);
    setRedeemingCode(true);
    let activationConfirmed = false;
    try {
      const hyperAgent = createHyperAgentClient(await getToken());
      const result = await hyperAgent.redeemGrantCode(normalizedCode);
      const planLabel = result.entitlement.planName || result.entitlement.planId;
      const expiryLabel = result.entitlement.expiresAt
        ? ` until ${result.entitlement.expiresAt.toLocaleDateString()}`
        : "";
      activationConfirmed = true;
      setSubscriptionNotice(`Code activated. ${planLabel} is now active${expiryLabel}.`);
      setShowRedeemModal(false);
      await refreshBilling();
      notifyBillingPlanChanged();
    } catch {
      const presentation = activationConfirmed ? {
        title: "Refresh to see the activated plan",
        description: "The code was activated, but the latest plan details did not load. Refresh billing to see the updated capacity.",
      } : {
        title: "Check your plan before retrying activation",
        description: "Check your plan before submitting this code again. We could not confirm whether it was activated.",
      };
      if (activationConfirmed) setSubscriptionError(presentation);
      else setRedeemError(presentation);
    } finally {
      setRedeemingCode(false);
    }
  };

  const handleRetryBilling = async () => {
    setLoading(true);
    setError(null);
    try {
      await refreshBilling();
    } catch {
      setError({
        title: "Retry to load billing",
        description: "Billing activity is temporarily unavailable. Retry to reopen the latest account view.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubscriptionPlanChanged = useCallback(async (targetPlan: HyperAgentPlan) => {
    await refreshBilling();
    notifyBillingPlanChanged();
    setSubscriptionNotice(`${targetPlan.name} is now active for this bundle.`);
    setAdjustingSubscriptionId(null);
    setManagementOpen(true);
    window.setTimeout(() => subscriptionNoticeRef.current?.focus(), 0);
  }, [refreshBilling]);

  const closeSubscriptionPlanAdjustment = useCallback(() => {
    const subscriptionId = adjustingSubscriptionId;
    setAdjustingSubscriptionId(null);
    if (subscriptionId) {
      window.setTimeout(() => adjustmentButtonRefs.current.get(subscriptionId)?.focus(), 0);
    }
  }, [adjustingSubscriptionId]);

  const hasNotice = Boolean(error || subscriptionNotice || subscriptionError);
  const billingUnavailable = Boolean(error && loadedAt === 0 && !loading);
  const notices = (
    <div aria-live="polite" className="space-y-3">
      {error ? (
        <RecoveryState
          presentation="compact"
          announcement="off"
          title={error.title}
          description={error.description}
          primaryAction={{ label: "Retry", onAction: () => { void handleRetryBilling(); } }}
        />
      ) : null}
      {subscriptionNotice ? (
        <Alert
          ref={subscriptionNoticeRef}
          tabIndex={-1}
          className="border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.05)] px-3 py-2 text-[0.65625rem] leading-4 text-[var(--selection-accent)] focus:outline-none"
        >
          <span className="col-start-2">{subscriptionNotice}</span>
        </Alert>
      ) : null}
      {subscriptionError ? (
        <RecoveryState
          presentation="compact"
          announcement="off"
          title={subscriptionError.title}
          description={subscriptionError.description}
          primaryAction={{ label: "Refresh billing", onAction: () => { void handleRetryBilling(); } }}
          onDismiss={() => setSubscriptionError(null)}
        />
      ) : null}
    </div>
  );

  if (adjustingSubscription) {
    return (
      <SubscriptionPlanAdjustment
        subscription={adjustingSubscription}
        getToken={getToken}
        onBack={closeSubscriptionPlanAdjustment}
        onChanged={handleSubscriptionPlanChanged}
        onRefreshBilling={refreshBilling}
      />
    );
  }

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
        {!billingUnavailable ? <div className={hasNotice ? "mt-5" : undefined}>
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

              <Card className="gap-0 rounded-2xl border-t-2 border-t-[var(--plan-accent-strong)] bg-surface-low" aria-labelledby="active-bundles-heading">
                <CardHeader className="gap-1.5 p-5 pb-0 text-left">
                  <h2 id="active-bundles-heading" className="text-[0.9375rem] font-semibold leading-5 tracking-tight text-foreground">Active Bundles</h2>
                  <CardDescription className="text-xs leading-4 text-text-muted">
                    {activeTrial
                      ? `${activeTrial.planName} trial · ${activeTrial.timeRemainingLabel} · ends ${formatLongBillingDate(activeTrial.endsAt)}`
                      : bundleRenewal
                        ? `Renews ${formatLongBillingDate(bundleRenewal)}`
                        : "No recurring renewal"}
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
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--plan-accent-border)] bg-[var(--plan-accent-soft)] text-[var(--plan-accent)]">
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
                        {paymentMethodError ? (
                          <RecoveryState
                            presentation="compact"
                            title={paymentMethodError.title}
                            description={paymentMethodError.description}
                            primaryAction={{ label: "Retry", onAction: () => { void handleManagePaymentMethod(); } }}
                            onDismiss={() => setPaymentMethodError(null)}
                            className="mt-3"
                          />
                        ) : null}
                        <div className="mt-4 divide-y divide-border border-t border-border">
                          {subscriptions.length > 0 ? subscriptions.map((subscription) => {
                            const canCancel = subscription.canCancel && !subscription.cancelAtPeriodEnd;
                            const canAdjust = canAdjustSubscription(subscription);
                            const status = subscription.cancelAtPeriodEnd ? "Pending cancellation" : subscription.status;
                            const planName = subscription.planName || humanizePlanId(subscription.planId);
                            return (
                              <div key={subscription.id} className="flex flex-col gap-3 py-4 text-left lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0">
                                  <p className="text-[0.65625rem] font-medium leading-4 text-foreground">{planName}</p>
                                  <p className="mt-1 text-[0.5625rem] leading-3 text-text-muted">{describeCancellationDetail(subscription)}</p>
                                </div>
                                <div className="flex flex-wrap gap-2 lg:justify-end">
                                  {canAdjust ? (
                                    <Button
                                      ref={(node) => {
                                        if (node) adjustmentButtonRefs.current.set(subscription.id, node);
                                        else adjustmentButtonRefs.current.delete(subscription.id);
                                      }}
                                      type="button"
                                      variant="outline"
                                      size="lg"
                                      onClick={() => {
                                        setSubscriptionNotice(null);
                                        setSubscriptionError(null);
                                        setAdjustingSubscriptionId(subscription.id);
                                      }}
                                      aria-label={`Adjust ${planName} bundle plan`}
                                      className="rounded-xl px-3 text-[0.65625rem] leading-4"
                                    >
                                      Adjust plan
                                    </Button>
                                  ) : null}
                                  {canCancel ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="lg"
                                      onClick={() => { void handleCancelSubscription(subscription); }}
                                      disabled={Boolean(mutatingSubscriptionId)}
                                      aria-label={`Cancel ${planName} at period end`}
                                      className="rounded-xl px-3 text-[0.65625rem] leading-4"
                                    >
                                      {mutatingSubscriptionId === subscription.id ? "Cancelling..." : "Cancel at period end"}
                                    </Button>
                                  ) : null}
                                  {!canAdjust && !canCancel ? (
                                    <Badge variant={subscriptionStatusVariant(status)} className="min-h-6 rounded-full px-2 text-[0.5625rem] leading-3">
                                      {formatStatus(status)}
                                    </Badge>
                                  ) : null}
                                </div>
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
                        className="mt-4 bg-surface-high [&_[data-slot=progress-indicator]]:bg-[var(--plan-accent-strong)]"
                      />
                    ) : (
                      <Progress value={0} aria-label="Daily token pool usage unavailable" className="mt-4 bg-surface-high" />
                    )}
                  </Card>
                </CardContent>
              </Card>
            </div>
          )}
        </div> : null}
      </TabsContent>

      <TabsContent value="invoices" className="m-0 pt-6">
        {notices}
        {!billingUnavailable ? <div className={hasNotice ? "mt-5" : undefined}>
          {loading ? <BillingLoadingState activeTab="invoices" /> : <InvoiceTable rows={invoiceRows} />}
        </div> : null}
      </TabsContent>

      <ActivateCodeModal
        isOpen={showRedeemModal}
        processing={redeemingCode}
        error={redeemError?.description ?? null}
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
