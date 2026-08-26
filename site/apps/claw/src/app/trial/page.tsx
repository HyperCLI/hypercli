import { redirect } from "next/navigation";

import { buildAgentTrialHref } from "@/lib/dashboard-route";

export default function TrialPage() {
  redirect(buildAgentTrialHref());
}
