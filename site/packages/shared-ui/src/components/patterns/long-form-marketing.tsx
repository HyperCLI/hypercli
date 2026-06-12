"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "../ui/utils";
import { CTAButtonGroup, type CTAAction } from "./marketing";
import { SurfaceCard } from "./surface-card";

type MaxWidth = "5xl" | "6xl";
type SectionPadding = "default" | "large" | "cta";

const maxWidthClasses: Record<MaxWidth, string> = {
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
};

const paddingClasses: Record<SectionPadding, string> = {
  default: "py-20",
  large: "py-32",
  cta: "pb-32 pt-24",
};

const gridColumnClasses = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
} as const;

export interface MarketingPageHeroProps {
  title: ReactNode;
  description: ReactNode;
  secondaryDescription?: ReactNode;
  actions?: CTAAction[];
  align?: "left" | "center";
  maxWidth?: MaxWidth;
  className?: string;
}

export function MarketingPageHero({
  title,
  description,
  secondaryDescription,
  actions,
  align = "left",
  maxWidth = "5xl",
  className,
}: MarketingPageHeroProps) {
  return (
    <section className={cn("relative bg-background px-4 pb-24 pt-32 sm:px-6 lg:px-8", className)}>
      <motion.div
        className={cn("mx-auto", maxWidthClasses[maxWidth], align === "center" && "text-center")}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1 className={cn("mb-8 max-w-4xl text-6xl leading-[1.1] tracking-tight text-foreground sm:text-7xl lg:text-8xl", align === "center" && "mx-auto")}>
          {title}
        </h1>
        <p className={cn("mb-6 max-w-2xl text-2xl leading-relaxed text-text-secondary", align === "center" && "mx-auto")}>
          {description}
        </p>
        {secondaryDescription && (
          <p className={cn("max-w-2xl text-xl leading-relaxed text-text-secondary", align === "center" && "mx-auto")}>
            {secondaryDescription}
          </p>
        )}
        {actions && <CTAButtonGroup actions={actions} align={align} className="mt-10" />}
      </motion.div>
    </section>
  );
}

export interface NarrativeSplitSectionProps {
  title: ReactNode;
  left: ReactNode;
  right: ReactNode;
  footer?: ReactNode;
  maxWidth?: MaxWidth;
  padding?: SectionPadding;
  className?: string;
}

export function NarrativeSplitSection({
  title,
  left,
  right,
  footer,
  maxWidth = "6xl",
  padding = "default",
  className,
}: NarrativeSplitSectionProps) {
  return (
    <section className={cn("border-t border-border-medium/30 bg-background px-4 sm:px-6 lg:px-8", paddingClasses[padding], className)}>
      <div className={cn("mx-auto", maxWidthClasses[maxWidth])}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="mb-12 text-5xl tracking-tight text-foreground">{title}</h2>
        </motion.div>

        <div className="grid items-start gap-x-16 gap-y-8 md:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            {left}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {right}
          </motion.div>
        </div>

        {footer && (
          <motion.div
            className="mt-10"
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            {footer}
          </motion.div>
        )}
      </div>
    </section>
  );
}

export interface FeatureGridSectionProps {
  title: ReactNode;
  statement?: ReactNode;
  intro?: ReactNode;
  beforeGrid?: ReactNode;
  items: ReactNode[];
  itemVariant?: "text" | "custom";
  columns?: keyof typeof gridColumnClasses;
  checked?: boolean;
  footer?: ReactNode;
  maxWidth?: MaxWidth;
  padding?: SectionPadding;
  className?: string;
}

export function FeatureGridSection({
  title,
  statement,
  intro,
  beforeGrid,
  items,
  itemVariant = "text",
  columns = 3,
  checked = false,
  footer,
  maxWidth = "6xl",
  padding = "default",
  className,
}: FeatureGridSectionProps) {
  return (
    <section className={cn("border-t border-border-medium/30 bg-background px-4 sm:px-6 lg:px-8", paddingClasses[padding], className)}>
      <div className={cn("mx-auto", maxWidthClasses[maxWidth])}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="mb-12 text-5xl tracking-tight text-foreground">{title}</h2>
          {statement && <p className="mb-10 text-3xl leading-tight text-foreground">{statement}</p>}
          {intro && <p className="mb-8 text-lg leading-relaxed text-text-secondary">{intro}</p>}
        </motion.div>

        {beforeGrid && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            {beforeGrid}
          </motion.div>
        )}

        <div className={cn("mb-10 grid gap-6", gridColumnClasses[columns])}>
          {items.map((item, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: checked ? index * 0.1 : index * 0.05 }}
            >
              <SurfaceCard className="h-full rounded-lg border-border-medium/50 bg-transparent p-6">
                {itemVariant === "custom" ? (
                  item
                ) : (
                  <p className={cn("leading-relaxed", checked ? "text-xl text-foreground" : "text-text-secondary")}>
                    {checked && <Check aria-hidden="true" className="mr-2 inline h-5 w-5 text-primary" />}
                    {item}
                  </p>
                )}
              </SurfaceCard>
            </motion.div>
          ))}
        </div>

        {footer && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            {footer}
          </motion.div>
        )}
      </div>
    </section>
  );
}

export interface FinalCtaSectionProps {
  title: ReactNode;
  actions: CTAAction[];
  maxWidth?: MaxWidth;
  className?: string;
}

export function FinalCtaSection({ title, actions, maxWidth = "5xl", className }: FinalCtaSectionProps) {
  return (
    <section className={cn("border-t border-border-medium/30 bg-background px-4 pb-32 pt-24 sm:px-6 lg:px-8", className)}>
      <div className={cn("mx-auto", maxWidthClasses[maxWidth])}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="mb-12 max-w-3xl text-6xl leading-tight tracking-tight text-foreground">
            {title}
          </h2>
          <CTAButtonGroup actions={actions} align="left" />
        </motion.div>
      </div>
    </section>
  );
}

export function LongFormText({
  children,
  variant = "body",
  className,
}: {
  children: ReactNode;
  variant?: "statement" | "substatement" | "body" | "emphasis" | "mutedEmphasis";
  className?: string;
}) {
  return (
    <p
      className={cn(
        variant === "statement" && "text-3xl leading-tight text-foreground",
        variant === "substatement" && "text-2xl leading-tight text-text-secondary",
        variant === "body" && "text-lg leading-relaxed text-text-secondary",
        variant === "emphasis" && "text-xl leading-relaxed text-foreground",
        variant === "mutedEmphasis" && "text-xl leading-relaxed text-secondary-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}
