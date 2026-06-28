import type { Metadata } from "next";
import { Footer, Header } from "@hypercli/shared-ui";
import StatusDashboard from "./StatusDashboard";

export const metadata: Metadata = {
  title: "Status | HyperCLI",
  description: "Current public health for HyperCLI services and model APIs.",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function fetchInitialStatus() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBaseUrl) {
    return null;
  }

  try {
    const response = await fetch(
      `${apiBaseUrl.replace(/\/$/, "")}/agents/status`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) {
      return null;
    }
    return response.json();
  } catch {
    return null;
  }
}

export default async function StatusPage() {
  const initialStatus = await fetchInitialStatus();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-28 pb-20">
        <StatusDashboard initialStatus={initialStatus} />
      </main>
      <Footer />
    </div>
  );
}
