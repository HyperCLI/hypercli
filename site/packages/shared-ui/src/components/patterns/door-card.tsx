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
  className?: string;
}

const toneBarClasses: Record<DoorCardTone, string> = {
  mint: "bg-primary",
  blue: "bg-info",
  lavender: "bg-[var(--integration-discord)]",
};

const toneArrowClasses: Record<DoorCardTone, string> = {
  mint: "text-primary",
  blue: "text-info",
  lavender: "text-[var(--integration-discord)]",
};

export function DoorCard({ title, blurb, href, tone = "mint", className }: DoorCardProps) {
  return (
    <Link href={href} className={cn("group block", className)}>
      <GlassCard interactive className="h-full overflow-hidden p-0">
        <div className={cn("h-1 w-full", toneBarClasses[tone])} aria-hidden="true" />
        <div className="flex items-start justify-between gap-4 p-6">
          <div>
            <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-sm leading-relaxed text-text-secondary">{blurb}</p>
          </div>
          <ArrowRight
            aria-hidden="true"
            className={cn("mt-1 h-5 w-5 flex-shrink-0 transition-transform group-hover:translate-x-1", toneArrowClasses[tone])}
          />
        </div>
      </GlassCard>
    </Link>
  );
}
