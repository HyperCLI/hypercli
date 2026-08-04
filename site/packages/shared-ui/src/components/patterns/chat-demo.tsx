import { cn } from "../ui/utils";

export interface ChatMessage {
  from: "user" | "agent";
  author: string;
  text: string;
  time?: string;
}

export interface ChatDemoProps {
  channel?: string;
  agentName?: string;
  messages: ChatMessage[];
  className?: string;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function Avatar({ name, variant }: { name: string; variant: "user" | "agent" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        variant === "agent" ? "bg-primary/15 text-primary" : "bg-surface-high text-text-secondary",
      )}
    >
      {initials(name)}
    </span>
  );
}

export function ChatDemo({ channel, agentName = "Aria", messages, className }: ChatDemoProps) {
  return (
    <div className={cn("glass-card overflow-hidden", className)}>
      <div className="flex items-center justify-between border-b border-border-medium/30 px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Avatar name={agentName} variant="agent" />
          <span>{agentName}</span>
          {channel && <span className="text-text-muted">· {channel}</span>}
        </div>
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
          Online
        </span>
      </div>
      <div className="space-y-4 p-5">
        {messages.map((message, index) => {
          const isUser = message.from === "user";
          return (
            <div key={index} className={cn("flex items-start gap-3", isUser && "flex-row-reverse")}>
              <Avatar name={message.author} variant={isUser ? "user" : "agent"} />
              <div className={cn("max-w-[75%]", isUser && "text-right")}>
                <div className={cn("mb-1 flex items-baseline gap-2 text-xs", isUser && "flex-row-reverse")}>
                  <span className="font-medium text-foreground">{message.author}</span>
                  {message.time && <span className="text-text-muted">{message.time}</span>}
                </div>
                <p
                  className={cn(
                    "inline-block rounded-2xl px-4 py-2.5 text-left text-sm leading-relaxed",
                    isUser
                      ? "rounded-tr-sm bg-surface-high text-text-secondary"
                      : "rounded-tl-sm border border-primary/20 bg-primary/5 text-foreground",
                  )}
                >
                  {message.text}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
