"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getClawJourneyMode,
  getJourneyParamIntent,
  getJourneyResetRequested,
  readJourneyPreviewEnabled,
  type ClawJourneyMode,
  type JourneySearchParams,
  writeJourneyPreviewEnabled,
} from "@/lib/journey-flags";
import { JOURNEY_DAYS } from "./journey-days";
import type { JourneyCompletionEvent, JourneyDay, JourneyReceipt } from "./types";

interface StoredJourneyState {
  panelOpen?: boolean;
  activeDayId?: string | null;
  completedDayIds?: string[];
  skippedDayIds?: string[];
  lastReceipt?: JourneyReceipt | null;
}

export interface UseJourneyOptions {
  searchParams?: JourneySearchParams | null;
  searchKey?: string;
  storageScope?: string | null;
  days?: JourneyDay[];
}

export interface JourneyController {
  enabled: boolean;
  mode: ClawJourneyMode;
  preview: boolean;
  days: JourneyDay[];
  currentDay: JourneyDay | null;
  activeDayId: string | null;
  completedIds: Set<string>;
  skippedIds: Set<string>;
  completedCount: number;
  progressPercent: number;
  panelOpen: boolean;
  lastReceipt: JourneyReceipt | null;
  setPanelOpen: (open: boolean) => void;
  selectDay: (dayId: string) => void;
  completeDay: (dayId: string) => void;
  completeForEvent: (event: JourneyCompletionEvent) => void;
  skipDay: (dayId: string) => void;
  reset: () => void;
}

function readStoredJourneyState(storageKey: string): StoredJourneyState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredJourneyState;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredJourneyState(storageKey: string, state: StoredJourneyState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Journey should still work without browser storage.
  }
}

function removeStoredJourneyState(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Reset is best effort.
  }
}

function normalizeStorageScope(scope: string | null | undefined): string {
  const trimmed = scope?.trim();
  return encodeURIComponent(trimmed || "local");
}

function setFromStoredIds(ids: string[] | undefined, validIds: Set<string>): Set<string> {
  const next = new Set<string>();
  for (const id of ids ?? []) {
    if (validIds.has(id)) next.add(id);
  }
  return next;
}

function firstIncompleteDayId(days: JourneyDay[], completedIds: Set<string>): string | null {
  return days.find((day) => !completedIds.has(day.id))?.id ?? days[days.length - 1]?.id ?? null;
}

function nextIncompleteDayId(days: JourneyDay[], completedIds: Set<string>, currentDayId: string): string | null {
  const currentIndex = days.findIndex((day) => day.id === currentDayId);
  const startIndex = currentIndex === -1 ? 0 : currentIndex + 1;
  for (let index = startIndex; index < days.length; index += 1) {
    if (!completedIds.has(days[index].id)) return days[index].id;
  }
  return firstIncompleteDayId(days, completedIds);
}

function requestedDayId(searchParams: JourneySearchParams | null | undefined, days: JourneyDay[]): string | null {
  const rawDay = Number.parseInt(searchParams?.get("journeyDay") ?? "", 10);
  if (!Number.isFinite(rawDay)) return null;
  return days.find((day) => day.day === rawDay)?.id ?? null;
}

export function useJourney({
  searchParams = null,
  searchKey = "",
  storageScope,
  days = JOURNEY_DAYS,
}: UseJourneyOptions = {}): JourneyController {
  const mode = getClawJourneyMode();
  const journeyIntent = getJourneyParamIntent(searchParams?.get("journey") ?? null);
  const resetRequested = getJourneyResetRequested(searchParams);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeDayId, setActiveDayId] = useState<string | null>(days[0]?.id ?? null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  const [lastReceipt, setLastReceipt] = useState<JourneyReceipt | null>(null);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);

  const storageKey = useMemo(
    () => `claw.journey.v1:${normalizeStorageScope(storageScope)}`,
    [storageScope],
  );
  const validDayIds = useMemo(() => new Set(days.map((day) => day.id)), [days]);
  const currentDay = useMemo(
    () => days.find((day) => day.id === activeDayId) ?? days[0] ?? null,
    [activeDayId, days],
  );
  const completedCount = useMemo(
    () => days.filter((day) => completedIds.has(day.id)).length,
    [completedIds, days],
  );
  const progressPercent = days.length === 0 ? 0 : Math.round((completedCount / days.length) * 100);
  const preview = mode === "preview" && previewEnabled;
  const enabled = mode === "public" || preview;

  useEffect(() => {
    if (mode !== "preview") {
      setPreviewEnabled(false);
      return;
    }

    if (journeyIntent === "enable") {
      writeJourneyPreviewEnabled(true);
      setPreviewEnabled(true);
      return;
    }

    if (journeyIntent === "disable") {
      writeJourneyPreviewEnabled(false);
      setPreviewEnabled(false);
      return;
    }

    setPreviewEnabled(readJourneyPreviewEnabled());
  }, [journeyIntent, mode, searchKey]);

  useEffect(() => {
    if (!enabled) {
      setLoadedStorageKey(null);
      return;
    }

    if (resetRequested) {
      removeStoredJourneyState(storageKey);
      setPanelOpen(true);
      setActiveDayId(days[0]?.id ?? null);
      setCompletedIds(new Set());
      setSkippedIds(new Set());
      setLastReceipt(null);
      setLoadedStorageKey(storageKey);
      return;
    }

    const stored = readStoredJourneyState(storageKey);
    const nextCompletedIds = setFromStoredIds(stored?.completedDayIds, validDayIds);
    const storedActiveDayId = stored?.activeDayId && validDayIds.has(stored.activeDayId)
      ? stored.activeDayId
      : null;

    setPanelOpen(stored?.panelOpen ?? true);
    setCompletedIds(nextCompletedIds);
    setSkippedIds(setFromStoredIds(stored?.skippedDayIds, validDayIds));
    setActiveDayId(storedActiveDayId ?? firstIncompleteDayId(days, nextCompletedIds));
    setLastReceipt(stored?.lastReceipt ?? null);
    setLoadedStorageKey(storageKey);
  }, [days, enabled, resetRequested, storageKey, validDayIds]);

  useEffect(() => {
    if (!enabled || loadedStorageKey !== storageKey) return;
    writeStoredJourneyState(storageKey, {
      panelOpen,
      activeDayId,
      completedDayIds: Array.from(completedIds),
      skippedDayIds: Array.from(skippedIds),
      lastReceipt,
    });
  }, [activeDayId, completedIds, enabled, lastReceipt, loadedStorageKey, panelOpen, skippedIds, storageKey]);

  useEffect(() => {
    if (!enabled) return;
    const requested = requestedDayId(searchParams, days);
    if (requested) setActiveDayId(requested);
  }, [days, enabled, searchKey, searchParams]);

  const selectDay = useCallback((dayId: string) => {
    if (!enabled || !validDayIds.has(dayId)) return;
    setActiveDayId(dayId);
    setPanelOpen(true);
  }, [enabled, validDayIds]);

  const completeDay = useCallback((dayId: string) => {
    if (!enabled || !validDayIds.has(dayId)) return;
    const day = days.find((entry) => entry.id === dayId);
    if (!day) return;

    const completedWithDay = new Set(completedIds);
    completedWithDay.add(dayId);
    setCompletedIds(completedWithDay);
    setSkippedIds((current) => {
      if (!current.has(dayId)) return current;
      const next = new Set(current);
      next.delete(dayId);
      return next;
    });
    setLastReceipt({ dayId, text: day.receipt, timestamp: Date.now() });
    setActiveDayId((current) => current === dayId
      ? nextIncompleteDayId(days, completedWithDay, dayId) ?? dayId
      : current ?? firstIncompleteDayId(days, completedWithDay));
    setPanelOpen(true);
  }, [completedIds, days, enabled, validDayIds]);

  const completeForEvent = useCallback((event: JourneyCompletionEvent) => {
    if (!enabled) return;
    const targetDay = days.find((day) => day.completionEvents.includes(event) && !completedIds.has(day.id));
    if (targetDay) completeDay(targetDay.id);
  }, [completeDay, completedIds, days, enabled]);

  const skipDay = useCallback((dayId: string) => {
    if (!enabled || !validDayIds.has(dayId)) return;
    setSkippedIds((current) => new Set(current).add(dayId));
    setActiveDayId(nextIncompleteDayId(days, completedIds, dayId) ?? dayId);
  }, [completedIds, days, enabled, validDayIds]);

  const reset = useCallback(() => {
    if (!enabled) return;
    removeStoredJourneyState(storageKey);
    setPanelOpen(true);
    setActiveDayId(days[0]?.id ?? null);
    setCompletedIds(new Set());
    setSkippedIds(new Set());
    setLastReceipt(null);
  }, [days, enabled, storageKey]);

  return {
    enabled,
    mode,
    preview,
    days,
    currentDay: enabled ? currentDay : null,
    activeDayId: enabled ? activeDayId : null,
    completedIds,
    skippedIds,
    completedCount,
    progressPercent,
    panelOpen,
    lastReceipt,
    setPanelOpen,
    selectDay,
    completeDay,
    completeForEvent,
    skipDay,
    reset,
  };
}
