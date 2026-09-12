import { useEffect, useState } from "react";

export interface Persona {
  color?: string;
  icon?: string;
  image?: string;
  title?: string;
  description?: string;
}

const STORAGE_KEY = "desktop-ng-personas";
const CHANGED_EVENT = "desktop-ng-personas-changed";

function loadAll(): Record<string, Persona> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function getPersona(agentId: string): Persona {
  return loadAll()[agentId] ?? {};
}

export function setPersona(agentId: string, patch: Persona) {
  const all = loadAll();
  all[agentId] = { ...all[agentId], ...patch };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function usePersona(agentId: string | null): Persona {
  const [persona, setPersonaState] = useState<Persona>(() =>
    agentId ? getPersona(agentId) : {},
  );
  useEffect(() => {
    const update = () => setPersonaState(agentId ? getPersona(agentId) : {});
    update();
    window.addEventListener(CHANGED_EVENT, update);
    return () => window.removeEventListener(CHANGED_EVENT, update);
  }, [agentId]);
  return persona;
}

export const PERSONA_COLORS = [
  "#c97b12",
  "#d0483b",
  "#3d9b63",
  "#7c5cd6",
  "#4a6fd6",
  "#2f9e8f",
  "#c24e7a",
  "#7a7a33",
  "#5b7fa6",
  "#8a8a8a",
  "#3d9b6a",
  "#b0692e",
];

export const PERSONA_ICONS = [
  "bot",
  "briefcase",
  "triangle",
  "mail",
  "flame",
  "globe",
  "star",
  "zap",
  "sparkles",
  "rocket",
  "wand",
  "compass",
  "terminal",
  "code",
  "brain",
  "palette",
] as const;
