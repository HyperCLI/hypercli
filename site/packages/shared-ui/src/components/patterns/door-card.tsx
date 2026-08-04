import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "../ui/utils";
import { GlassCard } from "./surface-card";

export type DoorCardTone = "mint" | "blue" | "lavender";

export interface DoorCardProps {
  title: string;
  blurb: string;
  href: string;
  tone?: DoorCardTone;
  kicker?: string;
  goText?: string;
  className?: string;
}

const toneBarClasses: Record<DoorCardTone, string> = {
  mint: "bg-success",
  blue: "bg-primary",
  lavender: "bg-chart-3",
};

const toneAccentClasses: Record<DoorCardTone, string> = {
  mint: "text-success",
  blue: "text-primary",
  lavender: "text-chart-3",
};

export function DoorCard({ title, blurb, href, tone = "mint", kicker, goText, className }: DoorCardProps) {
  return (
    <Link href={href} className={cn("group block", className)}>
      <GlassCard interactive className="flex h-full flex-col overflow-hidden p-0">
        <div className={cn("h-1 w-full", toneBarClasses[tone])} aria-hidden="true" />
        <div className="flex flex-1 flex-col p-6">
          {kicker && (
            <p className="mb-1.5 text-xs font-bold uppercase tracking-[0.09em] text-text-muted">{kicker}</p>
          )}
          <div className="flex items-start justify-between gap-4">
            <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
            <ArrowRight
              aria-hidden="true"
              className={cn("mt-1 h-5 w-5 flex-shrink-0 transition-transform group-hover:translate-x-1", toneAccentClasses[tone])}
            />
          </div>
          <p className="flex-1 text-sm leading-relaxed text-text-secondary">{blurb}</p>
          {goText && <p className={cn("mt-5 text-sm font-semibold", toneAccentClasses[tone])}>{goText}</p>}
        </div>
      </GlassCard>
    </Link>
  );
}
