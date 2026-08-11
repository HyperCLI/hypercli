"use client";

/*
 * THESIS: Home is a daily briefing for an agent team, not an analytics report or a catalog of Collections.
 * OWN-WORLD: Warm quiet surfaces, conversational copy, open rows, and Claw's green used only for readiness and action.
 * STORY: Understand how the team is doing, continue its latest work, and see what is coming next without decoding a dashboard.
 * FIRST VIEWPORT: A personal briefing and plain-language pulse lead into agent activity and a compact chronological agenda.
 * FORM: A simple operating brief shaped directly inside the established Claw product world; no concept seed was needed.
 */

import { isAgentTransitionalState, type Agent as SdkAgent } from "@hypercli.com/sdk/agents";
import type { Workspace, WorkspacesAPI } from "@hypercli.com/sdk/workspaces";
import { useEffect, useState } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Skeleton,
  cn,
} from "@hypercli/shared-ui";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowDownRight,
  ArrowRight,
  CalendarClock,
  CircleAlert,
  MessageCircle,
  RefreshCw,
  Zap,
} from "lucide-react";

import type { Agent } from "@/app/dashboard/agents/types";
import { agentDisplayLabel } from "@/components/dashboard/agents/agentViewModel";
import { useAccountOperationsOverview } from "@/hooks/useAccountOperationsOverview";
import { collectionDisplayName } from "@/lib/account-collection";
import { agentProfileImageUrl } from "@/lib/avatar";
import { formatTokens } from "@/lib/format";
import {
  displayOpenClawSessionName,
  sameOpenClawSelectableSessionKey,
  type OpenClawSessionRecord,
} from "@/lib/openclaw-session-sdk-surface";
import { buildOperationsAgenda, type OperationsAgendaItem } from "@/lib/operations-agenda";

type SpaceAccessClient = Pick<WorkspacesAPI, "listGrants">;

export type AccountOperationsHomeProps = {
  sdkAgents: readonly SdkAgent[];
  agents: readonly Agent[];
  workspaces: readonly Workspace[];
  spaceAccessClient: SpaceAccessClient | null;
  displayName?: string | null;
  agentsLoading?: boolean;
  agentsError?: string | null;
  workspacesLoading?: boolean;
  workspacesError?: string | null;
  dailyTokenUsage?: number | null;
  dailyTokenLimit?: number | null;
  tokenUsageLoading?: boolean;
  agentCreationDisabledReason?: string | null;
  onOpenAgent?: (agentId: string) => void;
  onOpenConversation?: (agentId: string, sessionKey: string) => void;
  onOpenScheduled?: (agentId: string) => void;
  onOpenCollection?: (collectionId: string) => void;
  onOpenKnowledge?: () => void;
  onOpenUsage?: () => void;
  onOpenAgentLauncher?: () => void;
  className?: string;
};

type RecentConversation = {
  agent: Agent;
  session: OpenClawSessionRecord;
  timestamp: number;
};

type AgentUsageSummary = {
  agent: Agent;
  sessionCount: number;
  messageCount: number;
  lastActiveAt: number;
};

const QUIET_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_VISIBLE_AGENDA_ITEMS = 8;
const MAX_VISIBLE_SESSIONS = 8;

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

function stateLabel(value: string): string {
  const normalized = value.trim().toLowerCase().replaceAll("_", " ");
  return normalized ? normalized.replace(/\b\w/g, (character) => character.toUpperCase()) : "Unknown";
}

function stateDotClass(value: string): string {
  const normalized = value.toUpperCase();
  if (normalized === "RUNNING") return "bg-success";
  if (isAgentTransitionalState(normalized)) return "bg-warning";
  if (normalized.includes("FAIL") || normalized.includes("ERROR")) return "bg-destructive";
  return "bg-text-muted";
}

function relativeTime(value: number, now: number): string {
  if (!Number.isFinite(value) || value <= 0) return "time unavailable";
  const seconds = Math.round((value - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return formatter.format(days, "day");
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(value);
}

function greetingFor(value: number): string {
  const hour = new Date(value).getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function greetingName(displayName: string | null): string | null {
  return displayName?.trim().split(/\s+/)[0] || null;
}

function agendaDayLabel(item: OperationsAgendaItem, now: number): string {
  if (!item.enabled) return "Paused";
  if (item.startsAt === null) return "Needs attention";
  const date = new Date(item.startsAt);
  const current = new Date(now);
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const difference = Math.round((itemDay - today) / 86_400_000);
  if (difference === 0) return "Today";
  if (difference === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function agendaTimeLabel(item: OperationsAgendaItem): string {
  if (!item.enabled) return "Paused";
  if (item.startsAt === null) return "Check schedule";
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(item.startsAt);
}

function sessionGroupLabel(timestamp: number, now: number): string {
  const current = new Date(now);
  const sessionDate = new Date(timestamp);
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  const sessionDay = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate()).getTime();
  const difference = Math.round((today - sessionDay) / 86_400_000);
  if (difference <= 0) return "Today";
  if (difference === 1) return "Yesterday";
  if (difference < 7) return "Earlier this week";
  return "Earlier";
}

function AgentAvatar({ agent, className }: { agent: Agent; className?: string }) {
  const name = agentDisplayLabel(agent);
  const avatarUrl = agentProfileImageUrl(agent);
  return (
    <Avatar className={cn("border border-border bg-surface-high", className)} title={name}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={`${name} avatar`} className="object-cover" /> : null}
      <AvatarFallback className="bg-surface-high text-[10px] font-semibold text-text-secondary">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

function SessionRowsLoading() {
  return (
    <div role="status" aria-label="Loading sessions">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex min-h-14 items-center gap-3 border-t border-border px-4 py-2.5 sm:px-5">
          <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-36" />
            <Skeleton className="h-2.5 w-full max-w-xs" />
          </div>
          <Skeleton className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}

export function AccountOperationsHome({
  sdkAgents,
  agents,
  workspaces,
  spaceAccessClient,
  displayName = null,
  agentsLoading = false,
  agentsError = null,
  workspacesLoading = false,
  workspacesError = null,
  dailyTokenUsage = null,
  dailyTokenLimit = null,
  tokenUsageLoading = false,
  agentCreationDisabledReason = null,
  onOpenAgent,
  onOpenConversation,
  onOpenScheduled,
  onOpenCollection,
  onOpenKnowledge,
  onOpenUsage,
  onOpenAgentLauncher,
  className,
}: AccountOperationsHomeProps) {
  const [now, setNow] = useState(() => Date.now());
  const [showAllAgenda, setShowAllAgenda] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const { overview, loading, refreshing, refresh } = useAccountOperationsOverview(
    sdkAgents,
    workspaces,
    spaceAccessClient,
  );
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const knownSpacesByAgent = new Map<string, Workspace[]>();
  let restrictedSpaceCount = 0;
  let unavailableSpaceCount = 0;
  for (const space of overview.spaces) {
    if (space.visibility !== "known" || !space.agentIds) {
      if (space.visibility === "restricted") restrictedSpaceCount += 1;
      if (space.visibility === "unavailable") unavailableSpaceCount += 1;
      continue;
    }
    for (const agentId of space.agentIds) {
      const current = knownSpacesByAgent.get(agentId) ?? [];
      current.push(space.workspace);
      knownSpacesByAgent.set(agentId, current);
    }
  }
  const knownCollectionAccess = overview.spaces.filter((space) => space.visibility === "known" && space.agentIds !== null);
  const collectionsInReachCount = knownCollectionAccess.filter((space) => space.agentIds!.length > 0).length;
  const collectionsWaitingCount = knownCollectionAccess.filter((space) => space.agentIds!.length === 0).length;
  const agentsWithCollectionAccessCount = new Set(knownCollectionAccess.flatMap((space) => space.agentIds ?? [])).size;

  const recentConversations: RecentConversation[] = Object.values(overview.agents)
    .flatMap((snapshot) => {
      const agent = agentById.get(snapshot.agentId);
      if (!agent || !snapshot.sessions) return [];
      return snapshot.sessions.map((session) => ({
        agent,
        session,
        timestamp: Math.max(session.lastMessageAt, session.createdAt),
      }));
    })
    .filter((conversation) => conversation.timestamp > 0)
    .sort((left, right) => right.timestamp - left.timestamp);

  const agentUsage: AgentUsageSummary[] = agents.flatMap((agent) => {
    const sessions = overview.agents[agent.id]?.sessions;
    if (!sessions) return [];
    const activeSessions = sessions.filter((session) => Math.max(session.lastMessageAt, session.createdAt) > 0);
    return [{
      agent,
      sessionCount: activeSessions.length,
      messageCount: activeSessions.reduce((total, session) => total + session.messageCount, 0),
      lastActiveAt: activeSessions.reduce((latest, session) => Math.max(latest, session.lastMessageAt, session.createdAt), 0),
    }];
  });
  const usageRanked = [...agentUsage].sort((left, right) => (
    right.messageCount - left.messageCount
    || right.sessionCount - left.sessionCount
    || right.lastActiveAt - left.lastActiveAt
  ));
  const usedAgents = usageRanked.filter((summary) => summary.sessionCount > 0);
  const quietCandidates = agentUsage
    .filter((summary) => (
      summary.lastActiveAt === 0 || summary.lastActiveAt < now - QUIET_AGENT_WINDOW_MS
    ))
    .sort((left, right) => (
      left.messageCount - right.messageCount
      || left.sessionCount - right.sessionCount
      || left.lastActiveAt - right.lastActiveAt
    ));
  const quietAgentIds = new Set(quietCandidates.map((summary) => summary.agent.id));
  const quietAgents = quietCandidates.slice(0, 2);
  const mostUsedAgents = usedAgents.filter((summary) => !quietAgentIds.has(summary.agent.id)).slice(0, 2);

  const agentJobs = Object.values(overview.agents).flatMap((snapshot) => {
    const agent = agentById.get(snapshot.agentId);
    if (!agent || !snapshot.cronJobs) return [];
    return [{ agentId: agent.id, agentName: agentDisplayLabel(agent), jobs: snapshot.cronJobs }];
  });
  const agenda = buildOperationsAgenda(agentJobs, now);
  const visibleAgenda = showAllAgenda ? agenda : agenda.slice(0, MAX_VISIBLE_AGENDA_ITEMS);
  const visibleSessions = showAllSessions ? recentConversations : recentConversations.slice(0, MAX_VISIBLE_SESSIONS);

  const runningAgentList = agents.filter((agent) => agent.state === "RUNNING");
  const firstRunningAgent = runningAgentList[0] ?? null;
  const primaryAgent = firstRunningAgent ?? agents[0] ?? null;
  const activitySnapshots = Object.values(overview.agents).filter((snapshot) => snapshot.dataState !== "not-applicable");
  const gatewaySnapshots = activitySnapshots.filter((snapshot) => snapshot.dataState !== "offline");
  const unavailableGatewayCount = gatewaySnapshots.filter((snapshot) => snapshot.dataState === "unavailable").length;
  const partialGatewayCount = gatewaySnapshots.filter((snapshot) => snapshot.dataState === "partial").length;
  const conversationSourcesRead = activitySnapshots.filter((snapshot) => snapshot.sessions !== null).length;
  const conversationSourcesUnknown = activitySnapshots.length - conversationSourcesRead;
  const cronSourcesRead = activitySnapshots.filter((snapshot) => snapshot.cronJobs !== null).length;
  const cronSourcesUnknown = activitySnapshots.length - cronSourcesRead;
  const dataLoading = agentsLoading || loading;
  const spaceAccessLoading = workspacesLoading
    || overview.spaces.length < workspaces.length
    || overview.spaces.some((space) => space.visibility === "loading");
  const spaceAccessUnknown = spaceAccessLoading || restrictedSpaceCount > 0 || unavailableSpaceCount > 0;
  const knowledgeHeadline = workspaces.length === 0
    ? "A blank shelf, ready for the first thing worth remembering."
    : spaceAccessUnknown
      ? `${collectionsInReachCount} ${collectionsInReachCount === 1 ? "Collection is" : "Collections are"} known to be in reach.`
      : collectionsInReachCount === 0
        ? `${workspaces.length} ${workspaces.length === 1 ? "Collection is" : "Collections are"} waiting to meet an agent.`
        : collectionsWaitingCount > 0
          ? `${collectionsInReachCount} of ${workspaces.length} Collections are in reach.`
          : `Every Collection has an agent in reach.`;
  const knowledgeCopy = workspaces.length === 0
    ? "Start with the docs, decisions, or references your team should carry forward."
    : spaceAccessUnknown
      ? "Some access details are still coming into view, so we will not guess about the rest."
      : collectionsInReachCount === 0
        ? "Connect one and turn stored knowledge into useful context for the next task."
        : collectionsWaitingCount > 0
          ? `${collectionsWaitingCount} ${collectionsWaitingCount === 1 ? "is" : "are"} still waiting for a teammate. A thoughtful match can make old context useful again.`
          : "Your shared context has a path to the team. Keep it fresh as the work changes.";
  const knowledgeActionLabel = workspaces.length === 0
    ? "Build your first Collection"
    : collectionsInReachCount === 0 || collectionsWaitingCount > 0
      ? "Connect a Collection"
      : "Open Knowledge Hub";

  const coverageNotice = agentsError
    ? "The roster is unavailable, so this brief may be incomplete."
    : workspacesError || (!spaceAccessLoading && unavailableSpaceCount > 0)
      ? "Some Collection access details are unavailable. Unknown access remains clearly marked below."
      : unavailableGatewayCount > 0 || partialGatewayCount > 0
        ? `${unavailableGatewayCount + partialGatewayCount} ${unavailableGatewayCount + partialGatewayCount === 1 ? "agent has" : "agents have"} incomplete activity data. Everything we could reach is still shown.`
        : null;
  const creationDisabledId = agentCreationDisabledReason ? "account-home-agent-creation-disabled" : undefined;
  const briefDate = new Date(now);
  const briefWeekday = new Intl.DateTimeFormat("en", { weekday: "short" }).format(briefDate);
  const briefDay = new Intl.DateTimeFormat("en", { day: "2-digit" }).format(briefDate);
  const briefMonth = new Intl.DateTimeFormat("en", { month: "short" }).format(briefDate);
  const tokenLimit = typeof dailyTokenLimit === "number" && Number.isFinite(dailyTokenLimit) && dailyTokenLimit > 0
    ? Math.floor(dailyTokenLimit)
    : null;
  const tokensUsed = typeof dailyTokenUsage === "number" && Number.isFinite(dailyTokenUsage) && dailyTokenUsage >= 0
    ? Math.floor(dailyTokenUsage)
    : null;
  const tokensRemaining = tokenLimit !== null && tokensUsed !== null ? Math.max(tokenLimit - tokensUsed, 0) : null;
  const tokenCapacityReady = tokenLimit !== null && tokensRemaining !== null
    ? Math.max(0, Math.min(100, (tokensRemaining / tokenLimit) * 100))
    : null;
  const tokenCapacityUsed = tokenCapacityReady === null ? null : 100 - tokenCapacityReady;
  const firstName = greetingName(displayName);
  const tokenCapacityReadyLabel = tokenCapacityReady === null
    ? null
    : tokenCapacityReady === 100
      ? "100%"
      : tokenCapacityReady >= 99
        ? `${tokenCapacityReady.toFixed(2)}%`
        : `${Math.round(tokenCapacityReady)}%`;
  return (
    <section className={cn("account-operations-home h-full overflow-y-auto bg-background text-foreground", className)} aria-labelledby="account-home-title">
      <div className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
        <header className="overflow-hidden rounded-2xl border border-border bg-[rgb(var(--selection-accent-rgb)_/_0.04)]">
          <div className="px-5 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-4">
              <h1 id="account-home-title" className="truncate text-[16px] font-semibold tracking-[-0.025em] text-foreground sm:text-[18px]">
                {greetingFor(now)}{firstName ? `, ${firstName}` : ""}.
              </h1>
              <div className="flex items-center gap-1">
                <time dateTime={briefDate.toISOString()} className="text-[9px] font-medium text-text-muted sm:hidden">{briefWeekday}, {briefMonth} {briefDay}</time>
                <Button type="button" variant="ghost" size="sm" onClick={onOpenUsage} disabled={!onOpenUsage} className="h-7 min-h-7 px-2 text-[9px]">
                  View usage <ArrowRight />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => void refresh()} disabled={refreshing || dataLoading} className="h-7 w-7" aria-label="Refresh Home">
                  <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                </Button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5">
              <div className="min-w-0">
                {tokenUsageLoading ? (
                  <div className="space-y-2" role="status" aria-label="Loading token usage">
                    <div className="flex justify-between gap-4"><Skeleton className="h-4 w-40" /><Skeleton className="h-5 w-12" /></div>
                    <Skeleton className="h-2 w-full rounded-full" />
                  </div>
                ) : tokenLimit !== null && tokensUsed !== null && tokensRemaining !== null && tokenCapacityReady !== null && tokenCapacityUsed !== null && tokenCapacityReadyLabel !== null ? (
                  <div>
                    <div className="flex items-baseline justify-between gap-5">
                      <p className="truncate text-[22px] font-semibold tracking-[-0.035em] text-foreground">{tokensRemaining > 0 ? `You have ${formatTokens(tokensRemaining)} tokens available. What will you finish today?` : "Today's capacity is fully in motion."}</p>
                      <p className="shrink-0 text-[18px] font-semibold tabular-nums tracking-[-0.03em] text-[var(--selection-accent)]">{tokenCapacityReadyLabel} ready</p>
                    </div>
                    <div className="relative mt-2 pt-5">
                      <span
                        aria-hidden
                        className={cn(
                          "absolute top-0 z-20 flex flex-col whitespace-nowrap text-[8px] font-medium leading-none tracking-[0.02em] text-[var(--selection-accent)]",
                          tokenCapacityUsed < 8
                            ? "items-start"
                            : tokenCapacityUsed > 92
                              ? "-translate-x-full items-end"
                              : "-translate-x-1/2 items-center",
                        )}
                        style={{ left: `${tokenCapacityUsed}%` }}
                      >
                        <span>You are here</span>
                        {tokenCapacityUsed < 8 ? <ArrowDownLeft className="mt-0.5 h-2.5 w-2.5" /> : tokenCapacityUsed > 92 ? <ArrowDownRight className="mt-0.5 h-2.5 w-2.5" /> : <ArrowDown className="mt-0.5 h-2.5 w-2.5" />}
                      </span>
                      <div
                        className="relative h-3 overflow-hidden rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.08)] ring-1 ring-inset ring-[rgb(var(--selection-accent-rgb)_/_0.12)]"
                        role="progressbar"
                        aria-label="Daily token capacity remaining"
                        aria-valuemin={0}
                        aria-valuemax={tokenLimit}
                        aria-valuenow={tokensRemaining}
                        aria-valuetext={`${formatTokens(tokensRemaining)} of ${formatTokens(tokenLimit)} tokens remaining today`}
                      >
                        <span
                          aria-hidden
                          className="account-home-capacity-available absolute inset-y-0 right-0 overflow-hidden rounded-r-full"
                          style={{ left: `${tokenCapacityUsed}%` }}
                        />
                        <span
                          aria-hidden
                          className="absolute inset-y-0 left-0 bg-[var(--selection-accent)] transition-[width] duration-500 ease-out motion-reduce:transition-none"
                          style={{ width: `${tokenCapacityUsed}%` }}
                        />
                        <span
                          aria-hidden
                          className="absolute inset-y-0 z-10 w-px bg-[var(--selection-accent)] shadow-[0_0_0_1px_rgb(var(--selection-accent-rgb)_/_0.18)]"
                          style={{ left: `${tokenCapacityUsed}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-[18px] font-semibold tracking-[-0.025em] text-foreground">Your available capacity is coming into view.</p>
                    <p className="mt-1 text-[10px] text-text-secondary">Pick the next task while we gather the latest total.</p>
                  </div>
                )}
              </div>
              <div className="shrink-0">
                {firstRunningAgent ? (
                  <Button type="button" size="sm" onClick={() => onOpenAgent?.(firstRunningAgent.id)} disabled={!onOpenAgent} className="group h-9 min-h-9 text-[11px]">
                    <Zap className="transition-transform group-hover:scale-110 group-hover:rotate-6" /> {tokensRemaining && tokensRemaining > 0 ? `Put ${formatTokens(tokensRemaining)} to work` : "Start something"}
                  </Button>
                ) : primaryAgent ? (
                  <Button type="button" size="sm" onClick={() => onOpenAgent?.(primaryAgent.id)} disabled={!onOpenAgent} className="h-9 min-h-9 text-[11px]">
                    Open {agentDisplayLabel(primaryAgent)}
                  </Button>
                ) : null}
              </div>
            </div>

          </div>
        </header>

        {coverageNotice ? (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 px-3.5 py-2.5 text-[11px] leading-relaxed text-warning" role="status">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{coverageNotice}</span>
          </div>
        ) : null}

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.66fr)] xl:items-stretch">
          <section className="order-2 min-w-0 overflow-hidden rounded-2xl border border-border bg-surface-low/25 xl:order-1" aria-labelledby="account-home-sessions-heading">
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
              <h2 id="account-home-sessions-heading" className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">{!agentsLoading && agents.length === 0 ? "Start something worth continuing" : "Pick up where you left off"}</h2>
              {!dataLoading && agents.length > 0 ? <Badge variant="secondary" className="h-5 rounded-full px-2 text-[9px]">{recentConversations.length}</Badge> : null}
            </div>

            {agentsLoading ? <SessionRowsLoading /> : dataLoading && recentConversations.length === 0 ? (
              <SessionRowsLoading />
            ) : recentConversations.length > 0 ? (
              <div className="border-t border-border">
                {visibleSessions.map(({ agent, session, timestamp }, index) => {
                  const title = displayOpenClawSessionName(session);
                  const spaces = knownSpacesByAgent.get(agent.id) ?? [];
                  const linkedAgenda = agenda.filter((item) => (
                    item.agentId === agent.id
                    && item.sessionKey
                    && sameOpenClawSelectableSessionKey(item.sessionKey, session.key)
                  ));
                  const group = sessionGroupLabel(timestamp, now);
                  const previousGroup = index > 0 ? sessionGroupLabel(visibleSessions[index - 1]!.timestamp, now) : null;
                  const sessionAction = session.readOnly ? "View" : "Resume";
                  const sessionMetaId = `account-home-session-meta-${index}`;
                  const spaceDetail = spaces.length > 0
                    ? null
                    : spaceAccessLoading
                      ? "Checking Collection access"
                      : unavailableSpaceCount > 0
                        ? "Collection access unavailable"
                        : restrictedSpaceCount > 0
                          ? "Some Collection access is restricted"
                          : "No known direct Collection access";
                  return (
                    <div key={`${agent.id}:${session.key}`}>
                      {group !== previousGroup ? <p className={cn("border-t border-border bg-background/20 px-4 py-1.5 text-[9px] font-semibold text-text-muted sm:px-5", index === 0 && "border-t-0")}>{group}</p> : null}
                      <article className="grid min-h-14 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2 transition-colors hover:bg-surface-low/35 focus-within:bg-surface-low/35 sm:px-5 lg:grid-cols-[28px_minmax(180px,1fr)_minmax(0,auto)_auto]">
                        <AgentAvatar agent={agent} className="row-span-2 h-7 w-7 self-center lg:row-span-1" />
                        <button
                          type="button"
                          onClick={() => onOpenConversation?.(agent.id, session.key)}
                          disabled={!onOpenConversation}
                          aria-label={`${sessionAction} ${title} with ${agentDisplayLabel(agent)}`}
                          aria-describedby={sessionMetaId}
                          className="group min-h-10 min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] disabled:cursor-default"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[13px] font-semibold text-foreground group-hover:underline">{title}</span>
                            <span className="inline-flex shrink-0 items-center gap-1 text-[9px] font-semibold text-[var(--selection-accent)]">
                              {sessionAction}
                              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                            </span>
                          </span>
                          <span id={sessionMetaId} className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[10px] text-text-muted">
                            <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-text-secondary">
                              <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stateDotClass(agent.state))} />
                              <span className="sr-only">{stateLabel(agent.state)}</span>
                              <span className="truncate">{agentDisplayLabel(agent)}</span>
                            </span>
                            {session.sourceChannelId ? <><span aria-hidden>·</span><span className="shrink-0">via {session.sourceChannelId}</span></> : null}
                            {session.model ? <><span aria-hidden>·</span><span className="truncate">{session.model}</span></> : null}
                            <span aria-hidden>·</span>
                            <span className="shrink-0">{session.messageCount} {session.messageCount === 1 ? "message" : "messages"}</span>
                          </span>
                        </button>
                        <div className="col-start-2 row-start-2 flex min-w-0 flex-wrap items-center gap-1.5 lg:col-start-3 lg:row-start-1 lg:justify-end" aria-label={`Known Collection access for ${title}`}>
                          {spaces.length > 0 ? spaces.slice(0, 1).map((space) => (
                            <button
                              key={space.id}
                              type="button"
                              onClick={() => onOpenCollection?.(space.id)}
                              disabled={!onOpenCollection}
                              className="min-h-6 max-w-32 truncate rounded-full border border-border bg-background/60 px-2 text-[9px] font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] disabled:cursor-default"
                              title={`Open ${collectionDisplayName(space)}`}
                            >
                              {collectionDisplayName(space)}
                            </button>
                          )) : <span className="truncate text-[9px] text-text-muted">{spaceDetail === "No known direct Collection access" ? "No Collection access yet" : spaceDetail}</span>}
                          {spaces.length > 1 ? <span className="text-[9px] text-text-muted">+{spaces.length - 1}</span> : null}
                          {spaces.length > 0 && spaceAccessUnknown ? (
                            <span className="inline-flex text-text-muted" title="Collection access details are incomplete">
                              <CircleAlert className="h-3 w-3" />
                              <span className="sr-only">Collection access details are incomplete</span>
                            </span>
                          ) : null}
                          {linkedAgenda.length > 0 ? (
                            <button type="button" onClick={() => onOpenScheduled?.(agent.id)} disabled={!onOpenScheduled} className="inline-flex min-h-6 items-center gap-1 rounded-full border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] px-2 text-[9px] font-medium text-[var(--selection-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] disabled:cursor-default">
                              <CalendarClock className="h-3 w-3" /> {linkedAgenda.length} scheduled
                            </button>
                          ) : null}
                        </div>
                        <time dateTime={new Date(timestamp).toISOString()} className="col-start-3 row-span-2 row-start-1 whitespace-nowrap text-right text-[10px] text-text-muted lg:col-start-4 lg:row-span-1">{relativeTime(timestamp, now)}</time>
                      </article>
                    </div>
                  );
                })}
                {recentConversations.length > MAX_VISIBLE_SESSIONS ? (
                  <div className="border-t border-border px-4 py-3 sm:px-5">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllSessions((current) => !current)} className="h-8 w-full text-[10px]">
                      {showAllSessions ? "Show fewer sessions" : `Show ${recentConversations.length - MAX_VISIBLE_SESSIONS} more sessions`}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : agents.length === 0 ? (
              <div className="border-t border-border bg-background/20">
                <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="px-5 py-6 sm:px-6">
                    <p className="text-[10px] font-semibold text-[var(--selection-accent)]">Your first handoff</p>
                    <h3 className="mt-2 max-w-[32ch] text-[20px] font-semibold leading-tight tracking-[-0.03em] text-foreground">Hand off the task you wish was already moving.</h3>
                    <p className="mt-2 max-w-[62ch] text-[11px] leading-5 text-text-secondary">Create an agent with its own workspace, give it one clear outcome, and return to work that already has momentum.</p>
                    <Button type="button" size="sm" onClick={onOpenAgentLauncher} disabled={!onOpenAgentLauncher || Boolean(agentCreationDisabledReason)} aria-describedby={creationDisabledId} className="mt-5 h-9 min-h-9 text-[11px]">
                      Create my first agent <ArrowRight />
                    </Button>
                    {agentCreationDisabledReason ? <p id={creationDisabledId} className="mt-2 max-w-sm text-[10px] leading-relaxed text-warning">{agentCreationDisabledReason}</p> : null}
                  </div>

                  <div className="bg-[rgb(var(--selection-accent-rgb)_/_0.045)] px-5 py-5">
                    <p className="text-[10px] font-semibold text-foreground">From first ask to steady rhythm</p>
                    <ol className="relative mt-4 space-y-3 before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-[var(--selection-accent-border)]">
                      {[
                        ["Name the work", "Begin with one useful outcome."],
                        ["Give it context", "Add the files and guidance it should carry."],
                        ["Come back to momentum", "Keep the thread and schedule the next move."],
                      ].map(([title, description], index) => (
                        <li key={title} className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-3">
                          <span className="relative z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--selection-accent-border)] bg-background text-[8px] font-semibold text-[var(--selection-accent)]">{index + 1}</span>
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold text-foreground">{title}</p>
                            <p className="mt-0.5 text-[9px] leading-relaxed text-text-muted">{description}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4 border-t border-border px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                  <div>
                    <h3 className="text-[12px] font-semibold text-foreground">{conversationSourcesUnknown > 0 ? "Some sessions are out of view" : "No sessions yet"}</h3>
                    <p className="mt-1 text-[10px] leading-relaxed text-text-muted">
                      {conversationSourcesUnknown > 0 ? "Start any offline agent or refresh an unavailable gateway to complete this view." : "Start a conversation and this space will become a useful record of where work is happening."}
                    </p>
                  </div>
                </div>
                {primaryAgent ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onOpenAgent?.(primaryAgent.id)} disabled={!onOpenAgent} className="h-8 shrink-0 text-[11px]">
                    {primaryAgent.state === "RUNNING" ? `Talk to ${agentDisplayLabel(primaryAgent)}` : `Open ${agentDisplayLabel(primaryAgent)}`}
                  </Button>
                ) : null}
              </div>
            )}
          </section>

          <aside className="order-1 flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-low/25 xl:order-2" aria-labelledby="account-home-agenda-heading">
            <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
              <h2 id="account-home-agenda-heading" className="shrink-0 whitespace-nowrap text-[15px] font-semibold tracking-[-0.015em] text-foreground">Coming up</h2>
              {!dataLoading ? <Badge variant="secondary" className="h-5 rounded-full px-2 text-[9px]">{agenda.length}</Badge> : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col border-t border-border">
              {dataLoading ? (
                <div className="space-y-4 px-4 py-5 sm:px-5" role="status" aria-label="Loading upcoming work">
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </div>
              ) : agenda.length > 0 ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="px-4 py-3 sm:px-5">
                    {visibleAgenda.map((item, index) => {
                      const group = agendaDayLabel(item, now);
                      const previousGroup = index > 0 ? agendaDayLabel(visibleAgenda[index - 1]!, now) : null;
                      const time = agendaTimeLabel(item);
                      return (
                        <div key={item.id}>
                          {group !== previousGroup ? <p className={cn("pb-2 text-[10px] font-semibold text-text-muted", index > 0 && "pt-4")}>{group}</p> : null}
                          <button
                            type="button"
                            onClick={() => onOpenScheduled?.(item.agentId)}
                            disabled={!onOpenScheduled}
                            className="group grid w-full grid-cols-[58px_minmax(0,1fr)_auto] gap-3 py-2.5 text-left disabled:cursor-default"
                            aria-label={`Open ${item.title} for ${item.agentName}, ${time}, ${item.detail}`}
                          >
                            <time dateTime={item.startsAt ? new Date(item.startsAt).toISOString() : undefined} className="pt-0.5 text-[10px] font-medium tabular-nums text-text-secondary">{time}</time>
                            <div className="relative min-w-0 border-l border-border pl-4">
                              <span className={cn("absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full border-2 border-surface-low", item.needsAttention ? "bg-warning" : item.enabled ? "bg-[var(--selection-accent)]" : "bg-text-muted")} />
                              <p className="truncate text-[12px] font-semibold text-foreground">{item.title}</p>
                              <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-text-muted">{item.agentName} · {item.detail}</p>
                            </div>
                            <ArrowRight className="mt-1 h-3.5 w-3.5 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                          </button>
                        </div>
                      );
                    })}
                    {agenda.length > MAX_VISIBLE_AGENDA_ITEMS ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowAllAgenda((current) => !current)} className="mt-3 h-8 w-full text-[10px]">
                        {showAllAgenda ? "Show less" : `Show ${agenda.length - MAX_VISIBLE_AGENDA_ITEMS} more`}
                      </Button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenScheduled?.(agenda[0]!.agentId)}
                    disabled={!onOpenScheduled}
                    aria-label="Add another scheduled task"
                    className="group mt-auto grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-[var(--selection-accent-border)] bg-[rgb(var(--selection-accent-rgb)_/_0.045)] px-4 py-3.5 text-left transition-colors hover:bg-[rgb(var(--selection-accent-rgb)_/_0.085)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] disabled:cursor-default disabled:opacity-60 sm:px-5"
                  >
                    <span className="min-w-0">
                      <span className="block text-[9px] font-semibold text-[var(--selection-accent)]">A little more breathing room</span>
                      <span className="mt-1 block text-[11px] font-semibold leading-4 tracking-[-0.01em] text-foreground">Give tomorrow one less thing to remember.</span>
                    </span>
                    <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[var(--selection-accent)] px-3 text-[9px] font-semibold text-[var(--selection-accent-foreground)] shadow-[0_4px_12px_rgb(var(--selection-accent-rgb)_/_0.18)] transition-[transform,box-shadow] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_6px_16px_rgb(var(--selection-accent-rgb)_/_0.24)] group-disabled:transform-none group-disabled:shadow-none">
                      Add a schedule
                      <ArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5 group-disabled:transform-none" />
                    </span>
                  </button>
                </div>
              ) : (
                <div className="px-4 py-5 sm:px-5">
                  <p className="text-[9px] font-semibold text-[var(--selection-accent)]">{cronSourcesUnknown > 0 ? "Schedule check" : "Make time work for you"}</p>
                  <h3 className="mt-2 text-[16px] font-semibold leading-tight tracking-[-0.025em] text-foreground">{cronSourcesUnknown > 0 ? "Some scheduled work is unavailable" : "Give tomorrow a head start."}</h3>
                  <p className="mt-2 max-w-[42ch] text-[10px] leading-5 text-text-secondary">
                    {cronSourcesUnknown > 0
                      ? "We could not read every running agent, so this agenda may be incomplete."
                      : firstRunningAgent
                        ? "Set a morning brief, weekly review, or the task you never want to remember twice."
                        : primaryAgent
                          ? "Open your agent, bring it online, and give the week a rhythm."
                          : "Create an agent, then give it a morning brief, weekly review, or any task worth keeping on rhythm."}
                  </p>
                  {firstRunningAgent ? (
                    <Button type="button" size="sm" onClick={() => onOpenScheduled?.(firstRunningAgent.id)} disabled={!onOpenScheduled} className="mt-4 h-9 min-h-9 text-[10px]">
                      <CalendarClock /> {cronSourcesUnknown > 0 ? "Review schedules" : "Schedule the first task"} <ArrowRight />
                    </Button>
                  ) : primaryAgent ? (
                    <Button type="button" size="sm" onClick={() => onOpenAgent?.(primaryAgent.id)} disabled={!onOpenAgent} className="mt-4 h-9 min-h-9 text-[10px]">
                      Open {agentDisplayLabel(primaryAgent)} <ArrowRight />
                    </Button>
                  ) : (
                    <Button type="button" size="sm" onClick={onOpenAgentLauncher} disabled={!onOpenAgentLauncher || Boolean(agentCreationDisabledReason)} aria-describedby={creationDisabledId} className="mt-4 h-9 min-h-9 text-[10px]">
                      Create an agent <ArrowRight />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.66fr)] xl:items-stretch">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface-low/25" aria-labelledby="account-home-team-rhythm-heading">
          <div className="flex flex-col gap-1 px-4 py-3 sm:px-5 xl:flex-row xl:items-baseline xl:justify-between xl:gap-5">
            <div className="min-w-0">
              <h2 id="account-home-team-rhythm-heading" className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">Team rhythm</h2>
              <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">Some agents become daily companions. Others may be ready for a fresh purpose, or a thoughtful goodbye.</p>
            </div>
              <p className="shrink-0 text-[9px] text-text-muted">Based on sessions available now</p>
          </div>

          {dataLoading ? (
            <div className="grid border-t border-border sm:grid-cols-2 sm:divide-x sm:divide-border" role="status" aria-label="Reading your team rhythm">
              {[0, 1].map((group) => (
                <div key={group} className="space-y-2 px-4 py-3 sm:px-5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                  <Skeleton className="h-10 w-full rounded-lg" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid border-t border-border sm:grid-cols-2 sm:divide-x sm:divide-border">
              <div className="px-3 py-3 sm:px-4" aria-label="Most used agents">
                <div className="px-2">
                  <h3 className="text-[11px] font-semibold text-foreground">Most used</h3>
                  <p className="mt-0.5 text-[9px] text-text-muted">The agents you return to most.</p>
                </div>
                {mostUsedAgents.length > 0 ? (
                  <ol className="mt-1.5 space-y-0.5">
                    {mostUsedAgents.map((summary, index) => {
                      const name = agentDisplayLabel(summary.agent);
                      const usageMetaId = `account-home-most-used-${index}`;
                      return (
                        <li key={summary.agent.id}>
                          <button type="button" onClick={() => onOpenAgent?.(summary.agent.id)} disabled={!onOpenAgent} aria-label={`Open ${name}`} aria-describedby={usageMetaId} className="group flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-low/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] disabled:cursor-default">
                            <span className="w-3 shrink-0 text-center text-[9px] font-medium tabular-nums text-text-muted">{index + 1}</span>
                            <AgentAvatar agent={summary.agent} className="h-6 w-6 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stateDotClass(summary.agent.state))} />
                                <span className="truncate text-[11px] font-medium text-foreground">{name}</span>
                              </span>
                              <span id={usageMetaId} className="mt-0.5 block truncate text-[9px] text-text-muted"><span className="sr-only">{stateLabel(summary.agent.state)}. </span>{summary.sessionCount} {summary.sessionCount === 1 ? "session" : "sessions"} · {summary.messageCount} {summary.messageCount === 1 ? "message" : "messages"}</span>
                            </span>
                            <span className="hidden text-[9px] font-medium text-text-secondary xl:inline">Open</span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="px-2 py-3 text-[10px] leading-relaxed text-text-muted">Your team is still warming up. A first session will begin shaping this list.</p>
                )}
              </div>

              <div className="px-3 py-3 sm:px-4" aria-label="Agents waiting in the wings">
                <div className="px-2">
                  <h3 className="text-[11px] font-semibold text-foreground">Waiting in the wings</h3>
                  <p className="mt-0.5 text-[9px] text-text-muted">Quiet for at least a week.</p>
                </div>
                {quietAgents.length > 0 ? (
                  <ol className="mt-1.5 space-y-0.5">
                    {quietAgents.map((summary, index) => {
                      const name = agentDisplayLabel(summary.agent);
                      const activity = summary.lastActiveAt > 0
                        ? `${summary.messageCount > 0 ? "Last conversation" : "Last session"} ${relativeTime(summary.lastActiveAt, now)}`
                        : "No session history yet";
                      const quietMetaId = `account-home-quiet-agent-${index}`;
                      return (
                        <li key={summary.agent.id}>
                          <button type="button" onClick={() => onOpenAgent?.(summary.agent.id)} disabled={!onOpenAgent} aria-label={`Revisit ${name}`} aria-describedby={quietMetaId} className="group flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-low/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] disabled:cursor-default">
                            <span className="w-3 shrink-0 text-center text-[9px] font-medium tabular-nums text-text-muted">{index + 1}</span>
                            <AgentAvatar agent={summary.agent} className="h-6 w-6 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stateDotClass(summary.agent.state))} />
                                <span className="truncate text-[11px] font-medium text-foreground">{name}</span>
                              </span>
                              <span id={quietMetaId} className="mt-0.5 block truncate text-[9px] text-text-muted"><span className="sr-only">{stateLabel(summary.agent.state)}. </span>{activity}</span>
                            </span>
                            <span className="hidden text-[9px] font-medium text-text-secondary xl:inline">Revisit</span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="px-2 py-3 text-[10px] leading-relaxed text-text-muted">Everyone with visible history has checked in recently. No one needs a nudge today.</p>
                )}
              </div>
            </div>
          )}
        </section>
          <section className="overflow-hidden rounded-2xl border border-border bg-surface-low/25" aria-labelledby="account-home-knowledge-heading">
            <div className="flex h-full flex-col px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <h2 id="account-home-knowledge-heading" className="text-[15px] font-semibold tracking-[-0.015em] text-foreground">Knowledge in reach</h2>
                <p className="mt-0.5 text-[9px] text-text-muted">See which Collections can already help an agent.</p>
              </div>

              {spaceAccessLoading ? (
                <div className="mt-4 space-y-3" role="status" aria-label="Reading Collection access">
                  <Skeleton className="h-4 w-4/5" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-14 w-full rounded-lg" />
                </div>
              ) : (
                <>
                  <p className="mt-4 text-[14px] font-semibold leading-snug tracking-[-0.015em] text-foreground">{knowledgeHeadline}</p>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-text-secondary">{knowledgeCopy}</p>

                  <dl className="mt-4 grid grid-cols-3 border-y border-border py-2.5 text-center">
                    <div className="px-1">
                      <dt className="text-[8px] text-text-muted">Collections</dt>
                      <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-foreground">{workspaces.length}</dd>
                    </div>
                    <div className="border-x border-border px-1">
                      <dt className="text-[8px] text-text-muted">In reach</dt>
                      <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-foreground">{collectionsInReachCount}</dd>
                    </div>
                    <div className="px-1">
                      <dt className="text-[8px] text-text-muted">Agents</dt>
                      <dd className="mt-0.5 text-[13px] font-semibold tabular-nums text-foreground">{agentsWithCollectionAccessCount}</dd>
                    </div>
                  </dl>

                  <p className="mt-3 text-[8px] leading-relaxed text-text-muted">This reflects direct access, not observed conversation usage.</p>
                </>
              )}

              <Button type="button" size="sm" onClick={onOpenKnowledge} disabled={!onOpenKnowledge} className="mt-4 h-8 min-h-8 w-fit text-[10px]">
                {knowledgeActionLabel} <ArrowRight />
              </Button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
