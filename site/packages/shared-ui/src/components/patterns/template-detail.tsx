import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "../ui/utils";
import { SurfaceCard } from "./surface-card";

export interface TemplateDetailBreadcrumb {
  label: ReactNode;
  href?: string;
}

export interface TemplateDetailAction {
  label: ReactNode;
  href: string;
  external?: boolean;
  variant?: "primary" | "secondary";
  icon?: ReactNode;
}

export function TemplateDetailBadge({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: "neutral" | "primary";
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-4 py-1.5 text-sm font-medium",
        variant === "primary"
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-border-medium/50 bg-surface-low text-text-secondary",
      )}
    >
      {children}
    </span>
  );
}

export function TemplateDetailBreadcrumbs({ items }: { items: TemplateDetailBreadcrumb[] }) {
  return (
    <nav className="mb-8 text-sm" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={index}>
          {index > 0 && <span className="mx-2 text-text-muted/60">/</span>}
          {item.href ? (
            <Link href={item.href} className="text-text-secondary transition-colors hover:text-primary hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function TemplateDetailActionLink({ action }: { action: TemplateDetailAction }) {
  const className = cn(
    "inline-flex items-center gap-2 rounded-xl px-8 py-4 font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    action.variant === "secondary" ? "btn-secondary" : "btn-primary glow-green-subtle",
  );
  const content = (
    <>
      {action.label}
      {action.icon}
    </>
  );

  if (action.external) {
    return (
      <a href={action.href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={action.href} className={className}>
      {content}
    </Link>
  );
}

export function TemplateDetailHero({
  breadcrumbs,
  badges,
  title,
  description,
  actions,
  media,
  backgroundEffect,
  mediaAspect = "square",
}: {
  breadcrumbs: TemplateDetailBreadcrumb[];
  badges?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: TemplateDetailAction[];
  media?: ReactNode;
  backgroundEffect?: ReactNode;
  mediaAspect?: "square" | "video";
}) {
  return (
    <section className="relative overflow-hidden border-b border-border-medium/30 bg-background py-16 sm:py-24">
      {backgroundEffect}
      <div className="pointer-events-none absolute inset-0 bg-grid-pattern opacity-[0.02]" />
      <div className="relative z-20 mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <TemplateDetailBreadcrumbs items={breadcrumbs} />
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            {badges && <div className="mb-6 flex flex-wrap items-center gap-2">{badges}</div>}
            <h1 className="mb-6 text-[40px] font-bold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-[48px] lg:text-[56px]">
              {title}
            </h1>
            {description && <p className="mb-8 text-xl leading-relaxed text-text-secondary">{description}</p>}
            {actions && actions.length > 0 && (
              <div className="flex flex-wrap gap-4">
                {actions.map((action, index) => (
                  <TemplateDetailActionLink key={index} action={action} />
                ))}
              </div>
            )}
          </div>

          {media && (
            <SurfaceCard className="overflow-hidden rounded-2xl border-border-medium/50 bg-surface-low p-0 shadow-[0_24px_80px_rgb(0_0_0_/_0.18)]">
              <div className={cn("relative overflow-hidden", mediaAspect === "square" ? "aspect-square" : "aspect-video")}>
                {media}
              </div>
            </SurfaceCard>
          )}
        </div>
      </div>
    </section>
  );
}

export function TemplateDetailContent({ children }: { children: ReactNode }) {
  return (
    <section className="bg-background py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

export function TemplateDetailSection({
  id,
  title,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("mb-16 scroll-mt-8", className)}>
      <h2 className="mb-6 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h2>
      {children}
    </section>
  );
}

export function TemplateDetailPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <SurfaceCard className={cn("overflow-hidden rounded-xl border-border-medium/50 bg-background p-0", className)}>
      {children}
    </SurfaceCard>
  );
}

export function TemplateCodeBlock({
  code,
  label,
  action,
  className,
}: {
  code: ReactNode;
  label?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <TemplateDetailPanel className={className}>
      {(label || action) && (
        <div className="flex items-center justify-between border-b border-border-medium/30 bg-surface-low px-4 py-2">
          {label && <span className="text-xs font-mono text-text-muted">{label}</span>}
          {action}
        </div>
      )}
      <pre className="overflow-x-auto p-6 text-sm leading-relaxed text-text-secondary">
        <code className="font-mono">{code}</code>
      </pre>
    </TemplateDetailPanel>
  );
}

export function TemplateTable({ children }: { children: ReactNode }) {
  return (
    <TemplateDetailPanel>
      <div className="overflow-x-auto">
        <table className="w-full">{children}</table>
      </div>
    </TemplateDetailPanel>
  );
}

export function TemplateCtaCard({
  title,
  description,
  code,
  actions,
}: {
  title: ReactNode;
  description: ReactNode;
  code?: ReactNode;
  actions: TemplateDetailAction[];
}) {
  return (
    <section className="border-t border-border-medium/30 bg-background py-16 sm:py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <SurfaceCard className="relative overflow-hidden rounded-2xl border-border-medium/50 bg-background p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(var(--selection-accent-rgb)_/_0.08)_0%,transparent_52%)]" />
          <div className="relative">
            <h3 className="mb-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h3>
            <p className="mb-6 text-lg text-text-secondary">{description}</p>
            {code && <TemplateCodeBlock code={code} className="mb-8" />}
            <div className="flex flex-wrap gap-4">
              {actions.map((action, index) => (
                <TemplateDetailActionLink key={index} action={action} />
              ))}
            </div>
          </div>
        </SurfaceCard>
      </div>
    </section>
  );
}
