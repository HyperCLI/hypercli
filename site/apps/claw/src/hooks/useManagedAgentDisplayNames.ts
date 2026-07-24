"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

export const MANAGED_AGENT_DISPLAY_NAMES_STORAGE_KEY = "claw.managedAgentDisplayNames.v1";

const MANAGED_AGENT_DISPLAY_NAMES_CHANGE_EVENT = "claw-managed-agent-display-names-change";
const EMPTY_DISPLAY_NAMES = Object.freeze({}) as Readonly<Record<string, string>>;

interface StoredManagedAgentDisplayNames {
  version: 1;
  displayNames: Readonly<Record<string, string>>;
}

const fallbackDisplayNames = new Map<string, Readonly<Record<string, string>>>();
const cachedSnapshots = new Map<string, { raw: string | null; displayNames: Readonly<Record<string, string>> }>();
const volatileStorageKeys = new Set<string>();

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 255) : null;
}

function normalizeDisplayNames(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_DISPLAY_NAMES;
  const displayNames: Record<string, string> = {};
  for (const [candidateAgentId, candidateDisplayName] of Object.entries(value)) {
    const agentId = candidateAgentId.trim();
    const displayName = normalizeDisplayName(candidateDisplayName);
    if (!agentId || !displayName) continue;
    displayNames[agentId] = displayName;
  }
  return Object.keys(displayNames).length > 0 ? Object.freeze(displayNames) : EMPTY_DISPLAY_NAMES;
}

function parseDisplayNames(raw: string | null): Readonly<Record<string, string>> {
  if (!raw) return EMPTY_DISPLAY_NAMES;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredManagedAgentDisplayNames> | null;
    if (parsed?.version !== 1) return EMPTY_DISPLAY_NAMES;
    return normalizeDisplayNames(parsed.displayNames);
  } catch {
    return EMPTY_DISPLAY_NAMES;
  }
}

export function managedAgentDisplayNamesStorageKey(scope?: string | null): string | null {
  const normalizedScope = scope?.trim();
  return normalizedScope
    ? `${MANAGED_AGENT_DISPLAY_NAMES_STORAGE_KEY}:${encodeURIComponent(normalizedScope)}`
    : null;
}

export function managedAgentDisplayNameScope(user?: { id?: string; email?: string } | null): string | null {
  const userId = user?.id?.trim();
  if (userId && userId !== "stored-session") return `id:${userId}`;
  const email = user?.email?.trim().toLowerCase();
  return email ? `email:${email}` : null;
}

function getDisplayNamesSnapshot(storageKey: string | null): Readonly<Record<string, string>> {
  if (!storageKey || typeof window === "undefined") return EMPTY_DISPLAY_NAMES;
  const fallback = fallbackDisplayNames.get(storageKey) ?? EMPTY_DISPLAY_NAMES;
  if (volatileStorageKeys.has(storageKey)) return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const cached = cachedSnapshots.get(storageKey);
    if (cached?.raw === raw) return cached.displayNames;
    const displayNames = parseDisplayNames(raw);
    cachedSnapshots.set(storageKey, { raw, displayNames });
    fallbackDisplayNames.set(storageKey, displayNames);
    return displayNames;
  } catch {
    return fallback;
  }
}

function emitDisplayNamesChange(storageKey: string): void {
  window.dispatchEvent(new CustomEvent(MANAGED_AGENT_DISPLAY_NAMES_CHANGE_EVENT, {
    detail: { storageKey },
  }));
}

function writeDisplayNames(storageKey: string, value: Readonly<Record<string, string>>): void {
  if (typeof window === "undefined") return;
  const displayNames = normalizeDisplayNames(value);
  fallbackDisplayNames.set(storageKey, displayNames);
  let raw: string | null = null;
  try {
    if (Object.keys(displayNames).length === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      raw = JSON.stringify({ version: 1, displayNames } satisfies StoredManagedAgentDisplayNames);
      window.localStorage.setItem(storageKey, raw);
    }
    volatileStorageKeys.delete(storageKey);
  } catch {
    volatileStorageKeys.add(storageKey);
  }
  cachedSnapshots.set(storageKey, { raw, displayNames });
  emitDisplayNamesChange(storageKey);
}

function subscribeToDisplayNames(storageKey: string | null, onStoreChange: () => void): () => void {
  if (!storageKey || typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== storageKey) return;
    volatileStorageKeys.delete(storageKey);
    cachedSnapshots.delete(storageKey);
    onStoreChange();
  };
  const handleLocalChange = (event: Event) => {
    const changedStorageKey = (event as CustomEvent<{ storageKey?: string }>).detail?.storageKey;
    if (changedStorageKey && changedStorageKey !== storageKey) return;
    onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(MANAGED_AGENT_DISPLAY_NAMES_CHANGE_EVENT, handleLocalChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(MANAGED_AGENT_DISPLAY_NAMES_CHANGE_EVENT, handleLocalChange);
  };
}

export function clearManagedAgentDisplayNames(scope?: string | null): void {
  const storageKey = managedAgentDisplayNamesStorageKey(scope);
  if (!storageKey || typeof window === "undefined") return;
  volatileStorageKeys.delete(storageKey);
  cachedSnapshots.delete(storageKey);
  fallbackDisplayNames.delete(storageKey);
  writeDisplayNames(storageKey, EMPTY_DISPLAY_NAMES);
}

export function useManagedAgentDisplayNames(scope?: string | null) {
  const storageKey = useMemo(() => managedAgentDisplayNamesStorageKey(scope), [scope]);
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToDisplayNames(storageKey, onStoreChange),
    [storageKey],
  );
  const getSnapshot = useCallback(() => getDisplayNamesSnapshot(storageKey), [storageKey]);
  const displayNamesByAgentId = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_DISPLAY_NAMES);

  const setDisplayName = useCallback((agentId: string, displayName: string | null) => {
    if (!storageKey) return;
    const normalizedAgentId = agentId.trim();
    if (!normalizedAgentId) return;
    const next = { ...getDisplayNamesSnapshot(storageKey) };
    const normalizedDisplayName = normalizeDisplayName(displayName);
    if (normalizedDisplayName) next[normalizedAgentId] = normalizedDisplayName;
    else delete next[normalizedAgentId];
    writeDisplayNames(storageKey, next);
  }, [storageKey]);

  const clearDisplayName = useCallback((agentId: string) => {
    setDisplayName(agentId, null);
  }, [setDisplayName]);

  return { displayNamesByAgentId, setDisplayName, clearDisplayName };
}
