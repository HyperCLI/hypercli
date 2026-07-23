import { redirect } from "next/navigation";

import {
  buildDashboardViewRedirectHref,
  type DashboardSearchParams,
} from "@/lib/dashboard-route";

export default async function UsageRedirectPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  return redirect(buildDashboardViewRedirectHref("usage", await searchParams));
}
