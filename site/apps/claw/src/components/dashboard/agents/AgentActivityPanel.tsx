"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  FilePenLine,
  FileText,
  Image as ImageIcon,
  Info,
  KeyRound,
  ListTodo,
  MessageSquare,
  PictureInPicture2,
  Send,
  TerminalSquare,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { ACTIVITY_TYPE_COLORS } from "@/components/dashboard/agentViewMockData";
import { relativeTime } from "@/components/dashboard/agentViewUtils";
import { TabLoadingState } from "@/components/dashboard/agents/page-helpers";
import type { ActivityStatus } from "@/hooks/useAgentActivity";
import type { ActivityRenderClass, BuzzActivityEvent } from "@/lib/buzz-activity";

const RENDER_CLASS_PRESENTATION: Record<string, { icon: LucideIcon; tone: string }> = {
  message: { icon: MessageSquare, tone: ACTIVITY_TYPE_COLORS.message },
  "relay-op": { icon: Send, tone: ACTIVITY_TYPE_COLORS.tool },
  "file-edit": { icon: FilePenLine, tone: ACTIVITY_TYPE_COLORS.tool },
  "file-read": { icon: FileText, tone: ACTIVITY_TYPE_COLORS.tool },
  "skill-read": { icon: BookOpen, tone: ACTIVITY_TYPE_COLORS.skill },
  image: { icon: ImageIcon, tone: ACTIVITY_TYPE_COLORS.connection },
  shell: { icon: TerminalSquare, tone: ACTIVITY_TYPE_COLORS.tool },
  status: { icon: Info, tone: ACTIVITY_TYPE_COLORS.system },
  thought: { icon: Brain, tone: ACTIVITY_TYPE_COLORS.system },
  plan: { icon: ListTodo, tone: ACTIVITY_TYPE_COLORS.system },
  permission: { icon: KeyRound, tone: ACTIVITY_TYPE_COLORS.cron },
  error: { icon: AlertTriangle, tone: ACTIVITY_TYPE_COLORS.error },
  generic: { icon: Wrench, tone: ACTIVITY_TYPE_COLORS.tool },
};

function presentationFor(renderClass: ActivityRenderClass) {
  return RENDER_CLASS_PRESENTATION[renderClass] ?? RENDER_CLASS_PRESENTATION.generic;
}

function isHiddenRenderClass(renderClass: ActivityRenderClass): boolean {
  return renderClass === "suppressed" || renderClass === "raw-rail";
}

function ToolStatusIndicator({ event }: { event: BuzzActivityEvent }) {
  if (event.isError || event.status === "failed") {
    return <AlertTriangle data-testid="agents-activity-status-failed" className="h-3 w-3 text-destructive opacity-90" />;
  }
  if (event.status === "completed") {
    return <Check data-testid="agents-activity-status-completed" className="h-3 w-3 text-[var(--selection-accent)] opacity-75" />;
  }
  if (event.status === "executing" || event.status === "pending") {
    return (
      <span
        data-testid="agents-activity-status-running"
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--selection-accent)]"
      />
    );
  }
  return null;
}

function eventPreview(event: BuzzActivityEvent): string | null {
  if (event.preview) return event.preview;
  if (!event.detail) return null;
  const firstLine = event.detail.split("\n").find((line) => line.trim().length > 0);
  return firstLine ?? null;
}

function AgentActivityEventRow({ event, fresh }: { event: BuzzActivityEvent; fresh: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const { icon: Icon, tone } = presentationFor(event.renderClass);
  const preview = eventPreview(event);
  const timestamp = Date.parse(event.timestamp);

  return (
    <div
      data-testid="agents-activity-event"
      className={`rounded-lg border border-border/45 bg-surface-low/20 px-3 py-2 transition-colors hover:bg-surface-low/45 ${fresh ? "activity-flash" : ""}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80 ${tone}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-foreground">{event.label}</span>
            <ToolStatusIndicator event={event} />
          </div>
          {preview ? (
            <div className="mt-0.5 truncate font-mono text-[0.625rem] text-text-muted">{preview}</div>
          ) : null}
        </div>
        {Number.isFinite(timestamp) ? (
          <span className="mt-0.5 shrink-0 whitespace-nowrap text-[0.625rem] text-text-muted">
            {relativeTime(timestamp)}
          </span>
        ) : null}
        <button
          type="button"
          aria-label={`Toggle raw event for ${event.label}`}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
        >
          <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
      </div>
      {expanded ? (
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-background p-2 font-mono text-[0.625rem] leading-4 text-text-secondary whitespace-pre-wrap break-words">
          {JSON.stringify(event.raw, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

interface AgentActivityPanelProps {
  status: ActivityStatus;
  events: BuzzActivityEvent[];
  error?: string | null;
  activityBoxRef: React.RefObject<HTMLDivElement | null>;
  onReconnect?: () => void;
  onPopOut?: () => void;
}

export function AgentActivityPanel({ status, events, error, activityBoxRef, onReconnect, onPopOut }: AgentActivityPanelProps) {
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const visibleEvents = events.filter((event) => !isHiddenRenderClass(event.renderClass));
  const freshIds = new Set(visibleEvents.filter((event) => !seenEventIdsRef.current.has(event.id)).map((event) => event.id));

  useEffect(() => {
    const seen = seenEventIdsRef.current;
    for (const event of events) seen.add(event.id);
  }, [events]);

  if (status === "connecting") {
    return (
      <TabLoadingState
        label="Connecting activity"
        detail="Opening the activity stream."
      />
    );
  }

  if (status === "error") {
    return (
      <div data-testid="agents-activity-panel" className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <p className="text-sm font-medium text-foreground">Activity stream error</p>
        <p className="text-xs text-text-muted">{error ?? "The activity stream failed."}</p>
        {onReconnect ? (
          <button
            type="button"
            onClick={onReconnect}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-low"
          >
            Reconnect
          </button>
        ) : null}
      </div>
    );
  }

  if (status === "disconnected") {
    return (
      <div data-testid="agents-activity-panel" className="flex h-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <WifiOff className="h-5 w-5 text-text-muted" />
        <p className="text-sm font-medium text-foreground">Activity disconnected</p>
        <p className="text-xs text-text-muted">The activity stream closed.</p>
        {onReconnect ? (
          <button
            type="button"
            onClick={onReconnect}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-low"
          >
            Reconnect
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid="agents-activity-panel" className="relative h-full min-h-0 bg-background">
      {onPopOut ? (
        <button
          type="button"
          onClick={onPopOut}
          aria-label="Pop out activity"
          className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-border bg-popover/95 px-2.5 py-1 text-[0.6875rem] font-medium text-text-secondary shadow-sm transition-colors hover:bg-surface-low hover:text-foreground"
        >
          <PictureInPicture2 className="h-3 w-3" />
          Pop out
        </button>
      ) : null}
      <div ref={activityBoxRef} className="h-full overflow-auto p-4">
        {visibleEvents.length === 0 ? (
          <div data-testid="agents-activity-empty" className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageSquare className="h-5 w-5 text-text-muted" />
            <p className="text-xs text-text-muted">No activity yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleEvents.map((event) => (
              <AgentActivityEventRow key={event.id} event={event} fresh={freshIds.has(event.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
