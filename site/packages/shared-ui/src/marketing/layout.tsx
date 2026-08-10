import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../components/ui/utils";

export type MarketingHeaderClearance = "none" | "primary" | "section-nav";
export type MarketingBandSpacing = "none" | "tight" | "compact" | "standard";
export type MarketingContainerWidth = "3xl" | "4xl" | "5xl" | "6xl" | "7xl";

const headerClearanceClasses: Record<MarketingHeaderClearance, string> = {
  none: "marketing-header-clearance-none",
  primary: "marketing-header-clearance-primary",
  "section-nav": "marketing-header-clearance-section-nav",
};

const bandSpacingClasses: Record<MarketingBandSpacing, string> = {
  none: "",
  tight: "px-6 py-6",
  compact: "px-6 py-12",
  standard: "px-6 py-24",
};

const containerWidthClasses: Record<MarketingContainerWidth, string> = {
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
  "6xl": "max-w-6xl",
  "7xl": "max-w-7xl",
};

export interface MarketingShellProps extends ComponentPropsWithoutRef<"div"> {
  header: ReactNode;
  footer?: ReactNode;
  headerClearance?: MarketingHeaderClearance;
  mainId?: string;
  mainClassName?: string;
  skipLinkLabel?: ReactNode;
}

export function MarketingShell({
  header,
  footer,
  headerClearance = "none",
  mainId = "main-content",
  mainClassName,
  skipLinkLabel = "Skip to main content",
  className,
  children,
  ...props
}: MarketingShellProps) {
  return (
    <div
      {...props}
      data-slot="marketing-shell"
      className={cn("min-h-screen overflow-x-hidden bg-background", className)}
    >
      <a
        href={`#${mainId}`}
        data-slot="marketing-skip-link"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-background"
      >
        {skipLinkLabel}
      </a>
      {header}
      <main
        id={mainId}
        tabIndex={-1}
        data-slot="marketing-main"
        className={cn(headerClearanceClasses[headerClearance], mainClassName)}
      >
        {children}
      </main>
      {footer}
    </div>
  );
}

export interface MarketingBandProps extends ComponentPropsWithoutRef<"section"> {
  spacing?: MarketingBandSpacing;
  bordered?: boolean;
}

export function MarketingBand({
  spacing = "standard",
  bordered = false,
  className,
  ...props
}: MarketingBandProps) {
  return (
    <section
      {...props}
      data-slot="marketing-band"
      className={cn(
        bandSpacingClasses[spacing],
        bordered && "border-t border-border",
        className,
      )}
    />
  );
}

export interface MarketingContainerProps extends ComponentPropsWithoutRef<"div"> {
  width?: MarketingContainerWidth;
}

export function MarketingContainer({
  width = "6xl",
  className,
  ...props
}: MarketingContainerProps) {
  return (
    <div
      {...props}
      data-slot="marketing-container"
      className={cn("mx-auto w-full", containerWidthClasses[width], className)}
    />
  );
}
