import type { Workspace } from "@hypercli.com/sdk/workspaces";

export const GENERAL_DOMAIN_NAME = "General";
export const GENERAL_DOMAIN_SLUG = "general";

type DomainIdentity = Pick<Workspace, "name" | "slug" | "displayName">;

export function isGeneralDomain(workspace: Pick<Workspace, "slug">): boolean {
  return workspace.slug === GENERAL_DOMAIN_SLUG;
}

export function domainDisplayName(workspace: DomainIdentity): string {
  return workspace.displayName?.trim() || workspace.name;
}

export function domainDeletionBlockedReason(workspace: Pick<Workspace, "slug">): string | null {
  return isGeneralDomain(workspace)
    ? "General is created with your account and cannot be deleted."
    : null;
}
