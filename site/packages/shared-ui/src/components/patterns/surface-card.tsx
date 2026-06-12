import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import { cn } from "../ui/utils";

export type SurfaceCardProps = HTMLAttributes<HTMLDivElement> & {
  highlighted?: boolean;
  interactive?: boolean;
};

export function GlassCard({ className, highlighted = false, interactive = false, ...props }: SurfaceCardProps) {
  return (
    <div
      className={cn(
        "glass-card",
        highlighted && "border-[rgb(var(--selection-accent-rgb)_/_0.4)] shadow-[0_0_40px_rgb(var(--selection-accent-rgb)_/_0.12)]",
        interactive && "hover:border-[rgb(var(--selection-accent-rgb)_/_0.24)] hover:shadow-[0_8px_32px_rgb(var(--selection-accent-rgb)_/_0.08)]",
        className,
      )}
      {...props}
    />
  );
}

export function SurfaceCard({ className, highlighted = false, interactive = false, ...props }: SurfaceCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface-low text-foreground transition-all duration-200",
        highlighted && "border-[rgb(var(--selection-accent-rgb)_/_0.36)] bg-[rgb(var(--selection-accent-rgb)_/_0.05)]",
        interactive && "hover:border-[rgb(var(--selection-accent-rgb)_/_0.24)] hover:bg-surface-high/80",
        className,
      )}
      {...props}
    />
  );
}

export type MetricCardProps = SurfaceCardProps & {
  icon?: ComponentType<{ className?: string }>;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
};

export function MetricCard({ icon: Icon, label, value, detail, className, ...props }: MetricCardProps) {
  return (
    <GlassCard className={cn("p-4", className)} {...props}>
      <div className="mb-3 flex items-center gap-2 text-sm text-text-tertiary">
        {Icon && <Icon className="h-4 w-4 text-[var(--selection-accent)]" />}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-semibold text-foreground">{value}</div>
      {detail && <div className="mt-1 text-xs text-text-muted">{detail}</div>}
    </GlassCard>
  );
}
