import { BrowserHyperCLI } from "@hypercli.com/sdk/browser";
import type { HyperAgentPlan, HyperAgentSubscriptionSummary } from "@hypercli.com/sdk/agent";

import { getPlanTierApiBaseUrl } from "./plan-tier";

export interface PlanSnapshot {
  plans: HyperAgentPlan[];
  summary: HyperAgentSubscriptionSummary;
}

interface CachedSnapshot {
  expiresAt: number;
  value: PlanSnapshot;
}

interface PendingSync {
  force: boolean;
  token: string;
  waiters: Array<{
    resolve: (value: PlanSnapshot) => void;
    reject: (reason?: unknown) => void;
  }>;
}

// The sync state machine. Exactly one sync runs at a time per subject;
// requests made while syncing coalesce into a single follow-up. All state
// lives on globalThis because the bundle can contain multiple live copies
// of this module (chunk splitting) — module scope is per-copy, globalThis
// is per-page, and the FSM invariants must hold across copies.
type SyncPhase = "idle" | "syncing";

interface SubjectChannel {
  phase: SyncPhase;
  pending: PendingSync | null;
  snapshot: CachedSnapshot | null;
  completedVersion: number;
}

interface PlanTierSyncMachine {
  channels: Map<string, SubjectChannel>;
  mountOwner: symbol | null;
}

const MACHINE_KEY = "__hypercliPlanTierSyncMachine";
export const PLAN_TIER_SNAPSHOT_CACHE_MS = 5 * 60 * 1000;

function machine(): PlanTierSyncMachine {
  const globalRef = globalThis as typeof globalThis & { [MACHINE_KEY]?: PlanTierSyncMachine };
  if (!globalRef[MACHINE_KEY]) {
    globalRef[MACHINE_KEY] = { channels: new Map(), mountOwner: null };
  }
  return globalRef[MACHINE_KEY]!;
}

/**
 * Single-mount FSM: the first provider mount claims ownership; later mounts
 * get null and must no-op. Ownership transfers on release, so remounts
 * always leave exactly one active instance. Kept on globalThis because
 * chunk splitting can produce multiple module copies with separate scope.
 */
export function claimPlanTierProviderMount(): (() => void) | null {
  const machineRef = machine();
  if (machineRef.mountOwner) return null;
  const owner = Symbol("plan-tier-provider-mount");
  machineRef.mountOwner = owner;
  return () => {
    if (machineRef.mountOwner === owner) machineRef.mountOwner = null;
  };
}

function channelFor(machineRef: PlanTierSyncMachine, key: string): SubjectChannel {
  let channel = machineRef.channels.get(key);
  if (!channel) {
    channel = { phase: "idle", pending: null, snapshot: null, completedVersion: 0 };
    machineRef.channels.set(key, channel);
  }
  return channel;
}

function channelKey(subject: string, environment: string): string {
  return `${environment}:${subject}`;
}

async function fetchSnapshot(token: string): Promise<PlanSnapshot> {
  const apiUrl = getPlanTierApiBaseUrl();
  const client = new BrowserHyperCLI({
    apiUrl,
    agentsApiBaseUrl: `${apiUrl}/agents`,
    token,
  });
  const [plans, summary] = await Promise.all([
    client.agent.plans(),
    client.agent.subscriptionSummary(),
  ]);
  return { plans, summary };
}

function settle(channel: SubjectChannel, machineRef: PlanTierSyncMachine, key: string): void {
  const pending = channel.pending;
  channel.pending = null;
  if (pending && pending.waiters.length > 0) {
    if (!pending.force && channel.snapshot && channel.snapshot.expiresAt > Date.now()) {
      const value = channel.snapshot.value;
      channel.phase = "idle";
      for (const waiter of pending.waiters) waiter.resolve(value);
      return;
    }
    void runSync(machineRef, key, pending.token, pending?.force ?? false, pending?.waiters ?? []);
    return;
  }
  channel.phase = "idle";
}

async function runSync(
  machineRef: PlanTierSyncMachine,
  key: string,
  token: string,
  force: boolean,
  waiters: PendingSync["waiters"],
): Promise<void> {
  const channel = channelFor(machineRef, key);
  channel.phase = "syncing";
  try {
    const value = await fetchSnapshot(token);
    channel.snapshot = { expiresAt: Date.now() + PLAN_TIER_SNAPSHOT_CACHE_MS, value };
    channel.completedVersion += 1;
    for (const waiter of waiters) waiter.resolve(value);
  } catch (error) {
    for (const waiter of waiters) waiter.reject(error);
  } finally {
    settle(channel, machineRef, key);
  }
}

/**
 * Request a plan snapshot. Serializes per subject across every mount and
 * every bundle copy: concurrent requests coalesce, completed snapshots are
 * cached for PLAN_TIER_SNAPSHOT_CACHE_MS, and `force` only bypasses the
 * cache — never the serialization.
 */
export function requestPlanTierSnapshot(input: {
  token: string;
  subject: string;
  environment: string;
  force?: boolean;
}): Promise<PlanSnapshot> {
  const { token, subject, environment, force = false } = input;
  const machineRef = machine();
  const key = channelKey(subject, environment);
  const channel = channelFor(machineRef, key);

  if (!force && channel.snapshot && channel.snapshot.expiresAt > Date.now()) {
    return Promise.resolve(channel.snapshot.value);
  }

  return new Promise<PlanSnapshot>((resolve, reject) => {
    if (channel.phase === "syncing" && channel.pending) {
      channel.pending.force = channel.pending.force || force;
      channel.pending.token = token;
      channel.pending.waiters.push({ resolve, reject });
      return;
    }
    if (channel.phase === "syncing") {
      channel.pending = { force, token, waiters: [{ resolve, reject }] };
      return;
    }
    void runSync(machineRef, key, token, force, [{ resolve, reject }]);
  });
}

/** Drop the cached snapshot for a subject (billing mutations, subject switch). */
export function invalidatePlanTierSnapshot(subject: string, environment: string): void {
  const machineRef = machine();
  const channel = machineRef.channels.get(channelKey(subject, environment));
  if (channel) channel.snapshot = null;
}
