"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CheckCircle2, GripHorizontal, RotateCcw, Sparkles, X } from "lucide-react";

import type { JourneyController } from "./useJourney";
import type { JourneyDay } from "./types";

interface JourneyFloatingPanelProps {
  journey: JourneyController;
  onRunDayAction: (day: JourneyDay) => void;
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

function receiptIsCurrent(day: JourneyDay, journey: JourneyController): boolean {
  return journey.lastReceipt?.dayId === day.id && journey.completedIds.has(day.id);
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

export function JourneyFloatingPanel({ journey, onRunDayAction }: JourneyFloatingPanelProps) {
  const floatingRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressNextClickRef = useRef(false);
  const [position, setPosition] = useState<FloatingPosition | null>(() => readStoredPosition());
  const [dragging, setDragging] = useState(false);
  const day = journey.currentDay;

  const dayComplete = day ? journey.completedIds.has(day.id) : false;
  const progressLabel = `${journey.completedCount} of ${journey.days.length} days shaped`;
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
      <button
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
        className={`fixed ${positionedClassName} z-50 inline-flex touch-none items-center gap-2 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-[#101011]/95 px-3.5 py-2 text-sm font-semibold text-[var(--selection-accent)] shadow-[0_18px_56px_rgba(0,0,0,0.38)] backdrop-blur transition-colors hover:bg-[#171719] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.55)] ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        aria-label={`Open Journey Day ${day.day}`}
        title="Drag to move. Click to open Journey."
      >
        <Sparkles className="h-4 w-4" />
        <span>Journey - Day {day.day}</span>
      </button>
    );
  }

  return (
    <AnimatePresence>
      <motion.section
        ref={setFloatingRef}
        aria-label="Today's Journey"
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        style={floatingStyle}
        className={`fixed ${positionedClassName} z-50 max-h-[calc(100dvh-1.5rem)] w-[min(25.5rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/12 bg-[#101011]/96 text-foreground shadow-[0_24px_90px_rgba(0,0,0,0.48)] backdrop-blur-xl`}
      >
        <div className="h-1 bg-white/10">
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
                className={`flex h-8 w-8 touch-none items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
                title="Move Journey"
                aria-label="Move Journey panel"
              >
                <GripHorizontal className="h-4 w-4" />
              </button>
              {journey.preview && (
                <button
                  type="button"
                  onClick={journey.reset}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/8 hover:text-foreground"
                  title="Reset Journey progress"
                  aria-label="Reset Journey progress"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => journey.setPanelOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/8 hover:text-foreground"
                title="Close Journey"
                aria-label="Close Journey"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-1.5" aria-label="Journey days">
            {journey.days.map((entry) => {
              const selected = entry.id === day.id;
              const complete = journey.completedIds.has(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => journey.selectDay(entry.id)}
                  aria-label={`Open Journey day ${entry.day}: ${entry.title}`}
                  aria-current={selected ? "step" : undefined}
                  className={`h-2 flex-1 rounded-full transition-colors ${
                    complete
                      ? "bg-[var(--selection-accent)]"
                      : selected
                        ? "bg-white/45"
                        : "bg-white/12 hover:bg-white/22"
                  }`}
                />
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--selection-accent)]">
                  Day {day.day} of {journey.days.length}
                </p>
                <h2 className="mt-1 text-lg font-semibold leading-tight text-foreground">{day.title}</h2>
              </div>
              {dayComplete && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.25)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-2 py-1 text-xs font-semibold text-[var(--selection-accent)]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Shaped
                </span>
              )}
            </div>

            <p className="mt-3 text-sm font-medium leading-6 text-foreground">{day.mission}</p>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{day.why}</p>

            <div className="mt-4 rounded-xl border border-white/8 bg-black/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">Agent brief focus</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {day.briefFocus.map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 text-xs font-medium text-text-secondary">
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

            {receiptIsCurrent(day, journey) && journey.lastReceipt ? (
              <div className="mt-4 rounded-xl border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-3 py-2 text-sm leading-5 text-[var(--selection-accent)]">
                {journey.lastReceipt.text}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onRunDayAction(day)}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--selection-accent)] px-3.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.55)]"
              >
                {day.actionLabel}
                <ArrowRight className="h-4 w-4" />
              </button>
              {!dayComplete && (
                <button
                  type="button"
                  onClick={() => journey.skipDay(day.id)}
                  className="h-9 rounded-full px-3 text-sm font-medium text-text-muted transition-colors hover:bg-white/8 hover:text-foreground"
                >
                  Skip for now
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.section>
    </AnimatePresence>
  );
}
