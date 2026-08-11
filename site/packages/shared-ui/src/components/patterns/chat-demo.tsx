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

function SlackAvatar({ name, variant }: { name: string; variant: "user" | "agent" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] text-[12.5px] font-semibold",
        variant === "agent" ? "bg-[#EEF2FF] text-[#4F7CFF]" : "bg-[#FFF6DC] text-[#8A6410]",
      )}
    >
      {initials(name)}
    </span>
  );
}

export function ChatDemo({ channel, agentName = "Aria", messages, className }: ChatDemoProps) {
  return (
    <div
      className={cn(
        "rounded-[22px] border border-[#EEF2F7] bg-white p-6 text-left shadow-[0_1px_2px_rgba(31,41,55,0.05),0_24px_60px_-30px_rgba(79,124,255,0.25)]",
        className,
      )}
    >
      {channel && (
        <div className="mb-4 flex items-center gap-2 border-b border-[#EEF2F7] pb-3">
          <span className="text-[15px] font-bold text-[#1F2937]"># {channel}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-[#64748B]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6CE8C4]" aria-hidden="true" />
            {agentName} is online
          </span>
        </div>
      )}
      <div className="space-y-4">
        {messages.map((message, index) => {
          const isUser = message.from === "user";
          return (
            <div key={index} className="flex gap-3">
              <SlackAvatar name={message.author} variant={isUser ? "user" : "agent"} />
              <div className="min-w-0">
                <div className="mb-0.5 flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-[#1F2937]">{message.author}</span>
                  {message.time && <span className="text-[11.5px] text-[#64748B]">{message.time}</span>}
                </div>
                <p className="text-[13.5px] leading-relaxed text-[#64748B] [&>b]:font-semibold [&>b]:text-[#1F2937]">
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
