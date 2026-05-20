"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
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

export function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated, flowState, error } = useAgentAuth();
  const router = useRouter();
  const pathname = normalizeShellPathname(usePathname());
  const isAgentsRoute =
    pathname === "/agents" ||
    pathname.startsWith("/agents/") ||
    pathname.startsWith("/dashboard/agents") ||
    pathname.startsWith("/dev/agent-setup/agents");
  const isDashboardHome = pathname === "/dashboard";
  const showDashboardNav = !isAgentsRoute;
  const hasTopNavOffset = showDashboardNav;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);

  return (
    <DashboardMobileAgentMenuProvider>
      <div
        className="h-dvh overflow-hidden bg-background"
        data-auth-loading={isLoading ? "true" : "false"}
        data-authenticated={isAuthenticated ? "true" : "false"}
        data-auth-flow-state={flowState}
        data-auth-error={error ? "true" : "false"}
      >
        {showDashboardNav ? <DashboardNav /> : null}
        <main
          className={
            isDashboardHome
              ? "h-dvh overflow-hidden pb-0 pt-14"
              : isAgentsRoute
              ? "h-dvh overflow-hidden pb-0 pt-0"
              : `pb-0 ${hasTopNavOffset ? "h-dvh pt-14" : "h-dvh pt-0"}`
          }
        >
          <div
            className={
              isDashboardHome
                ? "h-[calc(100dvh-3.5rem)] w-full overflow-hidden"
                : isAgentsRoute
                ? "h-dvh w-full overflow-hidden py-0"
                : `max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 ${hasTopNavOffset ? "h-[calc(100dvh-3.5rem)]" : "h-dvh"} overflow-y-auto py-8`
            }
          >
            {isLoading ? (
              <FullPageSkeleton />
            ) : !isAuthenticated ? null : isAgentsRoute || isDashboardHome ? (
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
