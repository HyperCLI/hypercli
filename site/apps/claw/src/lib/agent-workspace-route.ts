import type { AgentMainTab } from "@/components/dashboard/DashboardMobileAgentMenuContext";

export type AgentRouteTab = Extract<AgentMainTab, "chat" | "files" | "integrations" | "skills" | "scheduled" | "logs" | "shell" | "openclaw" | "settings">;

const AGENT_ROUTE_TABS = new Set<AgentRouteTab>([
  "chat",
  "files",
  "integrations",
  "skills",
  "scheduled",
  "logs",
  "shell",
  "openclaw",
  "settings",
]);

export function resolveAgentRouteTab(value: string | null | undefined): AgentRouteTab | null {
  const normalized = value?.trim() as AgentRouteTab | undefined;
  return normalized && AGENT_ROUTE_TABS.has(normalized) ? normalized : null;
}

export function buildAgentWorkspaceTabHref(agentId: string, tab: AgentRouteTab): string {
  const params = new URLSearchParams({ agentId });
  if (tab !== "chat") params.set("tab", tab);
  return `/dashboard/agents?${params.toString()}`;
}
