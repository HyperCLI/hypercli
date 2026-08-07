import type {
  HyperAgentSubscription,
  HyperAgentSubscriptionSummary,
} from "@hypercli.com/sdk/agent";

export interface ActiveAgentTrial {
  subscriptionId: string;
  planId: string;
  planName: string;
  endsAt: Date;
  totalDays: number | null;
  secondsRemaining: number;
  timeRemainingLabel: string;
}

export function formatTrialTimeRemaining(endsAt: Date, now = Date.now()): string {
  return formatTrialSecondsRemaining(Math.max(Math.ceil((endsAt.getTime() - now) / 1000), 0));
}

function formatTrialSecondsRemaining(secondsRemaining: number): string {
  const remainingMs = Math.max(secondsRemaining, 0) * 1000;
  if (remainingMs <= 0) return "Trial ended";
  if (remainingMs < 24 * 60 * 60 * 1000) return "<1 day left";
  const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

export function getActiveAgentTrial(
  summary: HyperAgentSubscriptionSummary | null | undefined,
  now = Date.now(),
  observedAt = now,
): ActiveAgentTrial | null {
  if (!summary) return null;
  const byId = new Map<string, HyperAgentSubscription>();
  for (const subscription of [
    ...(summary.activeSubscriptions ?? []),
    ...(summary.subscriptions ?? []),
  ]) {
    const key = subscription.id || `${subscription.planId}:${subscription.stripeSubscriptionId ?? "local"}`;
    if (!byId.has(key)) byId.set(key, subscription);
  }

  const elapsedSeconds = Math.max(Math.floor((now - observedAt) / 1000), 0);
  const secondsRemaining = (candidate: HyperAgentSubscription): number => {
    const authoritativeSeconds = candidate.trial?.secondsRemaining;
    if (authoritativeSeconds !== null && authoritativeSeconds !== undefined && Number.isFinite(authoritativeSeconds)) {
      return Math.max(Math.ceil(authoritativeSeconds) - elapsedSeconds, 0);
    }
    return Math.max(Math.ceil(((candidate.trial?.endsAt?.getTime() ?? now) - now) / 1000), 0);
  };
  const subscription = Array.from(byId.values())
    .filter((candidate) => (
      candidate.trial?.active === true
      && candidate.trial.endsAt instanceof Date
      && Number.isFinite(candidate.trial.endsAt.getTime())
      && secondsRemaining(candidate) > 0
    ))
    .sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
      return (left.trial?.endsAt?.getTime() ?? Infinity) - (right.trial?.endsAt?.getTime() ?? Infinity);
    })[0];

  const endsAt = subscription?.trial?.endsAt;
  if (!subscription || !endsAt) return null;
  const remaining = secondsRemaining(subscription);
  return {
    subscriptionId: subscription.id,
    planId: subscription.planId,
    planName: subscription.planName || subscription.planId || "Team",
    endsAt,
    totalDays: subscription.trial?.days ?? null,
    secondsRemaining: remaining,
    timeRemainingLabel: formatTrialSecondsRemaining(remaining),
  };
}
