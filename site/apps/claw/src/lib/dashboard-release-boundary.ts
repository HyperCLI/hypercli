export type DashboardReleaseSurface = "knowledge-hub" | "members";

export type DashboardReleaseAvailability = Readonly<Record<DashboardReleaseSurface, boolean>>;

// Keep unstable implementations in place while excluding them from shipped navigation and routes.
export const DASHBOARD_RELEASE_AVAILABILITY: DashboardReleaseAvailability = {
  "knowledge-hub": false,
  members: false,
};

export function isDashboardReleaseSurfaceAvailable(
  surface: DashboardReleaseSurface,
  availability: DashboardReleaseAvailability = DASHBOARD_RELEASE_AVAILABILITY,
): boolean {
  return availability[surface];
}

export function normalizeDashboardReleaseSearchParams(
  searchParams: Pick<URLSearchParams, "toString">,
  availability: DashboardReleaseAvailability = DASHBOARD_RELEASE_AVAILABILITY,
): URLSearchParams | null {
  const params = new URLSearchParams(searchParams.toString());
  let changed = false;

  if (!availability["knowledge-hub"] && params.get("section")?.trim() === "knowledge-hub") {
    params.delete("section");
    params.delete("collectionId");
    params.delete("domainId");
    changed = true;
  }

  if (!availability.members) {
    if (params.get("section")?.trim() === "members") {
      params.delete("section");
      changed = true;
    }
    if (params.get("settings")?.trim() === "members") {
      params.delete("settings");
      changed = true;
    }
  }

  return changed ? params : null;
}
