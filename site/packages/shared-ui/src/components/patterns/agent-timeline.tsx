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
    <div className={cn("relative mx-auto max-w-xl text-left", className)}>
      {title && <h3 className="mb-6 text-lg font-semibold text-terminal-foreground">{title}</h3>}
      <ol
        className="relative space-y-5 pl-0 before:absolute before:bottom-2 before:left-[82px] before:top-2 before:w-0.5 before:rounded-full before:bg-[linear-gradient(180deg,rgba(157,180,255,0.5),rgba(108,232,196,0.35),rgba(201,175,255,0.4))] before:content-['']"
      >
        {events.map((event, index) => (
          <li key={index} className="flex items-start gap-5">
            <span className="w-[62px] flex-shrink-0 pt-1 text-right font-mono text-xs text-accent-hover">
              {event.time}
            </span>
            <span
              aria-hidden="true"
              className="relative z-10 mt-1.5 h-[13px] w-[13px] flex-shrink-0 rounded-full border-2 border-[rgba(108,232,196,0.4)] bg-terminal-live shadow-[0_0_12px_rgba(108,232,196,0.5)]"
            />
            <div className="min-w-0 flex-1 pb-1">
              <p className="text-[15px] font-semibold leading-snug text-terminal-foreground">
                {event.text}
                {event.tag && (
                  <span className="ml-2 rounded-full bg-chart-3/15 px-2.5 py-0.5 align-[1px] text-[10.5px] font-bold uppercase tracking-[0.06em] text-chart-3">
                    {event.tag}
                  </span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {footer && (
        <p className="mt-8 text-center text-lg font-semibold text-terminal-foreground">
          {footer}
        </p>
      )}
    </div>
  );
}
