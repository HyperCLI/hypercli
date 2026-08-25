import { HyperCLILogo } from "@hypercli/shared-ui";

const RAIL_PLACEHOLDERS = ["home", "files", "integrations", "skills", "scheduled", "desktop"];

export function AgentsPageLoadingShell() {
  return (
    <div data-testid="agents-page-loading-shell" className="h-full min-h-0 w-full overflow-hidden bg-background">
      <span className="sr-only" role="status">Loading agent workspace</span>

      <div aria-hidden="true" className="agents-page-loading-desktop h-full min-h-0">
        <aside className="flex h-full w-52 shrink-0 flex-col border-r border-border bg-[var(--agent-roster-background)]">
          <div className="flex h-14 shrink-0 items-center border-b border-border bg-background px-3">
            <HyperCLILogo decorative className="h-[28px] w-[144px]" imageClassName="text-[20px]" />
          </div>

          <div className="min-h-0 flex-1 px-3 py-4 text-text-muted">
            <div className="flex items-center justify-between text-xs">
              <span>Agents</span>
              <span className="h-3 w-3 rounded-sm border border-border" />
            </div>
            <div className="mt-5 flex items-center gap-2 text-sm">
              <span className="h-3.5 w-3.5 rounded-sm border border-border" />
              <span>Home</span>
            </div>
            <div className="mt-5 flex items-center gap-2 text-xs">
              <span className="h-3 w-3 rounded-full border border-border" />
              <span>Loading agents</span>
            </div>
            <div className="mt-4 flex items-start gap-2">
              <span className="mt-0.5 h-5 w-5 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.25)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)]" />
              <span>
                <span className="block text-sm font-semibold text-foreground">Launch agent</span>
                <span className="mt-0.5 block text-xs">Create a new workspace</span>
              </span>
            </div>
            <p className="mt-7 text-xs">Administration</p>
            <div className="mt-5 flex items-center gap-2 text-sm">
              <span className="h-3.5 w-3.5 rounded-sm border border-border" />
              <span>Usage</span>
            </div>
          </div>

          <div className="flex h-14 shrink-0 items-center gap-2 border-t border-border px-3">
            <span className="h-8 w-8 rounded-full border border-border bg-surface-low" />
            <span className="h-2.5 w-16 rounded-full bg-surface-low" />
          </div>
        </aside>

        <aside className="flex h-full w-12 shrink-0 flex-col border-r border-border bg-[var(--agent-panel-background)]">
          <div className="h-14 shrink-0 border-b border-border bg-background" />
          <div className="flex min-h-0 flex-1 flex-col items-center gap-5 py-7">
            {RAIL_PLACEHOLDERS.map((placeholder) => (
              <span key={placeholder} className="h-4 w-4 rounded-sm border border-border" />
            ))}
            <span className="mt-auto h-4 w-4 rounded-sm border border-border" />
          </div>
          <div className="flex h-14 shrink-0 items-center justify-center border-t border-border">
            <span className="h-8 w-8 rounded-full border border-border bg-surface-low" />
          </div>
        </aside>

        <div className="min-w-0 flex-1 bg-background" />
      </div>

      <div aria-hidden="true" className="agents-page-loading-mobile h-full min-h-0 flex-col">
        <header className="grid h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center border-b border-border px-3 pt-[env(safe-area-inset-top)]">
          <HyperCLILogo decorative markOnly className="h-6 w-6" />
          <span />
          <span className="h-6 w-6 justify-self-center rounded-md border border-border" />
        </header>
        <div className="min-h-0 flex-1 bg-background" />
      </div>
    </div>
  );
}
