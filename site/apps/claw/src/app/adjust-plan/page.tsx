"use client";

import { useEffect } from "react";

const BILLING_SETTINGS_HREF = "/dashboard/agents?view=settings&settings=billing";

export default function AdjustPlanPage() {
  useEffect(() => {
    window.location.replace(BILLING_SETTINGS_HREF);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
      <div role="status" className="max-w-sm">
        <p className="text-sm font-medium">Opening Billing settings...</p>
        <a
          href={BILLING_SETTINGS_HREF}
          className="mt-3 inline-flex rounded-md text-xs font-semibold text-text-secondary underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Continue to Billing
        </a>
      </div>
    </main>
  );
}
