import { redirect } from "next/navigation";

import {
  buildDashboardViewRedirectHref,
  type DashboardSearchParams,
} from "@/lib/dashboard-route";

export default async function DashboardRedirectPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  return redirect(buildDashboardViewRedirectHref("overview", await searchParams));
}
