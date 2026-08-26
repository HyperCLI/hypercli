import { redirect } from "next/navigation";
import { DASHBOARD_VIEW_HREFS } from "@/lib/dashboard-route";

export default function SlackStartPage() {
  redirect(DASHBOARD_VIEW_HREFS.settings);
}
