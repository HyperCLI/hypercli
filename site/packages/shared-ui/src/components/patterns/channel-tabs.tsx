import Link from "next/link";
import { cn } from "../ui/utils";

export interface ChannelTab {
  label: string;
  href: string;
}

export interface ChannelTabsProps {
  channels: ChannelTab[];
  activeLabel?: string;
  className?: string;
}

export function ChannelTabs({ channels, activeLabel, className }: ChannelTabsProps) {
  return (
    <nav aria-label="Channels" className={cn("flex flex-wrap items-center gap-2", className)}>
      {channels.map((channel) => {
        const active = channel.label === activeLabel;
        return (
          <Link
            key={channel.href}
            href={channel.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-all",
              active
                ? "bg-primary text-primary-foreground"
                : "border border-border-medium/40 text-text-secondary hover:border-border-medium hover:text-foreground",
            )}
          >
            {channel.label}
          </Link>
        );
      })}
    </nav>
  );
}
