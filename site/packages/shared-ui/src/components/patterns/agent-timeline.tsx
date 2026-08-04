import { cn } from "../ui/utils";

export interface AgentTimelineEvent {
  time: string;
  text: string;
  tag?: string;
}

export interface AgentTimelineProps {
  title?: string;
  events: AgentTimelineEvent[];
  footer?: string;
  className?: string;
}

export function AgentTimeline({ title, events, footer, className }: AgentTimelineProps) {
  return (
    <div className={cn("glass-card p-6", className)}>
      {title && <h3 className="mb-6 text-lg font-semibold text-foreground">{title}</h3>}
      <ol className="relative space-y-6 border-l border-border-medium/40 pl-6">
        {events.map((event, index) => (
          <li key={index} className="relative">
            <span
              aria-hidden="true"
              className="absolute -left-[1.95rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary"
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-xs text-text-muted">{event.time}</span>
              {event.tag && (
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{event.tag}</span>
              )}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">{event.text}</p>
          </li>
        ))}
      </ol>
      {footer && <p className="mt-6 border-t border-border-medium/30 pt-4 text-sm text-text-muted">{footer}</p>}
    </div>
  );
}
