import { HyperCLILogo } from "@hypercli/shared-ui";
import {
  BarChart3,
  Blocks,
  CalendarClock,
  ChevronDown,
  Code2,
  Codepen,
  FolderOpen,
  House,
  Menu,
  Monitor,
  PanelLeftClose,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";

const RAIL_ITEMS = [
  { id: "new-session", icon: Plus },
  { id: "files", icon: FolderOpen },
  { id: "integrations", icon: Blocks },
  { id: "skills", icon: Codepen },
  { id: "scheduled", icon: CalendarClock },
  { id: "desktop", icon: Monitor },
  { id: "settings", icon: Settings },
];

const ANONYMOUS_AGENT_ROWS = ["selected", "secondary"];

export function AgentsPageLoadingShell() {
  return (
    <div data-testid="agents-page-loading-shell" className="h-full min-h-0 w-full overflow-hidden bg-background">
      <span className="sr-only" role="status">Loading agent workspace</span>

      <div aria-hidden="true" className="agents-page-loading-desktop h-full min-h-0">
        <div data-slot="loading-navigation" className="relative flex h-full min-h-0 w-64 shrink-0 flex-col bg-[var(--agent-panel-background)] pt-14">
          <div data-slot="loading-navigation-header" className="absolute inset-x-0 top-0 flex h-14 items-center border-b border-r border-border bg-[var(--agent-panel-background)] pl-4 pr-3">
            <HyperCLILogo decorative className="h-[24px] w-[124px]" imageClassName="text-[17px]" />
          </div>

          <div data-slot="loading-navigation-sections" className="relative mt-2 flex min-h-0 flex-1">
            <aside data-slot="loading-roster" className="flex h-full w-52 shrink-0 flex-col bg-[var(--agent-panel-background)]">
              <div data-slot="loading-roster-scroll" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-tr-2xl border-t border-border bg-[var(--agent-roster-background)] text-text-muted shadow-[inset_-1px_0_0_var(--border)]">
                <div data-slot="loading-roster-actions" className="flex w-full shrink-0 items-center px-3 py-1.5">
                  <div className="flex w-full items-center justify-between gap-2">
                    <h2 className="text-[13px] font-medium text-text-secondary">Agents</h2>
                    <span className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-text-muted">
                      <PanelLeftClose className="h-4 w-4" />
                    </span>
                  </div>
                </div>

                <div className="mb-1 shrink-0">
                  <div data-slot="loading-home" className="flex h-9 w-full items-center gap-1 pl-1 pr-2 text-left text-[13px] text-text-secondary">
                    <span className="flex w-5 shrink-0 items-center justify-center">
                      <House className="h-4 w-4" />
                    </span>
                    <span className="font-medium">Home</span>
                  </div>
                </div>

                <div data-slot="loading-agent-list" className="min-h-0 shrink overflow-hidden">
                  <div data-slot="loading-launch-agent" className="relative flex w-full items-center gap-1 py-2 pl-1 pr-2 text-left">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.25)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]">
                      <Plus className="h-3 w-3" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold leading-4 text-foreground">Launch agent</span>
                      <span className="mt-0.5 block truncate text-[12px] leading-4 text-text-secondary">Create a new workspace</span>
                    </span>
                  </div>

                  {ANONYMOUS_AGENT_ROWS.map((row, index) => (
                    <div
                      key={row}
                      data-slot="loading-agent-row"
                      className={`flex h-11 w-full items-center gap-1 border-r border-border py-2 pl-1 pr-2 ${index === 0 ? "bg-[rgb(var(--selection-accent-rgb)_/_0.1)]" : ""}`}
                    >
                      <span className="h-5 w-5 shrink-0 rounded-full border border-border bg-surface-low" />
                      <span className="flex h-7 min-w-0 flex-1 flex-col justify-center">
                        <span className="h-3 w-28 rounded-full bg-surface-low" />
                        <span className="mt-1 h-2 w-14 rounded-full bg-surface-low" />
                      </span>
                    </div>
                  ))}
                </div>

                <section data-slot="loading-administration" className="mt-1 shrink-0">
                  <div className="py-1.5 pl-1.5 pr-2 text-[13px]">
                    <span className="font-medium text-text-secondary">Administration</span>
                  </div>
                  <div data-slot="loading-usage" className="flex h-9 w-full items-center gap-1 pl-1 pr-2 text-left text-[13px] text-text-secondary">
                    <span className="flex w-5 shrink-0 items-center justify-center">
                      <BarChart3 className="h-4 w-4" />
                    </span>
                    <span className="font-medium">Usage</span>
                  </div>
                </section>
              </div>

              <div data-slot="loading-account" className="shrink-0 bg-[var(--agent-roster-background)] px-3 py-2 shadow-[inset_-1px_0_0_var(--border)]">
                <div className="flex h-12 w-full items-center justify-between rounded-md px-2 text-left text-text-muted">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="h-8 w-8 shrink-0 rounded-full bg-surface-high" />
                    <span className="h-2.5 w-16 rounded-full bg-surface-low" />
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </div>
              </div>
            </aside>

            <aside data-slot="loading-workspace" className="flex h-full w-12 shrink-0 flex-col bg-[var(--agent-panel-background)]">
              <div data-slot="loading-workspace-scroll" className="min-h-0 flex-1 overflow-hidden px-1.5 py-3">
                <div className="flex flex-col items-center space-y-1">
                  {RAIL_ITEMS.map(({ id, icon: Icon }) => (
                    <span key={id} data-slot="loading-workspace-control" className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary">
                      <Icon className="h-4 w-4" />
                    </span>
                  ))}
                </div>
              </div>
              <div data-slot="loading-workspace-advanced" className="relative border-b border-border px-1.5 pb-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary">
                  <Code2 className="h-4 w-4" />
                </span>
              </div>
              <div data-slot="loading-workspace-usage" className="p-1.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-text-muted">
                  <Sparkles className="h-4 w-4" />
                </span>
              </div>
            </aside>
          </div>
        </div>

        <div className="min-w-0 flex-1 bg-background" />
      </div>

      <div aria-hidden="true" className="agents-page-loading-mobile h-full min-h-0 flex-col">
        <header data-slot="loading-mobile-header" className="grid h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center border-b border-border bg-background px-3 pt-[env(safe-area-inset-top)]">
          <span data-slot="loading-mobile-logo" className="flex h-10 w-8 items-center justify-center rounded-xl text-foreground">
            <HyperCLILogo decorative markOnly className="h-6 w-6" />
          </span>
          <span data-slot="loading-mobile-title" className="flex h-8 min-w-0 items-center justify-center px-1">
            <span className="h-2.5 w-32 max-w-[55%] rounded-full bg-surface-low" />
          </span>
          <span data-slot="loading-mobile-menu" className="flex h-11 w-11 items-center justify-center rounded-xl text-text-secondary">
            <Menu className="h-6 w-6" />
          </span>
        </header>
        <div className="min-h-0 flex-1 bg-background" />
      </div>
    </div>
  );
}
