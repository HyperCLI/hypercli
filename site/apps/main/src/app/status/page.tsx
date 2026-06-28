import type { Metadata } from "next";
import { Footer, Header } from "@hypercli/shared-ui";
import StatusDashboard from "./StatusDashboard";

export const metadata: Metadata = {
  title: "Status | HyperCLI",
  description: "Current public health for HyperCLI services and model APIs.",
};

export default function StatusPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-28 pb-20">
        <StatusDashboard />
      </main>
      <Footer />
    </div>
  );
}
