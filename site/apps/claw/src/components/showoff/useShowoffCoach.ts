"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ShowoffStep } from "./types";

export interface UseShowoffCoachOptions {
  steps: ShowoffStep[];
  storageKey?: string;
  initiallyOpen?: boolean;
}

interface StoredShowoffState {
  open?: boolean;
  activeIndex?: number;
  completedIds?: string[];
}

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

function readStoredState(storageKey: string): StoredShowoffState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredShowoffState;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredState(storageKey: string, state: StoredShowoffState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Persistence is optional; the showoff should still work if storage is unavailable.
  }
}

export function useShowoffCoach({
  steps,
  storageKey,
  initiallyOpen = true,
}: UseShowoffCoachOptions) {
  const [open, setOpen] = useState(initiallyOpen);
  const [activeIndex, setActiveIndex] = useState(0);
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set());
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);

  const stepIds = useMemo(() => new Set(steps.map((step) => step.id)), [steps]);

  useEffect(() => {
    setActiveIndex((current) => clampIndex(current, steps.length));
    setCompletedIds((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (stepIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [stepIds, steps.length]);

  useEffect(() => {
    if (!storageKey) {
      setLoadedStorageKey(null);
      return;
    }

    const stored = readStoredState(storageKey);
    if (!stored) {
      setOpen(initiallyOpen);
      setActiveIndex(0);
      setCompletedIds(new Set());
      setLoadedStorageKey(storageKey);
      return;
    }

    setOpen(stored.open ?? initiallyOpen);
    setActiveIndex(stored.activeIndex ?? 0);
    setCompletedIds(new Set(stored.completedIds ?? []));
    setLoadedStorageKey(storageKey);
  }, [initiallyOpen, storageKey]);

  useEffect(() => {
    if (!storageKey || loadedStorageKey !== storageKey) return;
    writeStoredState(storageKey, {
      open,
      activeIndex,
      completedIds: Array.from(completedIds),
    });
  }, [activeIndex, completedIds, loadedStorageKey, open, storageKey]);

  const activeStep = steps[activeIndex] ?? steps[0] ?? null;
  const activeTargetId = open ? activeStep?.targetId ?? null : null;
  const progress = steps.length === 0 ? 0 : Math.round((completedIds.size / steps.length) * 100);

  const completeStep = useCallback((stepId: string) => {
    setCompletedIds((current) => {
      if (current.has(stepId)) return current;
      const next = new Set(current);
      next.add(stepId);
      return next;
    });
  }, []);

  const goBack = useCallback(() => {
    setError(null);
    setActiveIndex((current) => clampIndex(current - 1, steps.length));
  }, [steps.length]);

  const goNext = useCallback(() => {
    setError(null);
    const step = steps[activeIndex];
    if (step) {
      completeStep(step.id);
    }

    if (activeIndex >= steps.length - 1) {
      setOpen(false);
      return;
    }

    setActiveIndex((current) => clampIndex(current + 1, steps.length));
  }, [activeIndex, completeStep, steps]);

  const close = useCallback(() => {
    setError(null);
    setOpen(false);
  }, []);

  const openCoach = useCallback(() => {
    setError(null);
    setOpen(true);
  }, []);

  const restart = useCallback(() => {
    setError(null);
    setCompletedIds(new Set());
    setActiveIndex(0);
    setOpen(true);
  }, []);

  const selectStep = useCallback((index: number) => {
    setError(null);
    setActiveIndex(clampIndex(index, steps.length));
    setOpen(true);
  }, [steps.length]);

  const runStepAction = useCallback(async (step: ShowoffStep) => {
    setError(null);
    setRunningActionId(step.id);
    try {
      await step.onAction?.();
      if (step.completeOnAction !== false) {
        completeStep(step.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Showoff action failed");
    } finally {
      setRunningActionId(null);
    }
  }, [completeStep]);

  return {
    open,
    activeIndex,
    activeStep,
    activeTargetId,
    completedIds,
    runningActionId,
    error,
    progress,
    close,
    openCoach,
    restart,
    selectStep,
    goBack,
    goNext,
    completeStep,
    runStepAction,
  };
}
