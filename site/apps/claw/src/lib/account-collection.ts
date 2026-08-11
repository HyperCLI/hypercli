import type { Workspace } from "@hypercli.com/sdk/workspaces";

export const GENERAL_COLLECTION_NAME = "General";
export const GENERAL_COLLECTION_SLUG = "general";

export type CollectionIdentity = Pick<Workspace, "name" | "slug" | "displayName">;

export function isGeneralCollection(workspace: Pick<Workspace, "slug">): boolean {
  return workspace.slug === GENERAL_COLLECTION_SLUG;
}

export function collectionDisplayName(workspace: CollectionIdentity): string {
  return workspace.displayName?.trim() || workspace.name;
}

export function collectionDeletionBlockedReason(workspace: Pick<Workspace, "slug">): string | null {
  return isGeneralCollection(workspace)
    ? "General is created with your account and cannot be deleted."
    : null;
}
