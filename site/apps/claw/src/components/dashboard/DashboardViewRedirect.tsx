"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  buildDashboardAgentsRedirectHref,
  buildDashboardViewRedirectHref,
  type DashboardSearchParams,
  type DashboardView,
} from "@/lib/dashboard-route";

// Client-side stand-ins for the server redirect pages; the static export
// cannot read search params on the server, so the query is preserved in the
// browser instead.

function collectSearchParams(searchParams: URLSearchParams): DashboardSearchParams {
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    params[key] = values.length > 1 ? values : values[0];
  }
  return params as DashboardSearchParams;
}

export function DashboardViewRedirect({ view }: { view: DashboardView }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    router.replace(
      buildDashboardViewRedirectHref(view, collectSearchParams(new URLSearchParams(searchParams))),
    );
  }, [router, searchParams, view]);
  return null;
}

export function DashboardAgentsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    router.replace(
      buildDashboardAgentsRedirectHref(collectSearchParams(new URLSearchParams(searchParams))),
    );
  }, [router, searchParams]);
  return null;
}

export function SharedKnowledgeRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const first = (key: string): string | null => searchParams.get(key)?.trim() || null;
    const focusedAgentId = first("focusAgent") ?? first("agentId");
    const sessionKey = first("session");
    const target = new URLSearchParams({ section: "knowledge" });
    if (focusedAgentId) target.set("agentId", focusedAgentId);
    if (sessionKey) target.set("session", sessionKey);
    router.replace(`/dashboard/agents?${target.toString()}`);
  }, [router, searchParams]);
  return null;
}
