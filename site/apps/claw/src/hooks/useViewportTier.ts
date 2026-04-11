"use client";

import { useState, useLayoutEffect } from "react";

export type ViewportTier = "mobile" | "tablet" | "compact" | "desktop";

const BREAKPOINTS = {
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

function getTier(): ViewportTier {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w < BREAKPOINTS.md) return "mobile";
  if (w < BREAKPOINTS.lg) return "tablet";
  if (w < BREAKPOINTS.xl) return "compact";
  return "desktop";
}

export function useViewportTier(): ViewportTier {
  const [tier, setTier] = useState<ViewportTier>(getTier);

  useLayoutEffect(() => {
    const queries = [
      window.matchMedia(`(min-width: ${BREAKPOINTS.md}px)`),
      window.matchMedia(`(min-width: ${BREAKPOINTS.lg}px)`),
      window.matchMedia(`(min-width: ${BREAKPOINTS.xl}px)`),
    ];

    const update = () => setTier(getTier());
    update();

    for (const mq of queries) {
      mq.addEventListener("change", update);
    }
    return () => {
      for (const mq of queries) {
        mq.removeEventListener("change", update);
      }
    };
  }, []);

  return tier;
}

export function tierFlags(tier: ViewportTier) {
  return {
    isMobile: tier === "mobile",
    isTabletOrAbove: tier !== "mobile",
    isCompactOrAbove: tier === "compact" || tier === "desktop",
    isDesktopOrAbove: tier === "desktop",
  };
}
