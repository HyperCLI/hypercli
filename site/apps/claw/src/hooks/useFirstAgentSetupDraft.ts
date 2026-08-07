"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  parseOpenClawBootstrapDraft,
  type OpenClawBootstrapDraft,
} from "@/lib/openclaw-bootstrap-pack";

export const FIRST_AGENT_SETUP_DRAFT_KEY = "hypercli-first-agent-draft";

const FIRST_AGENT_SETUP_DRAFT_CHANGE_EVENT = "claw-first-agent-setup-draft-change";
const HELP_CATEGORIES = new Set(["General", "Research", "Support", "Sales", "Ops", "Dev", "Content", "Automation"]);

export interface FirstAgentSetupDraft {
  source: "first-agent-setup";
  setupId: string;
  principalId: string | null;
  workspaceId: string | null;
  knowledgeDomainId: string | null;
  name: string;
  displayName: string;
  description: string;
  size: string | null;
  iconIndex: number;
  category: string;
  plan: string | null;
  enableDesktop: boolean;
  enableMemoryIndex: boolean;
  enableCustomImage: boolean;
  customImage: string;
  bootstrapDraft: OpenClawBootstrapDraft | null;
  updatedAt: number;
}

export type FirstAgentSetupDraftInput = Omit<
  FirstAgentSetupDraft,
  "source" | "updatedAt" | "setupId" | "principalId" | "workspaceId" | "bootstrapDraft"
> & Partial<Pick<FirstAgentSetupDraft, "setupId" | "principalId" | "workspaceId" | "bootstrapDraft">>;

let fallbackRawDraft: string | null = null;
let volatileStorage = false;

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || null;
}

export function createFirstAgentSetupId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `setup-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseFirstAgentSetupDraft(raw: string | null): FirstAgentSetupDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.source !== "first-agent-setup") return null;
    const name = normalizeOptionalString(value.name, 80);
    if (!name) return null;
    const displayName = "displayName" in value
      ? normalizeOptionalString(value.displayName, 64) ?? ""
      : name.slice(0, 64);
    const iconIndex = Number(value.iconIndex);
    const category = typeof value.category === "string" && HELP_CATEGORIES.has(value.category)
      ? value.category
      : "General";
    const updatedAt = Number(value.updatedAt);
    const normalizedUpdatedAt = Number.isFinite(updatedAt) ? updatedAt : 0;
    return {
      source: "first-agent-setup",
      setupId: normalizeOptionalString(value.setupId, 100) ?? `legacy-${normalizedUpdatedAt}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      principalId: normalizeOptionalString(value.principalId, 100),
      workspaceId: normalizeOptionalString(value.workspaceId, 100),
      knowledgeDomainId: normalizeOptionalString(value.knowledgeDomainId, 100),
      name,
      displayName,
      description: normalizeOptionalString(value.description, 300) ?? "",
      size: normalizeOptionalString(value.size, 40),
      iconIndex: Number.isFinite(iconIndex) ? Math.abs(Math.trunc(iconIndex)) % 16 : 0,
      category,
      plan: normalizeOptionalString(value.plan, 80),
      enableDesktop: Boolean(value.enableDesktop),
      enableMemoryIndex: Boolean(value.enableMemoryIndex),
      enableCustomImage: Boolean(value.enableCustomImage),
      customImage: normalizeOptionalString(value.customImage, 500) ?? "",
      bootstrapDraft: parseOpenClawBootstrapDraft(value.bootstrapDraft),
      updatedAt: normalizedUpdatedAt,
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
  const existing = readFirstAgentSetupDraft();
  const raw = JSON.stringify({
    ...input,
    setupId: normalizeOptionalString(input.setupId, 100) ?? existing?.setupId ?? createFirstAgentSetupId(),
    principalId: "principalId" in input
      ? normalizeOptionalString(input.principalId, 100)
      : existing?.principalId ?? null,
    workspaceId: "workspaceId" in input
      ? normalizeOptionalString(input.workspaceId, 100)
      : existing?.workspaceId ?? null,
    bootstrapDraft: input.bootstrapDraft ?? existing?.bootstrapDraft ?? null,
    source: "first-agent-setup",
    updatedAt: Date.now(),
  });
  const draft = parseFirstAgentSetupDraft(raw);
  if (!draft) return;
  writeFirstAgentSetupDraftRaw(JSON.stringify(draft));
}

export function updateFirstAgentSetupDraftPlan(planId: string, size?: string | null): void {
  const draft = readFirstAgentSetupDraft();
  const normalizedPlanId = planId.trim();
  if (!draft || !normalizedPlanId) return;
  writeFirstAgentSetupDraft({
    ...draft,
    plan: normalizedPlanId,
    size: normalizeOptionalString(size, 40) ?? draft.size,
  });
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
