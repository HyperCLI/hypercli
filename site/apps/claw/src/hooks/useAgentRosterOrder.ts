"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

export const AGENT_ROSTER_ORDER_STORAGE_KEY = "claw.agentRosterOrder.v1";

const AGENT_ROSTER_ORDER_CHANGE_EVENT = "claw-agent-roster-order-change";
const EMPTY_AGENT_IDS: readonly string[] = Object.freeze([]);

interface StoredAgentRosterOrder {
  version: 1;
  agentIds: readonly string[];
}

const fallbackOrders = new Map<string, readonly string[]>();
const cachedSnapshots = new Map<string, { raw: string | null; agentIds: readonly string[] }>();
const volatileStorageKeys = new Set<string>();

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

export function agentRosterOrderStorageKey(scope?: string | null): string {
  const normalizedScope = scope?.trim();
  return normalizedScope
    ? `${AGENT_ROSTER_ORDER_STORAGE_KEY}:${encodeURIComponent(normalizedScope)}`
    : AGENT_ROSTER_ORDER_STORAGE_KEY;
}

function getAgentRosterOrderSnapshot(storageKey: string): readonly string[] {
  if (typeof window === "undefined") return EMPTY_AGENT_IDS;
  const fallbackOrder = fallbackOrders.get(storageKey) ?? EMPTY_AGENT_IDS;
  if (volatileStorageKeys.has(storageKey)) return fallbackOrder;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const cachedSnapshot = cachedSnapshots.get(storageKey);
    if (cachedSnapshot?.raw === raw) return cachedSnapshot.agentIds;
    const agentIds = parseAgentRosterOrder(raw);
    cachedSnapshots.set(storageKey, { raw, agentIds });
    fallbackOrders.set(storageKey, agentIds);
    return agentIds;
  } catch {
    return fallbackOrder;
  }
}

function emitAgentRosterOrderChange(storageKey: string): void {
  window.dispatchEvent(new CustomEvent(AGENT_ROSTER_ORDER_CHANGE_EVENT, {
    detail: { storageKey },
  }));
}

function writeAgentRosterOrder(storageKey: string, agentIds: readonly string[]): void {
  const normalized = normalizeAgentIds(agentIds);
  fallbackOrders.set(storageKey, normalized);
  let raw: string | null = null;
  try {
    if (normalized.length === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      raw = JSON.stringify({ version: 1, agentIds: normalized } satisfies StoredAgentRosterOrder);
      window.localStorage.setItem(storageKey, raw);
    }
    volatileStorageKeys.delete(storageKey);
  } catch {
    // Preserve ordering for the current page when local storage is unavailable.
    volatileStorageKeys.add(storageKey);
  }
  cachedSnapshots.set(storageKey, { raw, agentIds: normalized });
  emitAgentRosterOrderChange(storageKey);
}

function subscribeToAgentRosterOrder(storageKey: string, onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== storageKey) return;
    volatileStorageKeys.delete(storageKey);
    cachedSnapshots.delete(storageKey);
    onStoreChange();
  };
  const handleOrderChange = (event: Event) => {
    const changedStorageKey = (event as CustomEvent<{ storageKey?: string }>).detail?.storageKey;
    if (changedStorageKey && changedStorageKey !== storageKey) return;
    onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(AGENT_ROSTER_ORDER_CHANGE_EVENT, handleOrderChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(AGENT_ROSTER_ORDER_CHANGE_EVENT, handleOrderChange);
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

export function clearAgentRosterOrder(scope?: string | null): void {
  if (typeof window === "undefined") return;
  const storageKey = agentRosterOrderStorageKey(scope);
  volatileStorageKeys.delete(storageKey);
  cachedSnapshots.delete(storageKey);
  fallbackOrders.delete(storageKey);
  writeAgentRosterOrder(storageKey, EMPTY_AGENT_IDS);
}

export function useAgentRosterOrder(agentIds: readonly string[], scope?: string | null) {
  const storageKey = useMemo(() => agentRosterOrderStorageKey(scope), [scope]);
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToAgentRosterOrder(storageKey, onStoreChange),
    [storageKey],
  );
  const getSnapshot = useCallback(() => getAgentRosterOrderSnapshot(storageKey), [storageKey]);
  const storedAgentIds = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_AGENT_IDS,
  );
  const orderedAgentIds = useMemo(
    () => reconcileAgentRosterOrder(storedAgentIds, agentIds),
    [agentIds, storedAgentIds],
  );
  const setVisibleAgentOrder = useCallback((visibleAgentIds: readonly string[]) => {
    writeAgentRosterOrder(storageKey, mergeVisibleAgentRosterOrder(orderedAgentIds, visibleAgentIds));
  }, [orderedAgentIds, storageKey]);

  return { orderedAgentIds, setVisibleAgentOrder };
}
