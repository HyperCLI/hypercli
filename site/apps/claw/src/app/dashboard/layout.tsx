import { PrivyAuthRouteBoundary } from "@hypercli/shared-ui";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PrivyAuthRouteBoundary
      publicPaths={["/dashboard/agents", "/dashboard/agents/"]}
      unauthenticatedRedirectTo="/"
    >
      <DashboardShell>{children}</DashboardShell>
    </PrivyAuthRouteBoundary>
  );
}
