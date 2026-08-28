import { Suspense } from "react";

import { DashboardAgentsRedirect } from "@/components/dashboard/DashboardViewRedirect";

export default function Home() {
  return (
    <Suspense fallback={null}>
      <DashboardAgentsRedirect />
    </Suspense>
  );
}
