import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../components/ui/utils";
import {
  MarketingContainer,
  type MarketingContainerWidth,
} from "./layout";

export type AuroraHeroBackdropVariant = "wide" | "standard" | "balanced" | "swapped";

const heroBackdropClasses: Record<AuroraHeroBackdropVariant, [string, string, string]> = {
  wide: [
    "-top-[10%] left-[4%] h-[560px] w-[560px] bg-primary/15",
    "-top-[2%] right-[6%] h-[460px] w-[460px] bg-success/15",
    "-bottom-[16%] right-[26%] h-[420px] w-[420px] bg-chart-3/15",
  ],
  standard: [
    "-top-[10%] left-[8%] h-[440px] w-[440px] bg-primary/15",
    "-top-[2%] right-[9%] h-[360px] w-[360px] bg-success/15",
    "-bottom-[18%] left-[16%] h-[380px] w-[380px] bg-chart-3/15",
  ],
  balanced: [
    "-top-[6%] left-[8%] h-[440px] w-[440px] bg-primary/15",
    "top-[2%] right-[9%] h-[360px] w-[360px] bg-success/15",
    "-bottom-[18%] left-[16%] h-[380px] w-[380px] bg-chart-3/15",
  ],
  swapped: [
    "-top-[6%] left-[8%] h-[440px] w-[440px] bg-primary/15",
    "-top-[2%] right-[9%] h-[360px] w-[360px] bg-chart-3/15",
    "-bottom-[18%] left-[16%] h-[380px] w-[380px] bg-success/15",
  ],
};

export interface AuroraHeroBackdropProps extends ComponentPropsWithoutRef<"div"> {
  variant?: AuroraHeroBackdropVariant;
}

export function AuroraHeroBackdrop({
  variant = "standard",
  className,
  ...props
}: AuroraHeroBackdropProps) {
  return (
    <div
      {...props}
      aria-hidden="true"
      data-slot="aurora-hero-backdrop"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      {heroBackdropClasses[variant].map((orbClassName) => (
        <div
          key={orbClassName}
          className={cn("absolute rounded-full blur-[110px]", orbClassName)}
        />
      ))}
    </div>
  );
}

export interface AuroraHeroProps extends ComponentPropsWithoutRef<"section"> {
  width?: MarketingContainerWidth;
  backdropVariant?: AuroraHeroBackdropVariant;
  backdrop?: ReactNode | false;
  containerClassName?: string;
}

export function AuroraHero({
  width = "5xl",
  backdropVariant = "standard",
  backdrop,
  containerClassName,
  className,
  children,
  ...props
}: AuroraHeroProps) {
  return (
    <section
      {...props}
      data-slot="aurora-hero"
      className={cn("aurora-hero relative px-6 pb-18 text-center", className)}
    >
      {backdrop === false ? null : backdrop ?? <AuroraHeroBackdrop variant={backdropVariant} />}
      <MarketingContainer width={width} className={cn("relative", containerClassName)}>
        {children}
      </MarketingContainer>
    </section>
  );
}

export function MarketingEyebrow({
  className,
  ...props
}: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      {...props}
      data-slot="marketing-eyebrow"
      className={cn(
        "mb-4 text-sm font-semibold uppercase tracking-[0.13em] text-primary",
        className,
      )}
    />
  );
}

export function AuroraHeroHeading({
  className,
  ...props
}: ComponentPropsWithoutRef<"h1">) {
  return (
    <h1
      {...props}
      data-slot="aurora-hero-heading"
      className={cn(
        "mb-6 text-5xl font-extrabold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl",
        className,
      )}
    />
  );
}

export function AuroraHeroLead({
  className,
  ...props
}: ComponentPropsWithoutRef<"p">) {
  return (
    <p
      {...props}
      data-slot="aurora-hero-lead"
      className={cn(
        "mx-auto mb-11 max-w-2xl text-lg leading-relaxed text-text-secondary",
        className,
      )}
    />
  );
}

export interface AuroraGlowFrameProps extends ComponentPropsWithoutRef<"div"> {
  backdropClassName?: string;
}

export function AuroraGlowFrame({
  backdropClassName,
  className,
  children,
  ...props
}: AuroraGlowFrameProps) {
  return (
    <div
      {...props}
      data-slot="aurora-glow-frame"
      className={cn("relative mx-auto max-w-[660px]", className)}
    >
      <div
        aria-hidden="true"
        className={cn(
          "aurora-media-halo pointer-events-none absolute inset-x-[-7%] bottom-[-12%] top-[6%] blur-[34px]",
          backdropClassName,
        )}
      />
      {children}
    </div>
  );
}

export interface AuroraFinalCtaProps
  extends Omit<ComponentPropsWithoutRef<"section">, "title"> {
  heading: ReactNode;
  description?: ReactNode;
  actions: ReactNode;
  highlights?: ReactNode;
  footnote?: ReactNode;
  width?: "4xl" | "5xl" | "6xl";
  panelClassName?: string;
  headingClassName?: string;
  descriptionClassName?: string;
  highlightsClassName?: string;
  footnoteClassName?: string;
}

export function AuroraFinalCta({
  heading,
  description,
  actions,
  highlights,
  footnote,
  width = "5xl",
  panelClassName,
  headingClassName,
  descriptionClassName,
  highlightsClassName,
  footnoteClassName,
  className,
  ...props
}: AuroraFinalCtaProps) {
  return (
    <section
      {...props}
      data-slot="aurora-final-cta"
      className={cn("px-6 pb-18 pt-4", className)}
    >
      <MarketingContainer
        width={width}
        className={cn(
          "relative overflow-hidden rounded-3xl bg-terminal-background px-8 py-20 text-center",
          panelClassName,
        )}
      >
        <div
          aria-hidden="true"
          className="aurora-final-cta-backdrop pointer-events-none absolute inset-0"
        />
        <div className="relative">
          <h2
            className={cn(
              "mb-3.5 text-4xl font-extrabold leading-[1.08] tracking-tight text-terminal-foreground sm:text-5xl",
              headingClassName,
            )}
          >
            {heading}
          </h2>
          {description ? (
            <p
              data-slot="aurora-final-cta-description"
              className={cn("mb-9 text-lg text-terminal-muted", descriptionClassName)}
            >
              {description}
            </p>
          ) : null}
          {actions}
          {highlights ? (
            <div
              className={cn(
                "mt-11 flex flex-wrap justify-center gap-3",
                highlightsClassName,
              )}
            >
              {highlights}
            </div>
          ) : null}
          {footnote ? (
            <p className={cn("mt-7 text-xs text-terminal-muted", footnoteClassName)}>
              {footnote}
            </p>
          ) : null}
        </div>
      </MarketingContainer>
    </section>
  );
}
