"use client";

import { useSyncExternalStore } from "react";

export const AGENT_ROSTER_COLLAPSED_STORAGE_KEY = "claw.agentRosterCollapsed.v1";

const AGENT_ROSTER_COLLAPSED_CHANGE_EVENT = "claw-agent-roster-collapsed-change";
let fallbackCollapsed = false;
let volatileStorage = false;

function getAgentRosterCollapsedSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  if (volatileStorage) return fallbackCollapsed;
  try {
    fallbackCollapsed = window.localStorage.getItem(AGENT_ROSTER_COLLAPSED_STORAGE_KEY) === "true";
    return fallbackCollapsed;
  } catch {
    volatileStorage = true;
    return fallbackCollapsed;
  }
}

function subscribeToAgentRosterCollapsed(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== AGENT_ROSTER_COLLAPSED_STORAGE_KEY) return;
    volatileStorage = false;
    onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(AGENT_ROSTER_COLLAPSED_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(AGENT_ROSTER_COLLAPSED_CHANGE_EVENT, onStoreChange);
  };
}

function setAgentRosterCollapsed(collapsed: boolean): void {
  fallbackCollapsed = collapsed;
  try {
    window.localStorage.setItem(AGENT_ROSTER_COLLAPSED_STORAGE_KEY, String(collapsed));
    volatileStorage = false;
  } catch {
    // Keep the current page usable when browser storage is unavailable.
    volatileStorage = true;
  }
  window.dispatchEvent(new CustomEvent(AGENT_ROSTER_COLLAPSED_CHANGE_EVENT));
}

export function useAgentRosterCollapsed(): readonly [boolean, (collapsed: boolean) => void] {
  const collapsed = useSyncExternalStore(
    subscribeToAgentRosterCollapsed,
    getAgentRosterCollapsedSnapshot,
    () => false,
  );
  return [collapsed, setAgentRosterCollapsed] as const;
}
