import { redirect } from "next/navigation";

export default function KeysPage() {
  redirect("/dashboard/agents?view=settings&settings=api-keys");
}
