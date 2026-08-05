"use client";

import { useSyncExternalStore } from "react";

export type AgentStartupExperience = "tips" | "classic";

export const AGENT_STARTUP_EXPERIENCE_STORAGE_KEY = "claw.agentStartupExperience.v1";

const AGENT_STARTUP_EXPERIENCE_CHANGE_EVENT = "claw-agent-startup-experience-change";
const DEFAULT_AGENT_STARTUP_EXPERIENCE: AgentStartupExperience = "tips";

let fallbackExperience: AgentStartupExperience = DEFAULT_AGENT_STARTUP_EXPERIENCE;
let volatileStorage = false;

function parseAgentStartupExperience(value: string | null): AgentStartupExperience {
  return value === "classic" ? "classic" : DEFAULT_AGENT_STARTUP_EXPERIENCE;
}

function getAgentStartupExperienceSnapshot(): AgentStartupExperience {
  if (typeof window === "undefined") return DEFAULT_AGENT_STARTUP_EXPERIENCE;
  if (volatileStorage) return fallbackExperience;
  try {
    fallbackExperience = parseAgentStartupExperience(
      window.localStorage.getItem(AGENT_STARTUP_EXPERIENCE_STORAGE_KEY),
    );
    return fallbackExperience;
  } catch {
    volatileStorage = true;
    return fallbackExperience;
  }
}

function subscribeToAgentStartupExperience(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== AGENT_STARTUP_EXPERIENCE_STORAGE_KEY) return;
    volatileStorage = false;
    onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(AGENT_STARTUP_EXPERIENCE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(AGENT_STARTUP_EXPERIENCE_CHANGE_EVENT, onStoreChange);
  };
}

function setAgentStartupExperience(experience: AgentStartupExperience): void {
  fallbackExperience = experience;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AGENT_STARTUP_EXPERIENCE_STORAGE_KEY, experience);
    volatileStorage = false;
  } catch {
    volatileStorage = true;
  }
  window.dispatchEvent(new CustomEvent(AGENT_STARTUP_EXPERIENCE_CHANGE_EVENT));
}

export function useAgentStartupExperience(): readonly [
  AgentStartupExperience,
  (experience: AgentStartupExperience) => void,
] {
  const experience = useSyncExternalStore(
    subscribeToAgentStartupExperience,
    getAgentStartupExperienceSnapshot,
    () => DEFAULT_AGENT_STARTUP_EXPERIENCE,
  );
  return [experience, setAgentStartupExperience] as const;
}
