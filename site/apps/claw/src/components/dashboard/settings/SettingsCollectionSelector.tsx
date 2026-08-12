"use client";

import { Loader2, RefreshCw } from "lucide-react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@hypercli/shared-ui";

import {
  useWorkspace,
  workspaceDisplayName,
} from "@/components/dashboard/WorkspaceContext";

export function SettingsCollectionSelector() {
  const {
    workspacesClient,
    workspaces,
    selectedWorkspaceId,
    isLoading,
    error,
    selectWorkspace,
    refreshWorkspaces,
  } = useWorkspace();

  const selector = workspaces.length > 0 ? (
    <div className="w-full sm:w-72">
      <Select
        value={selectedWorkspaceId ?? undefined}
        onValueChange={selectWorkspace}
        disabled={isLoading || workspaces.length === 1}
      >
        <SelectTrigger
          aria-label="Collection being managed"
          aria-describedby="settings-collection-scope-description"
          data-testid="settings-collection-selector"
          className="h-10 rounded-xl border-border bg-background text-sm shadow-none dark:bg-background dark:hover:bg-surface-low/60"
        >
          <SelectValue placeholder="Choose a Collection" />
        </SelectTrigger>
        <SelectContent align="end">
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              {workspaceDisplayName(workspace)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {workspaces.length === 1 ? (
        <p className="mt-1.5 text-[11px] text-text-muted">Only one Collection is available.</p>
      ) : null}
    </div>
  ) : isLoading ? (
    <div role="status" className="flex min-h-10 w-full items-center gap-2 text-xs text-text-muted sm:w-72 sm:justify-end">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading Collections
    </div>
  ) : error ? (
    <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:justify-end">
      <div className="min-w-0">
        <p role="alert" className="text-xs text-destructive">{error}</p>
        {!workspacesClient ? (
          <p className="mt-1 text-[11px] text-text-muted">Refresh the page to try again.</p>
        ) : null}
      </div>
      {workspacesClient ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => { void refreshWorkspaces(); }}
          className="h-8 shrink-0 rounded-lg"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh Collections
        </Button>
      ) : null}
    </div>
  ) : (
    <p role="status" className="w-full text-xs text-text-muted sm:w-72 sm:text-right">
      No Collections are available. Create one in Knowledge Hub.
    </p>
  );

  return (
    <section aria-labelledby="settings-collection-scope-title" className="shrink-0 border-b border-border bg-surface-low/25 px-4 py-3 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="settings-collection-scope-title" className="text-sm font-semibold text-foreground">
            Managing Collection
          </h2>
          <p id="settings-collection-scope-description" className="mt-0.5 text-xs leading-5 text-text-muted">
            Choose the Collection you want to review or manage.
          </p>
        </div>
        {selector}
      </div>
    </section>
  );
}
