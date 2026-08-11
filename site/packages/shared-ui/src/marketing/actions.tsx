import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../components/ui/utils";

export type MarketingCtaVariant = "primary" | "secondary" | "terminal-secondary";
export type MarketingCtaSize = "hero" | "final";

const ctaVariantClasses: Record<MarketingCtaVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  "terminal-secondary":
    "border border-terminal-border text-terminal-foreground transition-colors hover:border-terminal-live hover:text-terminal-live",
};

const ctaSizeClasses: Record<MarketingCtaSize, string> = {
  hero: "px-8 py-3.5",
  final: "px-8 py-4",
};

export function marketingCtaClassName({
  variant = "primary",
  size = "hero",
  className,
}: {
  variant?: MarketingCtaVariant;
  size?: MarketingCtaSize;
  className?: string;
} = {}): string {
  return cn(
    "inline-block rounded-full text-base font-semibold",
    ctaVariantClasses[variant],
    ctaSizeClasses[size],
    className,
  );
}

export interface MarketingActionGroupProps extends ComponentPropsWithoutRef<"div"> {
  align?: "start" | "center";
}

export function MarketingActionGroup({
  align = "center",
  className,
  ...props
}: MarketingActionGroupProps) {
  return (
    <div
      {...props}
      data-slot="marketing-action-group"
      className={cn(
        "flex flex-wrap gap-3.5",
        align === "center" ? "justify-center" : "justify-start",
        className,
      )}
    />
  );
}
