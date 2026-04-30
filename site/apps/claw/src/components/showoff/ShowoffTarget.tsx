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
  "pointer-events-none fixed z-40 rounded-xl border border-primary/70 ring-2 ring-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.62),0_0_0_8px_rgba(56,211,159,0.18),0_20px_70px_rgba(0,0,0,0.45)] transition-[top,left,width,height] duration-200 ease-out";

const SPOTLIGHT_PADDING = 10;

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

function getTargetElement(ref: HTMLDivElement | null) {
  const element = ref?.firstElementChild;
  return element instanceof HTMLElement ? element : null;
}

function spotlightRectFor(element: HTMLElement): TargetRect {
  const rect = element.getBoundingClientRect();
  return {
    top: Math.max(SPOTLIGHT_PADDING, rect.top - SPOTLIGHT_PADDING),
    left: Math.max(SPOTLIGHT_PADDING, rect.left - SPOTLIGHT_PADDING),
    width: rect.width + SPOTLIGHT_PADDING * 2,
    height: rect.height + SPOTLIGHT_PADDING * 2,
  };
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

    const targetElement = getTargetElement(targetRef.current);
    if (!targetElement) {
      setRect(null);
      return;
    }

    const next = spotlightRectFor(targetElement);
    setRect((current) => (rectChanged(current, next) ? next : current));
  }, [active]);

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const targetElement = getTargetElement(targetRef.current);
    if (!targetElement) return;

    const originalPosition = targetElement.style.position;
    const originalZIndex = targetElement.style.zIndex;
    const originalIsolation = targetElement.style.isolation;
    const computedPosition = window.getComputedStyle(targetElement).position;

    if (computedPosition === "static") {
      targetElement.style.position = "relative";
    }
    targetElement.style.zIndex = "45";
    targetElement.style.isolation = "isolate";

    targetElement.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });

    let animationFrame = 0;
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);

    const observer = typeof ResizeObserver !== "undefined" && targetElement
      ? new ResizeObserver(scheduleMeasure)
      : null;
    if (observer && targetElement) {
      observer.observe(targetElement);
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      observer?.disconnect();
      targetElement.style.position = originalPosition;
      targetElement.style.zIndex = originalZIndex;
      targetElement.style.isolation = originalIsolation;
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
              borderRadius: 14,
            }}
            aria-hidden="true"
          />,
          document.body,
        )
        : null}
    </div>
  );
}
