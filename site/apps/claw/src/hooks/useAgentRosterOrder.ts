"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

export const AGENT_ROSTER_ORDER_STORAGE_KEY = "claw.agentRosterOrder.v1";

const AGENT_ROSTER_ORDER_CHANGE_EVENT = "claw-agent-roster-order-change";
const EMPTY_AGENT_IDS: readonly string[] = Object.freeze([]);

interface StoredAgentRosterOrder {
  version: 1;
  agentIds: readonly string[];
}

let fallbackOrder: readonly string[] = EMPTY_AGENT_IDS;
let cachedSnapshot: { raw: string | null; agentIds: readonly string[] } | null = null;
let volatileStorage = false;

function normalizeAgentIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return EMPTY_AGENT_IDS;
  const agentIds: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const agentId = candidate.trim();
    if (!agentId || agentIds.includes(agentId)) continue;
    agentIds.push(agentId);
  }
  return agentIds.length > 0 ? Object.freeze(agentIds) : EMPTY_AGENT_IDS;
}

function parseAgentRosterOrder(raw: string | null): readonly string[] {
  if (!raw) return EMPTY_AGENT_IDS;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAgentRosterOrder> | null;
    if (parsed?.version !== 1) return EMPTY_AGENT_IDS;
    return normalizeAgentIds(parsed.agentIds);
  } catch {
    return EMPTY_AGENT_IDS;
  }
}

function getAgentRosterOrderSnapshot(): readonly string[] {
  if (typeof window === "undefined") return EMPTY_AGENT_IDS;
  if (volatileStorage) return fallbackOrder;
  try {
    const raw = window.localStorage.getItem(AGENT_ROSTER_ORDER_STORAGE_KEY);
    if (cachedSnapshot?.raw === raw) return cachedSnapshot.agentIds;
    const agentIds = parseAgentRosterOrder(raw);
    cachedSnapshot = { raw, agentIds };
    fallbackOrder = agentIds;
    return agentIds;
  } catch {
    return fallbackOrder;
  }
}

function emitAgentRosterOrderChange(): void {
  window.dispatchEvent(new CustomEvent(AGENT_ROSTER_ORDER_CHANGE_EVENT));
}

function writeAgentRosterOrder(agentIds: readonly string[]): void {
  const normalized = normalizeAgentIds(agentIds);
  fallbackOrder = normalized;
  let raw: string | null = null;
  try {
    if (normalized.length === 0) {
      window.localStorage.removeItem(AGENT_ROSTER_ORDER_STORAGE_KEY);
    } else {
      raw = JSON.stringify({ version: 1, agentIds: normalized } satisfies StoredAgentRosterOrder);
      window.localStorage.setItem(AGENT_ROSTER_ORDER_STORAGE_KEY, raw);
    }
    volatileStorage = false;
  } catch {
    // Preserve ordering for the current page when local storage is unavailable.
    volatileStorage = true;
  }
  cachedSnapshot = { raw, agentIds: normalized };
  emitAgentRosterOrderChange();
}

function subscribeToAgentRosterOrder(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== AGENT_ROSTER_ORDER_STORAGE_KEY) return;
    volatileStorage = false;
    cachedSnapshot = null;
    onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(AGENT_ROSTER_ORDER_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(AGENT_ROSTER_ORDER_CHANGE_EVENT, onStoreChange);
  };
}

export function reconcileAgentRosterOrder(
  storedAgentIds: readonly string[],
  availableAgentIds: readonly string[],
): readonly string[] {
  const available = normalizeAgentIds(availableAgentIds);
  if (available.length === 0) return EMPTY_AGENT_IDS;
  const availableSet = new Set(available);
  const ordered = normalizeAgentIds(storedAgentIds).filter((agentId) => availableSet.has(agentId));
  const orderedSet = new Set(ordered);
  for (const agentId of available) {
    if (!orderedSet.has(agentId)) ordered.push(agentId);
  }
  return Object.freeze(ordered);
}

export function mergeVisibleAgentRosterOrder(
  fullAgentIds: readonly string[],
  visibleAgentIds: readonly string[],
): readonly string[] {
  const fullOrder = normalizeAgentIds(fullAgentIds);
  const visibleOrder = normalizeAgentIds(visibleAgentIds);
  const visibleSet = new Set(visibleOrder);
  let visibleIndex = 0;
  const merged = fullOrder.map((agentId) => (
    visibleSet.has(agentId) ? (visibleOrder[visibleIndex++] ?? agentId) : agentId
  ));
  for (; visibleIndex < visibleOrder.length; visibleIndex += 1) {
    const agentId = visibleOrder[visibleIndex];
    if (agentId && !merged.includes(agentId)) merged.push(agentId);
  }
  return merged.length > 0 ? Object.freeze(merged) : EMPTY_AGENT_IDS;
}

export function moveAgentInRosterOrder(
  agentIds: readonly string[],
  agentId: string,
  direction: -1 | 1,
): readonly string[] {
  const ordered = [...normalizeAgentIds(agentIds)];
  const currentIndex = ordered.indexOf(agentId);
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return ordered;
  const currentAgentId = ordered[currentIndex];
  const targetAgentId = ordered[targetIndex];
  if (!currentAgentId || !targetAgentId) return ordered;
  ordered[currentIndex] = targetAgentId;
  ordered[targetIndex] = currentAgentId;
  return Object.freeze(ordered);
}

export function clearAgentRosterOrder(): void {
  if (typeof window === "undefined") return;
  volatileStorage = false;
  cachedSnapshot = null;
  writeAgentRosterOrder(EMPTY_AGENT_IDS);
}

export function useAgentRosterOrder(agentIds: readonly string[]) {
  const storedAgentIds = useSyncExternalStore(
    subscribeToAgentRosterOrder,
    getAgentRosterOrderSnapshot,
    () => EMPTY_AGENT_IDS,
  );
  const orderedAgentIds = useMemo(
    () => reconcileAgentRosterOrder(storedAgentIds, agentIds),
    [agentIds, storedAgentIds],
  );
  const setVisibleAgentOrder = useCallback((visibleAgentIds: readonly string[]) => {
    writeAgentRosterOrder(mergeVisibleAgentRosterOrder(orderedAgentIds, visibleAgentIds));
  }, [orderedAgentIds]);

  return { orderedAgentIds, setVisibleAgentOrder };
}
