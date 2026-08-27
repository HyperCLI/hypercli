import { redirect } from "next/navigation";

import {
  buildDashboardAgentsRedirectHref,
  type DashboardSearchParams,
} from "@/lib/dashboard-route";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  return redirect(buildDashboardAgentsRedirectHref(await searchParams));
}
