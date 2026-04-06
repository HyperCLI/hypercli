import DashboardShell from "@/components/dashboard/DashboardShell";
import AgentsPage from "@/app/dashboard/agents/page";

export default function AgentsRootPage() {
  return (
    <DashboardShell>
      <AgentsPage />
    </DashboardShell>
  );
}
