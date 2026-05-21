"use client";

import { useParams } from "next/navigation";

import JobDetailPage from "../JobDetailPage";

export default function JobDetailRoutePage() {
  const params = useParams<{ id: string }>();
  const jobId = params?.id?.trim();

  if (!jobId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-foreground text-xl">Loading job details...</div>
      </div>
    );
  }

  return <JobDetailPage jobId={jobId} />;
}
