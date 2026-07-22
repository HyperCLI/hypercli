"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CheckCircle2, GripHorizontal, RotateCcw, Sparkles, X } from "lucide-react";

import {
  getJourneyCapabilitiesForDay,
  type JourneyCapabilityCard,
  type JourneyCapabilityContext,
} from "./journey-capabilities";
import type { JourneyController } from "./useJourney";
import type { JourneyBriefPreviewItem, JourneyDay } from "./types";

interface JourneyFloatingPanelProps {
  journey: JourneyController;
  onRunDayAction: (day: JourneyDay) => void;
  onRunCapabilityPrompt: (capability: JourneyCapabilityCard, day: JourneyDay) => void;
  onOpenCapability: (capability: JourneyCapabilityCard, day: JourneyDay) => void;
  capabilityContext?: JourneyCapabilityContext;
}

interface FloatingPosition {
  left: number;
  top: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originLeft: number;
  originTop: number;
  moved: boolean;
}

const JOURNEY_PANEL_POSITION_KEY = "claw.journey.panelPosition.v1";
const POSITION_MARGIN = 12;
const DRAG_CLICK_THRESHOLD = 4;
const COLLAPSED_RECEIPT_LABELS: Record<string, string> = {
  brief: "Brief started",
  sources: "Source added",
  rules: "Boundaries set",
  "real-work": "Real work tried",
  understanding: "Review added",
  connections: "Work tools noted",
  repeatable: "Workflow ready",
};
const COLLAPSED_NEXT_LABELS: Record<string, string> = {
  brief: "Brief next",
  sources: "Add source",
  rules: "Set boundaries",
  "real-work": "Try real work",
  understanding: "Review next",
  connections: "Choose connection",
  repeatable: "Workflow next",
};

function receiptIsCurrent(day: JourneyDay, journey: JourneyController): boolean {
  return journey.lastReceipt?.dayId === day.id;
}

function collapsedJourneyLabel(day: JourneyDay, journey: JourneyController): string {
  const receiptDayId = journey.lastReceipt?.dayId;
  if (receiptDayId && journey.completedIds.has(receiptDayId)) {
    return `Journey · ${COLLAPSED_RECEIPT_LABELS[receiptDayId] ?? "Progress added"}`;
  }
  return `Journey · ${COLLAPSED_NEXT_LABELS[day.id] ?? `Mission ${day.day}`}`;
}

function buildBriefPreviewItems(journey: JourneyController): JourneyBriefPreviewItem[] {
  return [
    { id: "brief", label: "Starting direction", complete: journey.completedIds.has("brief") },
    { id: "sources", label: "Trusted source", complete: journey.completedIds.has("sources") },
    { id: "rules", label: "Boundaries", complete: journey.completedIds.has("rules") },
    { id: "real-work", label: "Real task", complete: journey.completedIds.has("real-work") },
    { id: "understanding", label: "Review notes", complete: journey.completedIds.has("understanding") },
    { id: "connections", label: "Work tools", complete: journey.completedIds.has("connections") },
    { id: "repeatable", label: "Repeatable workflow", complete: journey.completedIds.has("repeatable") },
  ];
}

function readStoredPosition(): FloatingPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(JOURNEY_PANEL_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatingPosition>;
    return typeof parsed.left === "number" && typeof parsed.top === "number"
      ? { left: parsed.left, top: parsed.top }
      : null;
  } catch {
    return null;
  }
}

function writeStoredPosition(position: FloatingPosition): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(JOURNEY_PANEL_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Position persistence is optional.
  }
}

function samePosition(a: FloatingPosition, b: FloatingPosition): boolean {
  return Math.round(a.left) === Math.round(b.left) && Math.round(a.top) === Math.round(b.top);
}

function clampPosition(position: FloatingPosition, element: HTMLElement | null): FloatingPosition {
  if (typeof window === "undefined") return position;
  const width = element?.offsetWidth || Math.min(408, window.innerWidth - POSITION_MARGIN * 2);
  const height = element?.offsetHeight || 64;
  const maxLeft = Math.max(POSITION_MARGIN, window.innerWidth - width - POSITION_MARGIN);
  const maxTop = Math.max(POSITION_MARGIN, window.innerHeight - height - POSITION_MARGIN);

  return {
    left: Math.min(Math.max(position.left, POSITION_MARGIN), maxLeft),
    top: Math.min(Math.max(position.top, POSITION_MARGIN), maxTop),
  };
}

export function JourneyFloatingPanel({ journey, onRunDayAction, onRunCapabilityPrompt, onOpenCapability, capabilityContext }: JourneyFloatingPanelProps) {
  const floatingRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressNextClickRef = useRef(false);
  const reducedMotion = useReducedMotion();
  const [position, setPosition] = useState<FloatingPosition | null>(() => readStoredPosition());
  const [dragging, setDragging] = useState(false);
  const day = journey.currentDay;

  const dayComplete = day ? journey.completedIds.has(day.id) : false;
  const capabilityCards = day ? getJourneyCapabilitiesForDay(day.id, capabilityContext).slice(0, 2) : [];
  const briefPreviewItems = buildBriefPreviewItems(journey);
  const latestBriefItemId = journey.lastReceipt?.dayId ?? null;
  const collapsedLabel = day ? collapsedJourneyLabel(day, journey) : "Journey";
  const progressLabel = `${journey.completedCount} of ${journey.days.length} missions complete`;
  const positionedClassName = position ? "" : journey.panelOpen ? "bottom-3 right-3 sm:bottom-5 sm:right-5" : "bottom-4 right-4 sm:bottom-5 sm:right-5";
  const floatingStyle = position ? { left: position.left, top: position.top } : undefined;
  const setFloatingRef = useCallback((node: HTMLElement | null) => {
    floatingRef.current = node;
  }, []);

  const commitPosition = useCallback((nextPosition: FloatingPosition) => {
    const clamped = clampPosition(nextPosition, floatingRef.current);
    setPosition((current) => (current && samePosition(current, clamped) ? current : clamped));
    return clamped;
  }, []);

  const startDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const element = floatingRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const origin = clampPosition({ left: rect.left, top: rect.top }, element);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: origin.left,
      originTop: origin.top,
      moved: false,
    };
    setPosition(origin);
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const moveDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    if (Math.abs(deltaX) > DRAG_CLICK_THRESHOLD || Math.abs(deltaY) > DRAG_CLICK_THRESHOLD) {
      dragState.moved = true;
    }
    commitPosition({ left: dragState.originLeft + deltaX, top: dragState.originTop + deltaY });
  }, [commitPosition]);

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const nextPosition = commitPosition({
      left: dragState.originLeft + event.clientX - dragState.startX,
      top: dragState.originTop + event.clientY - dragState.startY,
    });
    writeStoredPosition(nextPosition);
    suppressNextClickRef.current = dragState.moved;
    dragStateRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [commitPosition]);

  const moveByKeyboard = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const deltas: Partial<Record<string, FloatingPosition>> = {
      ArrowLeft: { left: -step, top: 0 },
      ArrowRight: { left: step, top: 0 },
      ArrowUp: { left: 0, top: -step },
      ArrowDown: { left: 0, top: step },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const rect = floatingRef.current?.getBoundingClientRect();
    const current = position ?? (rect ? { left: rect.left, top: rect.top } : { left: POSITION_MARGIN, top: POSITION_MARGIN });
    const nextPosition = commitPosition({ left: current.left + delta.left, top: current.top + delta.top });
    writeStoredPosition(nextPosition);
  }, [commitPosition, position]);

  useEffect(() => {
    if (!position) return;
    const handleResize = () => {
      const nextPosition = clampPosition(position, floatingRef.current);
      if (samePosition(position, nextPosition)) return;
      setPosition(nextPosition);
      writeStoredPosition(nextPosition);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, [journey.panelOpen, position]);

  if (!journey.enabled || !day) return null;

  if (!journey.panelOpen) {
    return (
      <motion.button
        key={journey.lastReceipt?.timestamp ?? "collapsed-journey"}
        ref={setFloatingRef}
        type="button"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(event) => {
          if (suppressNextClickRef.current) {
            suppressNextClickRef.current = false;
            event.preventDefault();
            return;
          }
          journey.setPanelOpen(true);
        }}
        style={floatingStyle}
        initial={false}
        className={`fixed ${positionedClassName} z-50 inline-flex touch-none items-center gap-2 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-popover/95 px-3.5 py-2 text-sm font-semibold text-[var(--selection-accent)] shadow-[0_18px_56px_rgba(0,0,0,0.38)] backdrop-blur transition-colors hover:bg-surface-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.55)] ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        aria-label={`Open Journey mission ${day.day}`}
        title="Drag to move. Click to open Journey."
      >
        <Sparkles className="h-4 w-4" />
        <span>{collapsedLabel}</span>
      </motion.button>
    );
  }

  return (
    <AnimatePresence>
      <motion.section
        ref={setFloatingRef}
        aria-label="Today's Journey"
        initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reducedMotion ? undefined : { opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        style={floatingStyle}
        className={`fixed ${positionedClassName} z-50 max-h-[calc(100dvh-1.5rem)] w-[min(25.5rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-border bg-popover/95 text-foreground shadow-[0_24px_90px_rgba(0,0,0,0.48)] backdrop-blur-xl`}
      >
        <div className="h-1 bg-border">
          <div
            className="h-full bg-[var(--selection-accent)] transition-[width] duration-300"
            style={{ width: `${journey.progressPercent}%` }}
          />
        </div>

        <div className="max-h-[calc(100dvh-1.75rem)] overflow-y-auto p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.22)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--selection-accent)]">
                <Sparkles className="h-3.5 w-3.5" />
                Today&apos;s Journey
              </div>
              <p className="mt-2 text-xs font-medium text-text-muted">{progressLabel}</p>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={moveByKeyboard}
                className={`flex h-8 w-8 touch-none items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-high hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
                title="Move Journey"
                aria-label="Move Journey panel"
              >
                <GripHorizontal className="h-4 w-4" />
              </button>
              {journey.preview && (
                <button
                  type="button"
                  onClick={journey.reset}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-high hover:text-foreground"
                  title="Reset Journey progress"
                  aria-label="Reset Journey progress"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => journey.setPanelOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-high hover:text-foreground"
                title="Close Journey"
                aria-label="Close Journey"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-1.5" aria-label="Journey missions">
            {journey.days.map((entry) => {
              const selected = entry.id === day.id;
              const complete = journey.completedIds.has(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => journey.selectDay(entry.id)}
                  aria-label={`Open Journey mission ${entry.day}: ${entry.title}`}
                  aria-current={selected ? "step" : undefined}
                  className={`h-2 flex-1 rounded-full transition-colors ${
                    complete
                      ? "bg-[var(--selection-accent)]"
                      : selected
                        ? "bg-text-secondary"
                        : "bg-border hover:bg-border-strong"
                  }`}
                />
              );
            })}
          </div>

          <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={day.id}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="mt-4 rounded-2xl border border-border bg-background/60 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--selection-accent)]">
                  Mission {day.day} of {journey.days.length}
                </p>
                <h2 className="mt-1 text-lg font-semibold leading-tight text-foreground">{day.title}</h2>
              </div>
              {dayComplete && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.25)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-2 py-1 text-xs font-semibold text-[var(--selection-accent)]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Added
                </span>
              )}
            </div>

            <p className="mt-3 text-sm font-medium leading-6 text-foreground">{day.mission}</p>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{day.why}</p>

            <div className="mt-4 rounded-xl border border-border bg-surface-high/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Agent Brief</p>
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {briefPreviewItems.map((item) => {
                  const latest = item.id === latestBriefItemId;
                  return (
                  <motion.span
                    key={item.id}
                    initial={false}
                    animate={latest && !reducedMotion ? {
                      boxShadow: [
                        "0 0 0 0 rgb(var(--selection-accent-rgb) / 0)",
                        "0 0 0 1px rgb(var(--selection-accent-rgb) / 0.5)",
                        "0 0 0 0 rgb(var(--selection-accent-rgb) / 0)",
                      ],
                    } : undefined}
                    transition={{ duration: 1.25, ease: "easeOut" }}
                    className={`inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium ${
                      item.complete
                        ? "border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] text-[var(--selection-accent)]"
                        : latest
                          ? "border-[rgb(var(--selection-accent-rgb)_/_0.2)] bg-[rgb(var(--selection-accent-rgb)_/_0.045)] text-text-secondary"
                        : "border-border bg-surface-high/40 text-text-muted"
                    }`}
                  >
                    {item.complete ? <CheckCircle2 className="h-3 w-3 shrink-0" /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" />}
                    <span className="truncate">{item.label}</span>
                  </motion.span>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Current focus</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {day.briefFocus.map((item) => (
                  <span key={item} className="rounded-full border border-border bg-surface-high/40 px-2 py-1 text-xs font-medium text-text-secondary">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {day.promptChips?.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {day.promptChips.map((prompt) => (
                  <span key={prompt} className="rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.09)] px-2 py-1 text-xs font-medium text-[var(--selection-accent)]">
                    {prompt}
                  </span>
                ))}
              </div>
            ) : null}

            {capabilityCards.length ? (
              <div className="mt-4 rounded-xl border border-border bg-surface-high/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Capabilities</p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">Use one if it helps this mission.</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  {capabilityCards.map((capability) => {
                    const CapabilityIcon = capability.icon;
                    return (
                      <div key={capability.id} className="rounded-xl border border-border bg-background/60 p-3">
                        <div className="flex items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]">
                            <CapabilityIcon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold leading-5 text-foreground">{capability.title}</p>
                            {capability.reason ? (
                              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--selection-accent)]">{capability.reason}</p>
                            ) : null}
                            <p className="mt-1 text-xs leading-5 text-text-secondary">{capability.description}</p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onRunCapabilityPrompt(capability, day)}
                            className="inline-flex h-8 items-center rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.28)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-3 text-xs font-semibold text-[var(--selection-accent)] transition-colors hover:bg-[rgb(var(--selection-accent-rgb)_/_0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.5)]"
                          >
                            {capability.actionLabel}
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenCapability(capability, day)}
                            className="h-8 rounded-full px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-high hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
                            aria-label={`See ${capability.displayName} capability`}
                          >
                            See capability
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {receiptIsCurrent(day, journey) && journey.lastReceipt ? (
              <motion.div
                key={journey.lastReceipt.timestamp}
                initial={reducedMotion ? false : { opacity: 0, y: 6, boxShadow: "0 0 0 0 rgb(var(--selection-accent-rgb) / 0)" }}
                animate={reducedMotion ? { opacity: 1 } : {
                  opacity: 1,
                  y: 0,
                  boxShadow: [
                    "0 0 0 0 rgb(var(--selection-accent-rgb) / 0)",
                    "0 0 0 1px rgb(var(--selection-accent-rgb) / 0.42)",
                    "0 0 0 0 rgb(var(--selection-accent-rgb) / 0)",
                  ],
                }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                className="mt-4 rounded-xl border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-3 py-2.5"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--selection-accent)]">Receipt</p>
                <p className="mt-1 text-sm leading-5 text-[var(--selection-accent)]">{journey.lastReceipt.text}</p>
              </motion.div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onRunDayAction(day)}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--selection-accent)] px-3.5 text-sm font-semibold text-[var(--selection-accent-foreground)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.55)]"
              >
                {day.actionLabel}
                <ArrowRight className="h-4 w-4" />
              </button>
              {!dayComplete && (
                <button
                  type="button"
                  onClick={() => journey.skipDay(day.id)}
                  className="h-9 rounded-full px-3 text-sm font-medium text-text-muted transition-colors hover:bg-surface-high hover:text-foreground"
                >
                  Not now
                </button>
              )}
            </div>
          </motion.div>
          </AnimatePresence>
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
