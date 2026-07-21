"use client";

import { useCallback, useSyncExternalStore } from "react";

import { sameOpenClawSelectableSessionKey } from "@/lib/openclaw-session-sdk-surface";

const SESSION_PINS_STORAGE_PREFIX = "openclaw.sessionPins.v1";
const SESSION_PINS_CHANGE_EVENT = "openclaw-session-pins-change";
const EMPTY_SESSION_KEYS: readonly string[] = Object.freeze([]);

interface StoredSessionPins {
  version: 1;
  sessionKeys: readonly string[];
}

const fallbackPins = new Map<string, readonly string[]>();
const snapshotCache = new Map<string, { raw: string | null; sessionKeys: readonly string[] }>();
const volatileStorageKeys = new Set<string>();

export function openClawSessionPinsStorageKey(agentId: string): string {
  return `${SESSION_PINS_STORAGE_PREFIX}:${agentId}`;
}

function normalizeSessionKeys(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return EMPTY_SESSION_KEYS;
  const sessionKeys: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const sessionKey = candidate.trim();
    if (!sessionKey || sessionKeys.some((key) => sameOpenClawSelectableSessionKey(key, sessionKey))) continue;
    sessionKeys.push(sessionKey);
  }
  return sessionKeys.length > 0 ? Object.freeze(sessionKeys) : EMPTY_SESSION_KEYS;
}

function parseSessionPins(raw: string | null): readonly string[] {
  if (!raw) return EMPTY_SESSION_KEYS;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSessionPins> | null;
    if (parsed?.version !== 1) return EMPTY_SESSION_KEYS;
    return normalizeSessionKeys(parsed.sessionKeys);
  } catch {
    return EMPTY_SESSION_KEYS;
  }
}

function getSessionPinsSnapshot(storageKey: string | null): readonly string[] {
  if (!storageKey || typeof window === "undefined") return EMPTY_SESSION_KEYS;
  if (volatileStorageKeys.has(storageKey)) return fallbackPins.get(storageKey) ?? EMPTY_SESSION_KEYS;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const cached = snapshotCache.get(storageKey);
    if (cached?.raw === raw) return cached.sessionKeys;
    const sessionKeys = parseSessionPins(raw);
    snapshotCache.set(storageKey, { raw, sessionKeys });
    fallbackPins.set(storageKey, sessionKeys);
    return sessionKeys;
  } catch {
    return fallbackPins.get(storageKey) ?? EMPTY_SESSION_KEYS;
  }
}

function emitSessionPinsChange(storageKey: string): void {
  window.dispatchEvent(new CustomEvent(SESSION_PINS_CHANGE_EVENT, { detail: storageKey }));
}

function writeSessionPins(storageKey: string, sessionKeys: readonly string[]): void {
  const normalized = normalizeSessionKeys(sessionKeys);
  fallbackPins.set(storageKey, normalized);
  let raw: string | null = null;
  try {
    if (normalized.length === 0) {
      window.localStorage.removeItem(storageKey);
    } else {
      raw = JSON.stringify({ version: 1, sessionKeys: normalized } satisfies StoredSessionPins);
      window.localStorage.setItem(storageKey, raw);
    }
    volatileStorageKeys.delete(storageKey);
  } catch {
    // Keep the preference in memory when storage is unavailable.
    volatileStorageKeys.add(storageKey);
  }
  snapshotCache.set(storageKey, { raw, sessionKeys: normalized });
  emitSessionPinsChange(storageKey);
}

function subscribeToSessionPins(storageKey: string | null, onStoreChange: () => void): () => void {
  if (!storageKey || typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== storageKey) return;
    volatileStorageKeys.delete(storageKey);
    snapshotCache.delete(storageKey);
    onStoreChange();
  };
  const handleLocalChange = (event: Event) => {
    if ((event as CustomEvent<string>).detail === storageKey) onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(SESSION_PINS_CHANGE_EVENT, handleLocalChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(SESSION_PINS_CHANGE_EVENT, handleLocalChange);
  };
}

export function clearOpenClawSessionPins(agentId: string | null | undefined): void {
  const normalizedAgentId = agentId?.trim();
  if (!normalizedAgentId || typeof window === "undefined") return;
  writeSessionPins(openClawSessionPinsStorageKey(normalizedAgentId), EMPTY_SESSION_KEYS);
}

export function useOpenClawSessionPins(agentId: string | null | undefined) {
  const normalizedAgentId = agentId?.trim() || null;
  const storageKey = normalizedAgentId ? openClawSessionPinsStorageKey(normalizedAgentId) : null;
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToSessionPins(storageKey, onStoreChange),
    [storageKey],
  );
  const getSnapshot = useCallback(() => getSessionPinsSnapshot(storageKey), [storageKey]);
  const pinnedSessionKeys = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SESSION_KEYS);

  const setSessionPinned = useCallback((sessionKey: string, pinned: boolean) => {
    if (!storageKey) return;
    const normalizedSessionKey = sessionKey.trim();
    if (!normalizedSessionKey) return;
    const current = getSessionPinsSnapshot(storageKey);
    const alreadyPinned = current.some((key) => sameOpenClawSelectableSessionKey(key, normalizedSessionKey));
    if (pinned === alreadyPinned) return;
    writeSessionPins(
      storageKey,
      pinned
        ? [...current, normalizedSessionKey]
        : current.filter((key) => !sameOpenClawSelectableSessionKey(key, normalizedSessionKey)),
    );
  }, [storageKey]);

  return { pinnedSessionKeys, setSessionPinned };
}
