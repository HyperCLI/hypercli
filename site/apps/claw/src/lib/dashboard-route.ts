export const DASHBOARD_AGENTS_PATH = "/dashboard/agents";

export type DashboardView = "overview" | "usage" | "settings";

export type DashboardSearchParams = Record<string, string | string[] | undefined>;

const DASHBOARD_VIEWS = new Set<DashboardView>(["overview", "usage", "settings"]);

export const DASHBOARD_VIEW_HREFS: Record<DashboardView, string> = {
  overview: `${DASHBOARD_AGENTS_PATH}?view=overview`,
  usage: `${DASHBOARD_AGENTS_PATH}?view=usage`,
  settings: `${DASHBOARD_AGENTS_PATH}?view=settings`,
};

export const ACCOUNT_PAGE_HREFS = {
  apiKeys: "/keys",
  plans: "/plans",
  billing: "/dashboard/billing",
} as const;

export function buildAgentLauncherHref(planId?: string | null): string {
  const params = new URLSearchParams({ open: "agent-launcher" });
  const normalizedPlanId = planId?.trim();
  if (normalizedPlanId) params.set("plan", normalizedPlanId);
  return `${DASHBOARD_AGENTS_PATH}?${params.toString()}`;
}

export function resolveDashboardView(value: string | null | undefined): DashboardView | null {
  const normalized = value?.trim() as DashboardView | undefined;
  return normalized && DASHBOARD_VIEWS.has(normalized) ? normalized : null;
}

export function buildDashboardViewHref(
  view: DashboardView,
  selection?: { agentId?: string | null; session?: string | null },
): string {
  const params = new URLSearchParams({ view });
  const agentId = selection?.agentId?.trim();
  const session = selection?.session?.trim();
  if (agentId) params.set("agentId", agentId);
  if (session) params.set("session", session);
  return `${DASHBOARD_AGENTS_PATH}?${params.toString()}`;
}

function appendSearchParams(params: URLSearchParams, searchParams: DashboardSearchParams) {
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value == null) return;
    const values = Array.isArray(value) ? value : [value];
    values.forEach((entry) => params.append(key, entry));
  });
}

export function buildDashboardViewRedirectHref(
  view: DashboardView,
  searchParams: DashboardSearchParams,
): string {
  const params = new URLSearchParams({ view });
  const compatibleParams = { ...searchParams };
  delete compatibleParams.view;
  delete compatibleParams.section;
  delete compatibleParams.tab;
  delete compatibleParams.open;
  appendSearchParams(params, compatibleParams);
  return `${DASHBOARD_AGENTS_PATH}?${params.toString()}`;
}

export function buildDashboardAgentsRedirectHref(searchParams: DashboardSearchParams): string {
  const params = new URLSearchParams();
  appendSearchParams(params, searchParams);
  const query = params.toString();
  return `${DASHBOARD_AGENTS_PATH}${query ? `?${query}` : ""}`;
}
