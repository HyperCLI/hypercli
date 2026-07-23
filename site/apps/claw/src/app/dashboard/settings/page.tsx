import { redirect } from "next/navigation";

import {
  buildDashboardViewRedirectHref,
  type DashboardSearchParams,
} from "@/lib/dashboard-route";

export default async function SettingsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  return redirect(buildDashboardViewRedirectHref("settings", await searchParams));
}
