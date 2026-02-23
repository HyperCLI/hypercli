"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClawAuth } from "@/hooks/useClawAuth";
import { DashboardNav } from "@/components/dashboard/DashboardNav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isLoading, isAuthenticated } = useClawAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav />
      <main className="pt-14">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {isLoading ? (
            <div className="flex items-center justify-center py-32">
              <div className="text-text-muted">Loading...</div>
            </div>
          ) : !isAuthenticated ? null : (
            children
          )}
        </div>
      </main>
    </div>
  );
}
