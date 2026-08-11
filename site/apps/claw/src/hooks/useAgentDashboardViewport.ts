"use client";

import { useEffectEvent, useLayoutEffect, useState } from "react";

export const AGENT_DASHBOARD_DESKTOP_MEDIA_QUERY =
  "(min-width: 1024px), (min-width: 768px) and (min-height: 500px)";
export const AGENT_DASHBOARD_PHONE_INPUT_MEDIA_QUERY = "(hover: none) and (pointer: coarse)";

const PHONE_SCREEN_MAX_SHORT_EDGE = 767;

export function resolveAgentDashboardDesktopViewport({
  desktopMediaMatches,
  phoneInputMatches,
  screenWidth,
  screenHeight,
}: {
  desktopMediaMatches: boolean;
  phoneInputMatches: boolean;
  screenWidth: number;
  screenHeight: number;
}): boolean {
  const shortScreenEdge = Math.min(screenWidth, screenHeight);
  const isPhysicalPhone = phoneInputMatches
    && Number.isFinite(shortScreenEdge)
    && shortScreenEdge > 0
    && shortScreenEdge <= PHONE_SCREEN_MAX_SHORT_EDGE;

  return desktopMediaMatches && !isPhysicalPhone;
}

export function useAgentDashboardDesktopViewport(onDesktop?: () => void): boolean {
  // Mobile is the safe server-rendered fallback. Desktop is enabled after hydration.
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const notifyDesktop = useEffectEvent(() => onDesktop?.());

  useLayoutEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const desktopMedia = window.matchMedia(AGENT_DASHBOARD_DESKTOP_MEDIA_QUERY);
    const phoneInputMedia = window.matchMedia(AGENT_DASHBOARD_PHONE_INPUT_MEDIA_QUERY);
    const applyViewport = () => {
      const nextIsDesktop = resolveAgentDashboardDesktopViewport({
        desktopMediaMatches: desktopMedia.matches,
        phoneInputMatches: phoneInputMedia.matches,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
      });
      setIsDesktopViewport(nextIsDesktop);
      if (nextIsDesktop) notifyDesktop();
    };

    applyViewport();
    desktopMedia.addEventListener("change", applyViewport);
    phoneInputMedia.addEventListener("change", applyViewport);
    window.addEventListener("orientationchange", applyViewport);
    return () => {
      desktopMedia.removeEventListener("change", applyViewport);
      phoneInputMedia.removeEventListener("change", applyViewport);
      window.removeEventListener("orientationchange", applyViewport);
    };
  }, []);

  return isDesktopViewport;
}
