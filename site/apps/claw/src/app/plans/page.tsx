import { PrivyAuthRouteBoundary } from "@hypercli/shared-ui";
import DashboardShell from "@/components/dashboard/DashboardShell";
import PlansPage from "@/components/plans/PlansPage";

export default function PlansRootPage() {
  return (
    <PrivyAuthRouteBoundary unauthenticatedRedirectTo="/">
      <DashboardShell>
        <PlansPage />
      </DashboardShell>
    </PrivyAuthRouteBoundary>
  );
}
