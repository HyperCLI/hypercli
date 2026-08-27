export type DashboardReleaseSurface = "hermes-launcher" | "knowledge-hub" | "members";

export type DashboardReleaseAvailability = Readonly<Record<DashboardReleaseSurface, boolean>>;

// Keep the Schedule tab visible as a preview without exposing its manager.
export const SCHEDULED_MANAGER_ENABLED = false;

// Keep unstable implementations in place while excluding them from shipped navigation and routes.
export const DASHBOARD_RELEASE_AVAILABILITY: DashboardReleaseAvailability = {
  "hermes-launcher": false,
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

  const requestedSection = params.get("section")?.trim();
  if (
    !availability["knowledge-hub"]
    && (requestedSection === "knowledge-hub" || requestedSection === "knowledge")
  ) {
    params.delete("section");
    params.delete("collectionId");
    params.delete("domainId");
    changed = true;
  }

  if (!availability["knowledge-hub"] && params.get("settings")?.trim() === "workspace") {
    params.delete("settings");
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
