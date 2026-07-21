"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { DashboardMobileAgentMenuProvider } from "@/components/dashboard/DashboardMobileAgentMenuContext";
import { Skeleton } from "@/components/dashboard/Skeleton";

function FullPageSkeleton() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="w-48 h-8" />
        <Skeleton className="w-28 h-9 rounded-lg" />
      </div>
      <div className="grid sm:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card p-4">
            <Skeleton className="w-20 h-3 mb-3" />
            <Skeleton className="w-14 h-6" />
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <Skeleton className="w-32 h-5 mb-4" />
          <Skeleton className="w-full h-[180px] rounded" />
        </div>
        <div className="glass-card p-6">
          <Skeleton className="w-32 h-5 mb-4" />
          <Skeleton className="w-full h-[180px] rounded" />
        </div>
      </div>
    </div>
  );
}

function normalizeShellPathname(pathname: string | null) {
  if (!pathname || pathname === "/") return pathname ?? "";
  return pathname.replace(/\/+$/, "");
}

function useVisualViewportHeightVar() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let timeouts: number[] = [];

    const syncViewportHeight = () => {
      frame = 0;
      const visualHeight = window.visualViewport?.height;
      const height = visualHeight && Number.isFinite(visualHeight)
        ? visualHeight
        : window.innerHeight;
      root.style.setProperty("--claw-viewport-height", `${Math.round(height)}px`);
    };

    const scheduleSync = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncViewportHeight);
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      timeouts = [120, 320, 700].map((delay) => window.setTimeout(syncViewportHeight, delay));
    };

    syncViewportHeight();

    window.addEventListener("resize", scheduleSync);
    window.addEventListener("orientationchange", scheduleSync);
    window.addEventListener("focusin", scheduleSync);
    window.addEventListener("focusout", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("scroll", scheduleSync);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("orientationchange", scheduleSync);
      window.removeEventListener("focusin", scheduleSync);
      window.removeEventListener("focusout", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("scroll", scheduleSync);
      root.style.removeProperty("--claw-viewport-height");
    };
  }, []);
}

export function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  useVisualViewportHeightVar();
  const { isLoading, isAuthenticated, flowState, error } = useAgentAuth();
  const pathname = normalizeShellPathname(usePathname());
  const isAgentsRoute =
    pathname === "/agents" ||
    pathname.startsWith("/agents/") ||
    pathname.startsWith("/dashboard/agents") ||
    pathname.startsWith("/dev/agent-setup/agents");
  const isDashboardHome = pathname === "/dashboard";
  const isUsageRoute = pathname === "/usage";
  const isSettingsRoute = pathname === "/dashboard/settings" || pathname.startsWith("/dashboard/settings/");
  const isImmersiveRoute = isAgentsRoute || isDashboardHome || isUsageRoute || isSettingsRoute;
  const showDashboardNav = !isImmersiveRoute;
  const showMobileDashboardNav = isDashboardHome || isSettingsRoute;
  const hasTopNavOffset = showDashboardNav;

  return (
    <DashboardMobileAgentMenuProvider>
      <div
        className="h-dvh overflow-hidden bg-background"
        data-auth-loading={isLoading ? "true" : "false"}
        data-authenticated={isAuthenticated ? "true" : "false"}
        data-auth-flow-state={flowState}
        data-auth-error={error ? "true" : "false"}
      >
        {showDashboardNav ? (
          <DashboardNav />
        ) : showMobileDashboardNav ? (
          <div data-testid="mobile-dashboard-nav" className="lg:hidden">
            <DashboardNav />
          </div>
        ) : null}
        <main
          className={
            showMobileDashboardNav
              ? "h-dvh overflow-hidden pb-0 pt-14 lg:pt-0"
              : isImmersiveRoute
              ? "h-dvh overflow-hidden pb-0 pt-0"
              : `pb-0 ${hasTopNavOffset ? "h-dvh pt-14" : "h-dvh pt-0"}`
          }
        >
          <div
            className={
              showMobileDashboardNav
                ? "h-full w-full overflow-hidden"
                : isImmersiveRoute
                ? "h-dvh w-full overflow-hidden py-0"
                : `max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 ${hasTopNavOffset ? "h-[calc(100dvh-3.5rem)]" : "h-dvh"} overflow-y-auto py-8`
            }
          >
            {isLoading ? (
              <FullPageSkeleton />
            ) : !isAuthenticated ? null : isImmersiveRoute ? (
              <div className="h-full overflow-hidden">{children}</div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </main>
      </div>
    </DashboardMobileAgentMenuProvider>
  );
}

export default DashboardShell;
