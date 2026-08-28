"use client";

import { useDeferredValue, useState, type Ref } from "react";
import { Archive, LayoutGrid, List, Loader2, Trash2 } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  Input,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from "@hypercli/shared-ui";

import type { Agent } from "@/app/dashboard/agents/types";
import { isAgentTransitionalState, resolveAgentLifecycleControls } from "@/app/dashboard/agents/types";
import { agentDisplayLabel } from "@/components/dashboard/agents/agentViewModel";
import { agentProfileImageUrl } from "@/lib/avatar";

type AgentLayout = "grid" | "rows";

function agentStateLabel(state: string): string {
  const normalized = state.trim().toLowerCase().replaceAll("_", " ");
  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : "Unknown";
}

function agentStateBadgeVariant(state: string): "success" | "destructive" | "active" | "secondary" {
  const normalized = state.trim().toUpperCase();
  if (normalized === "RUNNING") return "success";
  if (normalized === "FAILED") return "destructive";
  if (isAgentTransitionalState(normalized)) return "active";
  return "secondary";
}

function agentInitials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";
}

function AgentCardLoading({ layout }: { layout: AgentLayout }) {
  const rows = layout === "rows";

  return (
    <Card className={cn(
      "gap-0 rounded-xl bg-surface-high/70 shadow-none",
      rows ? "min-h-20 flex-row items-center" : "min-h-52",
    )}>
      <CardHeader className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] gap-4",
        rows ? "min-w-0 flex-1 p-4" : "p-5",
      )}>
        <Skeleton className="size-12 rounded-full" />
        <div className="min-w-0 space-y-2 pt-1">
          <Skeleton className="h-4 w-32 max-w-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </CardHeader>
      <CardFooter className={cn(rows ? "p-4 pl-0" : "mt-auto p-5 pt-3")}>
        <Skeleton className={cn("h-9 rounded-lg", rows ? "w-20 sm:w-32" : "w-32")} />
      </CardFooter>
    </Card>
  );
}

export function SettingsAgentSelector({
  agents,
  loading,
  error,
  onSelect,
  onArchive,
  onDelete,
  onRetry,
  onCreateAgent,
  archivingAgentId = null,
  deletingAgentId = null,
  filterInputRef,
}: {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  onSelect: (agentId: string) => void;
  onArchive: (agentId: string) => void;
  onDelete: (agentId: string) => void;
  onRetry: () => void | Promise<void>;
  onCreateAgent: () => void;
  archivingAgentId?: string | null;
  deletingAgentId?: string | null;
  filterInputRef?: Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [layout, setLayout] = useState<AgentLayout>("grid");
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLocaleLowerCase();
  const filteredAgents = normalizedQuery
    ? agents.filter((agent) => agentDisplayLabel(agent).toLocaleLowerCase().includes(normalizedQuery))
    : agents;
  const waitingForAgents = (loading || retrying) && agents.length === 0;

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      data-testid="settings-agent-selector"
      className="h-full overflow-y-auto bg-background px-4 py-6 text-left text-foreground sm:px-6 lg:px-8"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[96rem] flex-col">
        <div className="flex items-center justify-between gap-3">
          <Input
            ref={filterInputRef}
            type="search"
            aria-label="Filter agents by name"
            placeholder="Filter by name..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={waitingForAgents}
            className="h-11 min-w-0 flex-1 max-w-lg rounded-xl bg-background px-4 text-base md:text-sm"
          />
          <ToggleGroup
            type="single"
            value={layout}
            onValueChange={(value) => {
              if (value === "grid" || value === "rows") setLayout(value);
            }}
            size="sm"
            aria-label="Agent layout"
            className="h-9 w-fit shrink-0 rounded-lg border border-border bg-surface-low/50 p-0.5 shadow-none"
          >
            <ToggleGroupItem
              value="grid"
              aria-label="Grid view"
              title="Grid view"
              className="size-8 flex-none rounded-md border-0 px-0 text-text-muted hover:bg-surface-high/70 hover:text-foreground data-[state=on]:bg-surface-high data-[state=on]:text-foreground first:rounded-md last:rounded-md"
            >
              <LayoutGrid className="size-3.5" aria-hidden="true" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="rows"
              aria-label="Rows view"
              title="Rows view"
              className="size-8 flex-none rounded-md border-0 px-0 text-text-muted hover:bg-surface-high/70 hover:text-foreground data-[state=on]:bg-surface-high data-[state=on]:text-foreground first:rounded-md last:rounded-md"
            >
              <List className="size-3.5" aria-hidden="true" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {error && agents.length > 0 ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Agents may be out of date</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => { void retry(); }} disabled={retrying}>
                {retrying ? "Trying again" : "Try again"}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <Card
          aria-labelledby="settings-agents-title"
          className="mt-6 min-h-[30rem] flex-1 gap-0 rounded-2xl bg-surface-low/50 shadow-none"
        >
          <CardHeader className="gap-1 p-5 sm:p-6">
            <CardTitle id="settings-agents-title" className="text-xl font-semibold tracking-tight text-foreground">
              Agents
            </CardTitle>
            <CardDescription className="text-sm text-text-muted">
              {agents.length === 0 && !waitingForAgents
                ? "Create an agent before opening agent settings."
                : "Select the agent whose settings you want to manage."}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex-1 p-5 pt-0 sm:p-6 sm:pt-0">
            {waitingForAgents ? (
              <div
                role="status"
                aria-label="Loading agents"
                className={layout === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-3"}
              >
                <span className="sr-only">Loading agents</span>
                {[0, 1, 2].map((index) => <AgentCardLoading key={index} layout={layout} />)}
              </div>
            ) : error && agents.length === 0 ? (
              <Alert variant="destructive" className="max-w-2xl">
                <AlertTitle>Agents could not be loaded</AlertTitle>
                <AlertDescription>
                  <p>{error}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => { void retry(); }} disabled={retrying} className="mt-3">
                    {retrying ? "Trying again" : "Try again"}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <p className="sr-only" aria-live="polite">
                  {filteredAgents.length === 1 ? "1 agent shown" : `${filteredAgents.length} agents shown`}
                </p>
                <ul
                  aria-label="Agents"
                  data-layout={layout}
                  className={layout === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-3"}
                >
                  {filteredAgents.map((agent) => {
                    const name = agentDisplayLabel(agent);
                    const avatarUrl = agentProfileImageUrl(agent);
                    const lifecycle = resolveAgentLifecycleControls(agent);
                    const archiving = archivingAgentId === agent.id;
                    const deleting = deletingAgentId === agent.id;
                    const lifecycleBusy = archiving || deleting;

                    return (
                      <li key={agent.id} className="min-w-0">
                        <Card className={cn(
                          "gap-0 overflow-hidden rounded-xl bg-surface-high/70 shadow-none",
                          layout === "grid" ? "min-h-52" : "min-h-20 flex-col sm:flex-row sm:items-stretch",
                        )}>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onSelect(agent.id)}
                            data-testid={`settings-agent-option-${agent.id}`}
                            aria-label={`Open settings for ${name}`}
                            className={cn(
                              "h-auto min-w-0 flex-1 items-stretch justify-start gap-0 whitespace-normal rounded-none p-0 text-left hover:bg-surface-high",
                              layout === "grid" && "w-full",
                            )}
                          >
                            <span className={cn(
                              "grid w-full grid-cols-[auto_minmax(0,1fr)] gap-4",
                              layout === "grid" ? "p-5" : "p-4",
                            )}>
                              <Avatar className="size-12 border border-border bg-background" title={name}>
                                {avatarUrl ? <AvatarImage src={avatarUrl} alt={`${name} avatar`} className="object-cover" /> : null}
                                <AvatarFallback className="bg-background text-sm font-semibold text-text-secondary">
                                  {agentInitials(name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="min-w-0 pt-0.5">
                                <span className="block truncate text-base font-semibold leading-5 text-foreground">
                                  {name}
                                </span>
                                <Badge variant={agentStateBadgeVariant(agent.state)} className="mt-2 rounded-full">
                                  {agentStateLabel(agent.state)}
                                </Badge>
                              </span>
                            </span>
                          </Button>
                          <CardFooter className={cn(
                            "flex flex-wrap items-center gap-2",
                            layout === "grid" ? "mt-auto p-5 pt-3" : "justify-end p-4 pt-0 sm:shrink-0 sm:p-4 sm:pl-0",
                          )}>
                            {lifecycle.canArchive ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onArchive(agent.id)}
                                disabled={lifecycleBusy}
                                aria-label={archiving ? `Archiving ${name}` : `Archive ${name}`}
                                aria-busy={archiving || undefined}
                                className="rounded-lg bg-background"
                              >
                                {archiving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Archive />}
                                <span className={layout === "rows" ? "sr-only xl:not-sr-only" : undefined}>
                                  {archiving ? "Archiving" : "Archive"}
                                </span>
                              </Button>
                            ) : null}
                            {lifecycle.canDelete ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => onDelete(agent.id)}
                                disabled={lifecycleBusy}
                                aria-label={deleting ? `Deleting ${name}` : `Delete ${name}`}
                                aria-busy={deleting || undefined}
                                className="rounded-lg border-destructive/30 bg-background text-destructive hover:bg-destructive/10 hover:text-destructive"
                              >
                                {deleting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Trash2 />}
                                <span className={layout === "rows" ? "sr-only xl:not-sr-only" : undefined}>
                                  {deleting ? "Deleting" : "Delete"}
                                </span>
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => onSelect(agent.id)}
                              aria-label={`Open ${name} settings`}
                              className="rounded-lg bg-background"
                            >
                              {layout === "rows" ? (
                                <>
                                  <span className="sm:hidden">Open</span>
                                  <span className="hidden sm:inline">Open settings</span>
                                </>
                              ) : "Open settings"}
                            </Button>
                          </CardFooter>
                        </Card>
                      </li>
                    );
                  })}

                  {normalizedQuery && filteredAgents.length === 0 ? (
                    <li className={cn("min-w-0", layout === "grid" && "sm:col-span-2 xl:col-span-3")}>
                      <Card role="status" className="gap-0 rounded-xl border-dashed bg-background/30 shadow-none">
                        <CardContent className="p-6 text-center">
                          <p className="text-sm font-medium text-foreground">No matching agents</p>
                          <p className="mt-1 text-sm text-text-muted">Try a different name.</p>
                          <Button type="button" variant="outline" size="sm" onClick={() => setQuery("")} className="mt-4">
                            Clear filter
                          </Button>
                        </CardContent>
                      </Card>
                    </li>
                  ) : null}

                  <li className="min-w-0">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onCreateAgent}
                      aria-label="New agent"
                      className={cn(
                        "w-full rounded-xl border-dashed bg-background/30 text-text-secondary hover:border-border-strong hover:bg-surface-high hover:text-foreground",
                        layout === "grid" ? "min-h-52 flex-col" : "min-h-20 justify-start px-5",
                      )}
                    >
                      <span aria-hidden="true" className={cn(
                        "flex items-center justify-center bg-surface-high font-light leading-none text-foreground",
                        layout === "grid" ? "size-11 rounded-xl text-2xl" : "size-9 rounded-lg text-xl",
                      )}>
                        +
                      </span>
                      <span>New agent</span>
                    </Button>
                  </li>
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
