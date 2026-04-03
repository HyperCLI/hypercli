"use client";

import { ApiKeysManager } from "@hypercli/shared-ui";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { AUTH_BASE_URL } from "@/lib/api";

export default function KeysPage() {
  const { getToken } = useAgentAuth();

  return (
    <ApiKeysManager
      apiBaseUrl={AUTH_BASE_URL}
      getToken={getToken}
      description="Generate scoped API keys for apps and services. Family baselines control broad access, and selector tags narrow by resource tags."
      cardClassName="glass-card overflow-auto max-h-[calc(100vh-16rem)]"
      createButtonClassName="btn-primary px-4 py-2 rounded-lg text-sm font-medium cursor-pointer"
    />
  );
}
