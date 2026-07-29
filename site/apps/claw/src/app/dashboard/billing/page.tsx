"use client";

import { ProfileBillingSection } from "@/components/billing/ProfileBillingSection";
import { useAgentAuth } from "@/hooks/useAgentAuth";

export default function BillingPage() {
  const { getToken } = useAgentAuth();

  return (
    <div className="mx-auto w-full max-w-6xl">
      <ProfileBillingSection getToken={getToken} />
    </div>
  );
}
