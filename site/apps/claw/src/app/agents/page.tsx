import { PrivyAuthRouteBoundary } from "@hypercli/shared-ui";
import DashboardShell from "@/components/dashboard/DashboardShell";
import AgentsPage from "@/app/dashboard/agents/page";

export default function AgentsRootPage() {
  return (
    <PrivyAuthRouteBoundary unauthenticatedRedirectTo="/">
      <DashboardShell>
        <AgentsPage />
      </DashboardShell>
    </PrivyAuthRouteBoundary>
  );
}
