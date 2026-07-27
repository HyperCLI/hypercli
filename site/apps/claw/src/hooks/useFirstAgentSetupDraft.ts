"use client";

import { useMemo, useSyncExternalStore } from "react";

export const FIRST_AGENT_SETUP_DRAFT_KEY = "hypercli-first-agent-draft";

const FIRST_AGENT_SETUP_DRAFT_CHANGE_EVENT = "claw-first-agent-setup-draft-change";
const HELP_CATEGORIES = new Set(["General", "Research", "Support", "Sales", "Ops", "Dev", "Content", "Automation"]);

export interface FirstAgentSetupDraft {
  source: "first-agent-setup";
  name: string;
  description: string;
  size: string | null;
  iconIndex: number;
  category: string;
  plan: string | null;
  enableDesktop: boolean;
  enableMemoryIndex: boolean;
  enableCustomImage: boolean;
  customImage: string;
  updatedAt: number;
}

export type FirstAgentSetupDraftInput = Omit<FirstAgentSetupDraft, "source" | "updatedAt">;

let fallbackRawDraft: string | null = null;
let volatileStorage = false;

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || null;
}

export function parseFirstAgentSetupDraft(raw: string | null): FirstAgentSetupDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.source !== "first-agent-setup") return null;
    const name = normalizeOptionalString(value.name, 80);
    if (!name) return null;
    const iconIndex = Number(value.iconIndex);
    const category = typeof value.category === "string" && HELP_CATEGORIES.has(value.category)
      ? value.category
      : "General";
    const updatedAt = Number(value.updatedAt);
    return {
      source: "first-agent-setup",
      name,
      description: normalizeOptionalString(value.description, 300) ?? "",
      size: normalizeOptionalString(value.size, 40),
      iconIndex: Number.isFinite(iconIndex) ? Math.abs(Math.trunc(iconIndex)) % 16 : 0,
      category,
      plan: normalizeOptionalString(value.plan, 80),
      enableDesktop: Boolean(value.enableDesktop),
      enableMemoryIndex: Boolean(value.enableMemoryIndex),
      enableCustomImage: Boolean(value.enableCustomImage),
      customImage: normalizeOptionalString(value.customImage, 500) ?? "",
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function getFirstAgentSetupDraftRawSnapshot(): string | null {
  if (typeof window === "undefined") return null;
  if (volatileStorage) return fallbackRawDraft;
  try {
    fallbackRawDraft = window.sessionStorage.getItem(FIRST_AGENT_SETUP_DRAFT_KEY);
    return fallbackRawDraft;
  } catch {
    volatileStorage = true;
    return fallbackRawDraft;
  }
}

function emitFirstAgentSetupDraftChange(): void {
  window.dispatchEvent(new CustomEvent(FIRST_AGENT_SETUP_DRAFT_CHANGE_EVENT));
}

function writeFirstAgentSetupDraftRaw(raw: string | null): void {
  fallbackRawDraft = raw;
  try {
    if (raw) window.sessionStorage.setItem(FIRST_AGENT_SETUP_DRAFT_KEY, raw);
    else window.sessionStorage.removeItem(FIRST_AGENT_SETUP_DRAFT_KEY);
    volatileStorage = false;
  } catch {
    volatileStorage = true;
  }
  emitFirstAgentSetupDraftChange();
}

function subscribeToFirstAgentSetupDraft(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== FIRST_AGENT_SETUP_DRAFT_KEY) return;
    volatileStorage = false;
    onStoreChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(FIRST_AGENT_SETUP_DRAFT_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(FIRST_AGENT_SETUP_DRAFT_CHANGE_EVENT, onStoreChange);
  };
}

export function readFirstAgentSetupDraft(): FirstAgentSetupDraft | null {
  return parseFirstAgentSetupDraft(getFirstAgentSetupDraftRawSnapshot());
}

export function writeFirstAgentSetupDraft(input: FirstAgentSetupDraftInput): void {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify({
    ...input,
    source: "first-agent-setup",
    updatedAt: Date.now(),
  });
  const draft = parseFirstAgentSetupDraft(raw);
  if (!draft) return;
  writeFirstAgentSetupDraftRaw(JSON.stringify(draft));
}

export function updateFirstAgentSetupDraftPlan(planId: string): void {
  const draft = readFirstAgentSetupDraft();
  const normalizedPlanId = planId.trim();
  if (!draft || !normalizedPlanId) return;
  writeFirstAgentSetupDraft({ ...draft, plan: normalizedPlanId });
}

export function clearFirstAgentSetupDraft(): void {
  if (typeof window === "undefined") return;
  writeFirstAgentSetupDraftRaw(null);
}

export function useFirstAgentSetupDraft(): FirstAgentSetupDraft | null {
  const rawDraft = useSyncExternalStore(
    subscribeToFirstAgentSetupDraft,
    getFirstAgentSetupDraftRawSnapshot,
    () => null,
  );
  return useMemo(() => parseFirstAgentSetupDraft(rawDraft), [rawDraft]);
}
