"use client";

import { useSyncExternalStore } from "react";

export const AGENT_ROSTER_SHOW_OFFLINE_STORAGE_KEY = "claw.agentRosterShowOffline.v1";

const AGENT_ROSTER_SHOW_OFFLINE_CHANGE_EVENT = "claw-agent-roster-show-offline-change";
let fallbackShowOffline = true;
let volatileStorage = false;

function getAgentRosterShowOfflineSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  if (volatileStorage) return fallbackShowOffline;
  try {
    fallbackShowOffline = window.localStorage.getItem(AGENT_ROSTER_SHOW_OFFLINE_STORAGE_KEY) !== "false";
    return fallbackShowOffline;
  } catch {
    volatileStorage = true;
    return fallbackShowOffline;
  }
}

function subscribeToAgentRosterShowOffline(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== AGENT_ROSTER_SHOW_OFFLINE_STORAGE_KEY) return;
    volatileStorage = false;
    onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(AGENT_ROSTER_SHOW_OFFLINE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(AGENT_ROSTER_SHOW_OFFLINE_CHANGE_EVENT, onStoreChange);
  };
}

function setAgentRosterShowOffline(showOffline: boolean): void {
  fallbackShowOffline = showOffline;
  try {
    window.localStorage.setItem(AGENT_ROSTER_SHOW_OFFLINE_STORAGE_KEY, String(showOffline));
    volatileStorage = false;
  } catch {
    volatileStorage = true;
  }
  window.dispatchEvent(new CustomEvent(AGENT_ROSTER_SHOW_OFFLINE_CHANGE_EVENT));
}

export function useAgentRosterShowOffline(): readonly [boolean, (showOffline: boolean) => void] {
  const showOffline = useSyncExternalStore(
    subscribeToAgentRosterShowOffline,
    getAgentRosterShowOfflineSnapshot,
    () => true,
  );
  return [showOffline, setAgentRosterShowOffline] as const;
}
