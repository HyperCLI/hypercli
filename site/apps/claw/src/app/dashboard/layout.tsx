"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useClawAuth } from "@/hooks/useClawAuth";
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

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useClawAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);

  return (
    <DashboardMobileAgentMenuProvider>
      <div className="min-h-screen bg-background">
        <DashboardNav />
        <main className="pt-14 pb-0">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
