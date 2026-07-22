"use client";

import type { ComponentProps, CSSProperties, ReactElement, ReactNode } from "react";
import {
  Tooltip as SharedTooltip,
  TooltipContent as SharedTooltipContent,
  TooltipTrigger,
} from "@hypercli/shared-ui";

export const CLAW_TOOLTIP_DELAY_MS = 1500;

const tooltipContrastStyle = {
  "--foreground": "var(--selection-accent-foreground)",
  "--text-secondary": "color-mix(in srgb, var(--selection-accent-foreground) 82%, transparent)",
  "--text-muted": "color-mix(in srgb, var(--selection-accent-foreground) 68%, transparent)",
  "--background": "color-mix(in srgb, var(--selection-accent-foreground) 8%, transparent)",
  "--surface-low": "color-mix(in srgb, var(--selection-accent-foreground) 12%, transparent)",
  "--surface-high": "color-mix(in srgb, var(--selection-accent-foreground) 18%, transparent)",
  "--border": "color-mix(in srgb, var(--selection-accent-foreground) 24%, transparent)",
  "--border-strong": "color-mix(in srgb, var(--selection-accent-foreground) 36%, transparent)",
  "--primary": "var(--selection-accent-foreground)",
  "--chart-2": "color-mix(in srgb, var(--selection-accent-foreground) 68%, transparent)",
} as CSSProperties;

export function Tooltip(props: ComponentProps<typeof SharedTooltip>) {
  return <SharedTooltip {...props} delayDuration={CLAW_TOOLTIP_DELAY_MS} />;
}

export function TooltipContent({
  className,
  style,
  ...props
}: ComponentProps<typeof SharedTooltipContent>) {
  return (
    <SharedTooltipContent
      {...props}
      className={className}
      style={{
        ...tooltipContrastStyle,
        backgroundColor: "var(--selection-accent)",
        color: "var(--selection-accent-foreground)",
        ...style,
      }}
    />
  );
}

export function TooltipHint({
  label,
  children,
  disabled = false,
  side = "top",
  align = "center",
  sideOffset = 6,
  className,
  triggerClassName,
}: {
  label: ReactNode;
  children: ReactElement;
  disabled?: boolean;
  side?: ComponentProps<typeof SharedTooltipContent>["side"];
  align?: ComponentProps<typeof SharedTooltipContent>["align"];
  sideOffset?: number;
  className?: string;
  triggerClassName?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? <span className={`inline-flex ${triggerClassName ?? ""}`} tabIndex={0}>{children}</span> : children}
      </TooltipTrigger>
      <TooltipContent side={side} align={align} sideOffset={sideOffset} className={className}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export { TooltipTrigger };
