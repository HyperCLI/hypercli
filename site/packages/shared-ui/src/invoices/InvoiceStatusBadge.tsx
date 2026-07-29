import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../utils/cn";
import { getBadgeClass } from "../utils/badges";

export interface InvoiceStatusBadgeProps extends ComponentPropsWithoutRef<"span"> {
  status: string;
}

export function InvoiceStatusBadge({ status, className, children, ...props }: InvoiceStatusBadgeProps) {
  const normalizedStatus = status.toLowerCase();
  const statusClass = normalizedStatus === "completed" || normalizedStatus === "succeeded"
    ? "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]"
    : getBadgeClass(status);

  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded border px-2 py-1 text-xs font-semibold leading-5",
        statusClass,
        className,
      )}
    >
      {children ?? status.toLowerCase()}
    </span>
  );
}
