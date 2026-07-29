"use client";

import type { ComponentType, ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";
import { cn } from "../ui/utils";

export interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function SlideOver({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  children,
  footer,
  className,
  bodyClassName,
}: SlideOverProps) {
  return (
    <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
      <SheetContent
        side="right"
        className={cn("w-full gap-0 overflow-hidden border-l border-border bg-background sm:max-w-[540px]", className)}
      >
        <SheetHeader className="min-h-[76px] flex-row items-center gap-3 border-b border-border px-4 py-4 pr-14 text-left">
          {Icon ? (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-high text-foreground">
              <Icon className="size-5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <SheetTitle className="truncate text-xl font-medium text-foreground">{title}</SheetTitle>
            <SheetDescription className={description ? "mt-1 text-text-secondary" : "sr-only"}>
              {description ?? `${title} panel`}
            </SheetDescription>
          </div>
        </SheetHeader>
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-5", bodyClassName)}>{children}</div>
        {footer ? (
          <SheetFooter className="flex-row justify-end gap-3 border-t border-border bg-surface-low px-4 py-4">
            {footer}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
