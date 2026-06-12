import type { ReactNode } from "react";
import { cn } from "../ui/utils";

export function LegalPageShell({
  header,
  footer,
  title,
  lastUpdated,
  children,
  contentClassName,
}: {
  header: ReactNode;
  footer: ReactNode;
  title: ReactNode;
  lastUpdated: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="min-h-screen bg-background">
      {header}
      <main className="pb-16 pt-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <h1 className="mb-4 text-4xl font-bold text-foreground">{title}</h1>
          <p className="mb-8 text-text-muted">Last Updated: {lastUpdated}</p>
          <div className={cn("prose prose-invert max-w-none space-y-8", contentClassName)}>{children}</div>
        </div>
      </main>
      {footer}
    </div>
  );
}
