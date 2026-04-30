"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ShowoffTargetProps {
  targetId: string | readonly string[];
  activeTargetId?: string | null;
  children: ReactNode;
  activeClassName?: string;
}

const defaultActiveClassName =
  "pointer-events-none fixed z-40 rounded-lg ring-2 ring-primary ring-offset-2 ring-offset-background shadow-[0_0_0_8px_rgba(56,211,159,0.14)]";

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function targetMatches(targetId: string | readonly string[], activeTargetId?: string | null) {
  if (!activeTargetId) return false;
  return Array.isArray(targetId) ? targetId.includes(activeTargetId) : targetId === activeTargetId;
}

function rectChanged(a: TargetRect | null, b: TargetRect) {
  if (!a) return true;
  return a.top !== b.top || a.left !== b.left || a.width !== b.width || a.height !== b.height;
}

export function ShowoffTarget({
  targetId,
  activeTargetId,
  children,
  activeClassName = defaultActiveClassName,
}: ShowoffTargetProps) {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const active = targetMatches(targetId, activeTargetId);
  const measure = useCallback(() => {
    if (!active) {
      setRect(null);
      return;
    }

    const targetElement = targetRef.current?.firstElementChild;
    if (!targetElement) {
      setRect(null);
      return;
    }

    const nextRect = targetElement.getBoundingClientRect();
    const next = {
      top: nextRect.top,
      left: nextRect.left,
      width: nextRect.width,
      height: nextRect.height,
    };
    setRect((current) => (rectChanged(current, next) ? next : current));
  }, [active]);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;

    let animationFrame = 0;
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);

    const targetElement = targetRef.current?.firstElementChild;
    const observer = typeof ResizeObserver !== "undefined" && targetElement
      ? new ResizeObserver(scheduleMeasure)
      : null;
    observer?.observe(targetElement);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      observer?.disconnect();
    };
  }, [active, measure]);

  return (
    <div ref={targetRef} className="contents">
      {children}
      {active && rect && typeof document !== "undefined"
        ? createPortal(
          <div
            className={activeClassName}
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            }}
            aria-hidden="true"
          />,
          document.body,
        )
        : null}
    </div>
  );
}
