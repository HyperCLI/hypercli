import type { ReactNode } from "react";
import DashboardShell from "@/components/dashboard/DashboardShell";

export default function DevAgentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] bg-background">
      <DashboardShell>{children}</DashboardShell>
    </div>
  );
}
