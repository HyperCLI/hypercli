"use client";

import { useSearchParams } from "next/navigation";
import { ApiKeysManager } from "@hypercli/shared-ui";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { AUTH_BASE_URL } from "@/lib/api";

export default function ApiKeysSettingsPanel({ onRequestProductUse }: { onRequestProductUse?: () => boolean }) {
  const { getToken } = useAgentAuth();
  const searchParams = useSearchParams();
  const previewState = process.env.NODE_ENV !== "production" && searchParams.get("apiKeysPreview") === "empty"
    ? "empty"
    : undefined;

  return (
    <ApiKeysManager
      apiBaseUrl={AUTH_BASE_URL}
      getToken={getToken}
      description="New keys start deny-by-default. Add only the scoped tags you want to allow."
      cardClassName="min-h-[calc(100dvh-7rem)] overflow-hidden rounded-2xl border-border bg-card"
      previewState={previewState}
      onRequestProductUse={onRequestProductUse}
    />
  );
}
