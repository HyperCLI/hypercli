"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "./utils";

const TooltipProviderContext = React.createContext(false);

function TooltipProvider({
  delayDuration = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipProviderContext.Provider value>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        {...props}
      >
        {children}
      </TooltipPrimitive.Provider>
    </TooltipProviderContext.Provider>
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const hasProvider = React.useContext(TooltipProviderContext);
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />;

  return hasProvider ? root : (
    <TooltipProvider>
      {root}
    </TooltipProvider>
  );
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "bg-[var(--selection-accent,var(--primary))] text-[var(--selection-accent-foreground,var(--primary-foreground))] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-[var(--selection-accent,var(--primary))] fill-[var(--selection-accent,var(--primary))] z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

function TooltipHint({
  label,
  children,
  disabled = false,
  side = "top",
  align = "center",
  sideOffset = 6,
  className,
  triggerClassName,
}: {
  label: React.ReactNode;
  children: React.ReactElement;
  disabled?: boolean;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
  align?: React.ComponentProps<typeof TooltipPrimitive.Content>["align"];
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

export { Tooltip, TooltipTrigger, TooltipContent, TooltipHint, TooltipProvider };
