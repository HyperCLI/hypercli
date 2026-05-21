import type { ReactNode } from "react";
import { PrivyAuthRouteBoundary } from "@hypercli/shared-ui";
import DashboardShell from "@/components/dashboard/DashboardShell";

export default function DevAgentsLayout({ children }: { children: ReactNode }) {
  return (
    <PrivyAuthRouteBoundary unauthenticatedRedirectTo="/">
      <div className="fixed inset-0 z-[60] bg-background">
        <DashboardShell>{children}</DashboardShell>
      </div>
    </PrivyAuthRouteBoundary>
  );
}
