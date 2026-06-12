"use client";

import { forwardRef, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Check, X } from "lucide-react";
import { cn } from "../ui/utils";
import { GlassCard } from "./surface-card";

export interface MarketingSectionProps {
  id?: string;
  children: ReactNode;
  background?: "default" | "secondary";
  bordered?: boolean;
  className?: string;
  innerClassName?: string;
}

export const MarketingSection = forwardRef<HTMLElement, MarketingSectionProps>(function MarketingSection(
  { id, children, background = "default", bordered = false, className, innerClassName },
  ref,
) {
  return (
    <section
      ref={ref}
      id={id}
      className={cn(
        "relative overflow-hidden px-4 py-24 sm:px-6 sm:py-32 lg:px-8",
        background === "secondary" && "bg-background-secondary",
        bordered && "border-t border-border-medium/30",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-grid-pattern opacity-[0.03]" />
      <div className={cn("relative mx-auto max-w-7xl", innerClassName)}>{children}</div>
    </section>
  );
});

export function SectionHeading({
  title,
  accent,
  description,
  align = "center",
  className,
}: {
  title: ReactNode;
  accent?: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn(align === "center" ? "text-center" : "text-left", className)}>
      <h2 className="mb-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
        {title}
        {accent && <> <span className="gradient-text-primary">{accent}</span></>}
      </h2>
      {description && (
        <p className={cn("text-lg leading-relaxed text-text-secondary", align === "center" && "mx-auto max-w-2xl", align === "left" && "max-w-3xl")}>
          {description}
        </p>
      )}
    </div>
  );
}

export interface CTAAction {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
  showArrow?: boolean;
}

export function CTAButtonGroup({
  actions,
  align = "center",
  className,
}: {
  actions: CTAAction[];
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row", align === "center" ? "items-center justify-center" : "items-start justify-start", className)}>
      {actions.map((action, index) => {
        const variant = action.variant ?? (index === 0 ? "primary" : "secondary");
        const classes = cn(
          "inline-flex items-center justify-center gap-2 rounded-lg px-8 py-3 text-base font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          variant === "primary" ? "btn-primary glow-green-subtle font-semibold" : "btn-secondary",
        );
        const content = (
          <>
            {action.label}
            {action.showArrow && <ArrowRight className="h-5 w-5" />}
          </>
        );

        if (action.href) {
          return (
            <Link key={`${action.href}-${index}`} href={action.href} className={classes}>
              {content}
            </Link>
          );
        }

        return (
          <button key={index} type="button" onClick={action.onClick} className={classes}>
            {content}
          </button>
        );
      })}
    </div>
  );
}

export function HeroBadge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5", className)}>
      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
      <span className="text-sm font-medium text-primary">{children}</span>
    </div>
  );
}

export function FeatureCard({
  icon: Icon,
  title,
  description,
  reveal = true,
  index = 0,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  description: ReactNode;
  reveal?: boolean;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={reveal ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      whileInView={reveal ? undefined : { opacity: 1, y: 0 }}
      viewport={reveal ? undefined : { once: true }}
      transition={{ duration: 0.6, delay: 0.2 + index * 0.1, ease: [0.22, 1, 0.36, 1] }}
    >
      <GlassCard className="p-6 sm:p-8" interactive>
        <div className="flex items-start gap-4">
          {Icon && (
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
          )}
          <div>
            <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
            <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

export function SpecCard({
  icon: Icon,
  value,
  unit,
  description,
  reveal = true,
  index = 0,
}: {
  icon: ComponentType<{ className?: string }>;
  value: ReactNode;
  unit?: ReactNode;
  description: ReactNode;
  reveal?: boolean;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -30 }}
      animate={reveal ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
      transition={{ duration: 0.6, delay: 0.2 + index * 0.1, ease: [0.22, 1, 0.36, 1] }}
    >
      <GlassCard className="flex items-start gap-4 p-5" interactive>
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">{value}</span>
            {unit && <span className="text-sm text-text-tertiary">{unit}</span>}
          </div>
          <p className="text-sm text-text-secondary">{description}</p>
        </div>
      </GlassCard>
    </motion.div>
  );
}

export function CodeSnippetCard({
  label = "terminal",
  code,
  className,
  preClassName,
}: {
  label?: ReactNode;
  code: string;
  className?: string;
  preClassName?: string;
}) {
  return (
    <GlassCard className={cn("p-1", className)}>
      <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2">
        <div className="flex gap-1.5">
          <div className="h-3 w-3 rounded-full bg-[#ff5f56]" />
          <div className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
          <div className="h-3 w-3 rounded-full bg-[#27c93f]" />
        </div>
        <span className="ml-2 text-xs text-text-muted">{label}</span>
      </div>
      <pre className={cn("overflow-x-auto border-0 bg-transparent p-4 text-left text-sm leading-relaxed text-text-secondary", preClassName)}>
        <code>{code}</code>
      </pre>
    </GlassCard>
  );
}

export interface RiskComparisonSectionProps {
  headline: ReactNode;
  body: ReactNode;
  industryTerm: ReactNode;
  sharedProblems: ReactNode[];
  hypercliBenefits: ReactNode[];
  sharedLabel?: ReactNode;
  hypercliLabel?: ReactNode;
  className?: string;
}

export function RiskComparisonSection({
  headline,
  body,
  industryTerm,
  sharedProblems,
  hypercliBenefits,
  sharedLabel = "Shared AI APIs",
  hypercliLabel = "HyperCLI",
  className,
}: RiskComparisonSectionProps) {
  return (
    <section className={cn("border-t border-border-medium/30 px-4 py-24 sm:px-6 lg:px-8", className)}>
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-12"
        >
          <h2 className="mb-6 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {headline}
          </h2>
          <p className="max-w-3xl text-lg leading-relaxed text-text-secondary">
            {body}
          </p>
        </motion.div>

        <div className="grid gap-8 md:grid-cols-2">
          <motion.div
            className="rounded-lg border border-error/25 bg-error/5 p-6"
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-error">
              {sharedLabel}
            </p>
            <p className="mb-6 text-sm text-text-secondary">
              Your {industryTerm} on shared infrastructure
            </p>
            <ul className="space-y-3">
              {sharedProblems.map((problem, index) => (
                <motion.li
                  key={index}
                  className="flex items-start gap-3"
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: 0.2 + index * 0.05 }}
                >
                  <X className="mt-0.5 h-5 w-5 shrink-0 text-error" />
                  <span className="text-text-secondary">{problem}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            className="rounded-lg border border-primary/20 bg-primary/5 p-6"
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <p className="mb-1 text-sm font-semibold uppercase tracking-wider text-primary">
              {hypercliLabel}
            </p>
            <p className="mb-6 text-sm text-text-secondary">
              Your {industryTerm} on dedicated infrastructure
            </p>
            <ul className="space-y-3">
              {hypercliBenefits.map((benefit, index) => (
                <motion.li
                  key={index}
                  className="flex items-start gap-3"
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: 0.2 + index * 0.05 }}
                >
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <span className="text-foreground">{benefit}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export interface ComparisonTableRow {
  capability: ReactNode;
  values: ReactNode[];
}

export interface ComparisonTableProps {
  headline: ReactNode;
  columns: ReactNode[];
  rows: ComparisonTableRow[];
  className?: string;
}

function ComparisonCellValue({ value, featured }: { value: ReactNode; featured: boolean }) {
  const normalizedValue = typeof value === "string" ? value.toLowerCase() : null;

  if (normalizedValue === "yes") {
    return (
      <span role="img" aria-label="Yes" className="inline-flex items-center">
        <Check aria-hidden="true" className="h-5 w-5 text-primary" />
      </span>
    );
  }

  if (normalizedValue === "no") {
    return (
      <span role="img" aria-label="No" className="inline-flex items-center">
        <X aria-hidden="true" className="h-5 w-5 text-error" />
      </span>
    );
  }

  return <span className={featured ? "text-foreground" : "text-text-secondary"}>{value}</span>;
}

function ComparisonColumnValue({
  label,
  value,
  featured,
}: {
  label: ReactNode;
  value: ReactNode;
  featured: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        featured ? "border-primary/30 bg-primary/5" : "border-border-medium/30 bg-surface-low/80",
      )}
    >
      <p className={cn("mb-2 text-[11px] font-semibold uppercase tracking-[0.18em]", featured ? "text-primary" : "text-text-secondary")}>
        {label}
      </p>
      <div className="text-sm leading-relaxed">
        <ComparisonCellValue value={value} featured={featured} />
      </div>
    </div>
  );
}

export function ComparisonTable({ headline, columns, rows, className }: ComparisonTableProps) {
  const comparisonColumns = columns.slice(1);

  return (
    <section className={cn("border-t border-border-medium/30 px-4 py-24 sm:px-6 lg:px-8", className)}>
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="mb-12 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {headline}
          </h2>
        </motion.div>

        <div className="space-y-4 md:hidden">
          {rows.map((row, rowIndex) => (
            <motion.section
              key={rowIndex}
              className="rounded-2xl border border-border-medium/30 bg-surface/70 p-5"
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: rowIndex * 0.04 }}
            >
              <h3 className="mb-4 text-base font-semibold text-foreground">
                {row.capability}
              </h3>
              <div className="space-y-3">
                {comparisonColumns.map((column, columnIndex) => (
                  <ComparisonColumnValue
                    key={columnIndex}
                    label={column}
                    value={row.values[columnIndex]}
                    featured={columnIndex === comparisonColumns.length - 1}
                  />
                ))}
              </div>
            </motion.section>
          ))}
        </div>

        <motion.div
          className="overflow-x-auto max-md:hidden"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-medium/30">
                {columns.map((column, columnIndex) => (
                  <th
                    key={columnIndex}
                    scope="col"
                    className={cn(
                      "pb-4 pr-6 text-sm font-semibold uppercase tracking-wider",
                      columnIndex === columns.length - 1 ? "text-primary" : "text-text-secondary",
                    )}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <motion.tr
                  key={rowIndex}
                  className="border-b border-border-medium/20"
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.3, delay: rowIndex * 0.05 }}
                >
                  <th scope="row" className="py-4 pr-6 font-medium text-foreground">
                    {row.capability}
                  </th>
                  {row.values.map((value, columnIndex) => (
                    <td key={columnIndex} className="py-4 pr-6">
                      <ComparisonCellValue
                        value={value}
                        featured={columnIndex === row.values.length - 1}
                      />
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </section>
  );
}
