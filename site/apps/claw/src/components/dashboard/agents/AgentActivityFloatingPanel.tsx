"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { motion } from "framer-motion";
import { Activity, GripHorizontal, Minus, X } from "lucide-react";
import type { Deployments } from "@hypercli.com/sdk/agents";

import { AgentActivityController } from "./AgentActivityController";

interface AgentActivityFloatingPanelProps {
  deployments: Deployments | null;
  agentId: string | null;
  onClose: () => void;
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
}

const POSITION_MARGIN = 12;
const DRAG_CLICK_THRESHOLD = 4;

function clampPosition(position: FloatingPosition, element: HTMLElement | null): FloatingPosition {
  if (typeof window === "undefined") return position;
  const width = element?.offsetWidth || Math.min(420, window.innerWidth - POSITION_MARGIN * 2);
  const height = element?.offsetHeight || 64;
  return {
    left: Math.min(Math.max(position.left, POSITION_MARGIN), Math.max(POSITION_MARGIN, window.innerWidth - width - POSITION_MARGIN)),
    top: Math.min(Math.max(position.top, POSITION_MARGIN), Math.max(POSITION_MARGIN, window.innerHeight - height - POSITION_MARGIN)),
  };
}

export function AgentActivityFloatingPanel({ deployments, agentId, onClose }: AgentActivityFloatingPanelProps) {
  const floatingRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const positionedClassName = position ? "" : "bottom-4 right-4 sm:bottom-5 sm:right-5";
  const floatingStyle = position ? { left: position.left, top: position.top } : undefined;

  const setFloatingRef = useCallback((node: HTMLElement | null) => {
    floatingRef.current = node;
  }, []);

  const commitPosition = useCallback((nextPosition: FloatingPosition) => {
    setPosition(clampPosition(nextPosition, floatingRef.current));
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
    };
    setPosition(origin);
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const moveDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    commitPosition({
      left: dragState.originLeft + event.clientX - dragState.startX,
      top: dragState.originTop + event.clientY - dragState.startY,
    });
  }, [commitPosition]);

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    commitPosition({
      left: dragState.originLeft + event.clientX - dragState.startX,
      top: dragState.originTop + event.clientY - dragState.startY,
    });
    dragStateRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [commitPosition]);

  useEffect(() => {
    if (!position) return;
    const handleResize = () => setPosition((current) => (current ? clampPosition(current, floatingRef.current) : current));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [position]);

  if (collapsed) {
    return (
      <motion.button
        type="button"
        ref={setFloatingRef}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={() => setCollapsed(false)}
        style={floatingStyle}
        className={`fixed ${positionedClassName} z-50 inline-flex touch-none items-center gap-2 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-popover/95 px-3.5 py-2 text-sm font-semibold text-[var(--selection-accent)] shadow-[0_18px_56px_rgba(0,0,0,0.38)] backdrop-blur transition-colors hover:bg-surface-high ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        aria-label="Expand activity panel"
      >
        <Activity className="h-4 w-4" />
        <span>Activity</span>
      </motion.button>
    );
  }

  return (
    <motion.section
      ref={setFloatingRef}
      aria-label="Agent activity"
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      style={floatingStyle}
      className={`fixed ${positionedClassName} z-50 flex h-[min(30rem,calc(100dvh-1.5rem))] w-[min(26.25rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-popover/95 text-foreground shadow-[0_24px_90px_rgba(0,0,0,0.48)] backdrop-blur-xl`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-foreground">
          <Activity className="h-3.5 w-3.5 text-[var(--selection-accent)]" />
          Activity
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={`flex h-7 w-7 touch-none items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-high hover:text-foreground ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
            aria-label="Move activity panel"
          >
            <GripHorizontal className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-high hover:text-foreground"
            aria-label="Minimize activity panel"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-high hover:text-foreground"
            aria-label="Close activity panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <AgentActivityController deployments={deployments} agentId={agentId} visible />
      </div>
    </motion.section>
  );
}
