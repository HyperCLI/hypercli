import { PrivyAuthRouteBoundary } from "@hypercli/shared-ui";
import DashboardShell from "@/components/dashboard/DashboardShell";
import KeysPage from "@/app/dashboard/keys/page";

export default function KeysRootPage() {
  return (
    <PrivyAuthRouteBoundary unauthenticatedRedirectTo="/">
      <DashboardShell>
        <KeysPage />
      </DashboardShell>
    </PrivyAuthRouteBoundary>
  );
}
