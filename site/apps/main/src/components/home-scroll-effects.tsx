"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const REVEAL_SELECTOR = "[data-home-reveal]";

export function HomeScrollEffects() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-home-motion-root]");
    if (!root || !("IntersectionObserver" in window)) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      root.dataset.homeMotionReady = "reduced";
      return () => {
        delete root.dataset.homeMotionReady;
      };
    }

    const reveals = [...root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR)];
    for (const element of reveals) {
      const delay = Math.min(Number(element.dataset.homeRevealDelay) || 0, 280);
      element.style.setProperty("--home-reveal-delay", `${delay}ms`);
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.homeRevealed = "true";
          revealObserver.unobserve(entry.target);
        }
      },
      { threshold: 0.1 },
    );
    reveals.forEach((element) => revealObserver.observe(element));

    const timeline = root.querySelector<HTMLElement>("[data-home-timeline]");
    const timelineItems = timeline ? [...timeline.querySelectorAll<HTMLElement>("li")] : [];
    const timelineTimers: ReturnType<typeof setTimeout>[] = [];
    let timelineObserver: IntersectionObserver | null = null;

    if (timeline && timelineItems.length > 0) {
      timelineItems.forEach((item) => {
        item.dataset.homeTimelineLit = "false";
      });
      timelineObserver = new IntersectionObserver(
        ([entry], observer) => {
          if (!entry?.isIntersecting) return;
          timelineItems.forEach((item, index) => {
            timelineTimers.push(
              setTimeout(() => {
                item.dataset.homeTimelineLit = "true";
              }, 400 + index * 620),
            );
          });
          observer.disconnect();
        },
        { threshold: 0.25 },
      );
      timelineObserver.observe(timeline);
    }

    root.dataset.homeMotionReady = "true";

    return () => {
      revealObserver.disconnect();
      timelineObserver?.disconnect();
      timelineTimers.forEach(clearTimeout);
      delete root.dataset.homeMotionReady;
      reveals.forEach((element) => {
        delete element.dataset.homeRevealed;
        element.style.removeProperty("--home-reveal-delay");
      });
      timelineItems.forEach((item) => {
        delete item.dataset.homeTimelineLit;
      });
    };
  }, [pathname]);

  return null;
}
