import { PrivyAuthRouteBoundary } from "@hypercli/shared-ui";

import DashboardShell from "@/components/dashboard/DashboardShell";
import UsagePage from "@/components/dashboard/UsagePage";

export default function UsageRootPage() {
  return (
    <PrivyAuthRouteBoundary unauthenticatedRedirectTo="/">
      <DashboardShell>
        <UsagePage />
      </DashboardShell>
    </PrivyAuthRouteBoundary>
  );
}
