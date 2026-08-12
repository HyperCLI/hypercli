import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "../../utils/cn";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export interface CatalogHeaderProps {
  title: React.ReactNode;
  description: React.ReactNode;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  searchValue: string;
  searchLabel: string;
  searchPlaceholder: string;
  onSearchValueChange: (value: string) => void;
  className?: string;
}

export function CatalogHeader({
  title,
  description,
  actions,
  filters,
  searchValue,
  searchLabel,
  searchPlaceholder,
  onSearchValueChange,
  className,
}: CatalogHeaderProps) {
  return (
    <header data-slot="catalog-header" className={cn("border-b border-border bg-background px-4 py-5 sm:px-5", className)}>
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-tight text-foreground">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-snug text-text-muted">{description}</p>
          </div>
          {actions ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div> : null}
        </div>

        <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {filters ? <div className="min-w-0 md:flex-1">{filters}</div> : null}
          <label className="relative block w-full md:w-[min(42vw,30rem)] md:shrink-0">
            <span className="sr-only">{searchLabel}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              type="text"
              value={searchValue}
              onChange={(event) => onSearchValueChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-10 rounded-xl border-border bg-input-background pl-10 pr-4 text-sm text-foreground placeholder:text-text-muted dark:bg-input-background"
            />
          </label>
        </div>
      </div>
    </header>
  );
}

export interface CatalogFilterGroupProps extends React.ComponentProps<"div"> {
  label: string;
}

export function CatalogFilterGroup({ label, className, children, ...props }: CatalogFilterGroupProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface CatalogFilterButtonProps extends Omit<React.ComponentProps<typeof Button>, "aria-pressed" | "variant" | "size"> {
  pressed: boolean;
}

export function CatalogFilterButton({ pressed, className, ...props }: CatalogFilterButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={pressed}
      className={cn(
        "h-9 shrink-0 rounded-full border-border bg-transparent px-4 text-[13px] font-medium text-foreground hover:border-border-strong hover:bg-surface-high hover:text-foreground dark:bg-transparent dark:hover:bg-surface-high",
        pressed && "border-foreground bg-foreground text-background hover:border-foreground hover:bg-foreground/90 hover:text-background dark:border-foreground dark:bg-foreground dark:text-background dark:hover:border-foreground dark:hover:bg-foreground/90 dark:hover:text-background",
        className,
      )}
      {...props}
    />
  );
}
