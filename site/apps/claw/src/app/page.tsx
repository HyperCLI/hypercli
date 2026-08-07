"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { HyperCLILogo, PrivyLoginPanel } from "@hypercli/shared-ui";
import { useClawAuth } from "@/hooks/useClawAuth";
import { buildAuthenticatedClawHomeHref } from "@/lib/dashboard-route";

export default function Home() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useClawAuth();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(buildAuthenticatedClawHomeHref(window.location.search));
    }
  }, [isLoading, isAuthenticated, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <HyperCLILogo />
        {isLoading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : (
          <PrivyLoginPanel
            title="Welcome to HyperCLI Agents"
            description="Sign in to continue to your agents"
            tokenStorageKey="claw_auth_token"
          />
        )}
      </div>
    </div>
  );
}
