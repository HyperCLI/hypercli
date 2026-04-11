"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { DashboardMobileAgentMenuProvider } from "@/components/dashboard/DashboardMobileAgentMenuContext";
import { Skeleton } from "@/components/dashboard/Skeleton";
import { useViewportTier, tierFlags } from "@/hooks/useViewportTier";

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

export function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useAgentAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isAgentsRoute =
    pathname === "/agents" ||
    pathname.startsWith("/agents/") ||
    pathname.startsWith("/dashboard/agents");
  const viewportTier = useViewportTier();
  const { isTabletOrAbove: isDesktopViewport } = tierFlags(viewportTier);

  const showDashboardNav = !isAgentsRoute || isDesktopViewport;
  const hasTopNavOffset = showDashboardNav;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);

  return (
    <DashboardMobileAgentMenuProvider>
      <div className="h-dvh overflow-hidden bg-background">
        {showDashboardNav ? <DashboardNav /> : null}
        <main
          className={
            isAgentsRoute
              ? `overflow-hidden pb-0 ${hasTopNavOffset ? "h-dvh pt-14" : "h-dvh pt-0"}`
              : `pb-0 ${hasTopNavOffset ? "h-dvh pt-14" : "h-dvh pt-0"}`
          }
        >
          <div
            className={`max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 ${
              isAgentsRoute
                ? `${hasTopNavOffset ? "h-[calc(100dvh-3.5rem)]" : "h-dvh"} overflow-hidden py-0`
                : `${hasTopNavOffset ? "h-[calc(100dvh-3.5rem)]" : "h-dvh"} overflow-y-auto py-8`
            }`}
          >
            {isLoading ? (
              <FullPageSkeleton />
            ) : !isAuthenticated ? null : (
              <AnimatePresence mode="wait">
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className={isAgentsRoute ? "h-full overflow-hidden" : undefined}
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
