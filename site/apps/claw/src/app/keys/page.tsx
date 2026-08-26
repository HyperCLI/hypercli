import { redirect } from "next/navigation";

export default function KeysRootPage() {
  redirect("/dashboard/agents?view=settings&settings=api-keys");
}
