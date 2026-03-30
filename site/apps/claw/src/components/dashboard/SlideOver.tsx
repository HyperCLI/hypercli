"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@hypercli/shared-ui";

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function SlideOver({ open, onClose, title, description, children }: SlideOverProps) {
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[540px] bg-[var(--background)] border-l border-[var(--border)] overflow-y-auto"
      >
        <SheetHeader className="px-6 pb-5 border-b border-[var(--border)]">
          <SheetTitle className="text-foreground">{title}</SheetTitle>
          {description && (
            <SheetDescription className="text-text-secondary">{description}</SheetDescription>
          )}
        </SheetHeader>
        <div className="pt-6 px-6 pb-8">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
