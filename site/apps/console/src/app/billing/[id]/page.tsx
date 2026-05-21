"use client";

import { useParams } from "next/navigation";

import BillingInvoiceDetailPage from "../BillingInvoiceDetailPage";

export default function BillingInvoiceDetailRoutePage() {
  const params = useParams<{ id: string }>();
  const recordId = params?.id?.trim();

  if (!recordId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-foreground text-xl">Loading billing record...</div>
      </div>
    );
  }

  return <BillingInvoiceDetailPage recordId={recordId} />;
}
