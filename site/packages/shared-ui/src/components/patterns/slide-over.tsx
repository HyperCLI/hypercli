"use client";

import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";

export interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}

export function SlideOver({ open, onClose, title, description, children }: SlideOverProps) {
  return (
    <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto border-l border-border bg-background sm:max-w-[540px]">
        <SheetHeader className="border-b border-border px-6 pb-5">
          <SheetTitle className="text-foreground">{title}</SheetTitle>
          {description && <SheetDescription className="text-text-secondary">{description}</SheetDescription>}
        </SheetHeader>
        <div className="px-6 pb-8 pt-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
