"use client";

import * as React from "react";
import type { ComponentType, ReactNode } from "react";
import { ChevronDown, Loader2, RotateCcw } from "lucide-react";

import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { cn } from "../ui/utils";

export interface RecoveryAction {
  label: ReactNode;
  onAction: () => void;
  ariaLabel?: string;
  icon?: ComponentType<{ className?: string }>;
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: ReactNode;
}

export interface RecoveryDetailsProps {
  label?: ReactNode;
  children?: ReactNode;
  technicalDetails?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function RecoveryDetails({
  label = "What happened",
  children,
  technicalDetails,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
}: RecoveryDetailsProps) {
  const detailId = React.useId();

  if (!children && !technicalDetails) return null;

  return (
    <Collapsible
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
      className={cn("group/recovery-details overflow-hidden rounded-xl bg-surface-high/80", className)}
    >
      <CollapsibleTrigger
        aria-controls={detailId}
        className="flex min-h-12 w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm font-semibold text-foreground outline-none transition-colors hover:bg-surface-high focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)] focus-visible:ring-inset"
      >
        <span>{label}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-text-secondary transition-transform duration-200 group-data-[state=open]/recovery-details:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent id={detailId}>
        <div className="border-t border-border px-4 py-4 text-sm leading-6 text-text-secondary">
          {children ? <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{children}</div> : null}
          {technicalDetails ? (
            <pre className={cn(
              "max-h-52 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background/55 px-3 py-2 font-mono text-xs leading-5 text-text-muted [overflow-wrap:anywhere]",
              children && "mt-3",
            )}>
              {technicalDetails}
            </pre>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export interface RecoveryStateProps extends Omit<React.ComponentProps<"section">, "title"> {
  title: ReactNode;
  description: ReactNode;
  presentation?: "compact" | "panel" | "empty";
  icon?: ComponentType<{ className?: string }>;
  details?: ReactNode;
  technicalDetails?: string;
  detailsLabel?: ReactNode;
  primaryAction?: RecoveryAction;
  secondaryAction?: RecoveryAction;
  onDismiss?: () => void;
  dismissLabel?: string;
  announcement?: "off" | "polite" | "assertive";
  headingLevel?: 2 | 3 | 4;
}

function RecoveryActionButton({
  action,
  priority,
  className,
}: {
  action: RecoveryAction;
  priority: "primary" | "secondary";
  className?: string;
}) {
  const Icon = action.pending ? Loader2 : action.icon;
  const label = action.pending && action.pendingLabel ? action.pendingLabel : action.label;

  return (
    <Button
      type="button"
      variant={priority === "primary" ? "default" : "outline"}
      onClick={action.onAction}
      disabled={action.disabled || action.pending}
      aria-label={action.ariaLabel}
      aria-busy={action.pending || undefined}
      className={cn("min-h-10 rounded-xl px-4", className)}
    >
      {Icon ? <Icon aria-hidden="true" className={cn("size-4", action.pending && "animate-spin motion-reduce:animate-none")} /> : null}
      {label}
    </Button>
  );
}

function RecoveryContent({
  title,
  description,
  presentation,
  icon: Icon,
  details,
  technicalDetails,
  detailsLabel,
  primaryAction,
  secondaryAction,
  headingLevel,
}: Pick<
  RecoveryStateProps,
  | "title"
  | "description"
  | "presentation"
  | "icon"
  | "details"
  | "technicalDetails"
  | "detailsLabel"
  | "primaryAction"
  | "secondaryAction"
  | "headingLevel"
>) {
  const Heading = `h${headingLevel ?? (presentation === "empty" ? 2 : 3)}` as "h2" | "h3" | "h4";
  const compact = presentation === "compact";

  return (
    <>
      <div className={cn("flex min-w-0", compact ? "items-start gap-3" : "items-start gap-4")}>
        <span
          aria-hidden="true"
          className={cn(
            "flex shrink-0 items-center justify-center border border-border bg-surface-high text-text-secondary",
            compact ? "size-9 rounded-xl" : "size-12 rounded-2xl",
          )}
        >
          <Icon className={compact ? "size-4" : "size-5"} />
        </span>
        <div className="min-w-0 flex-1">
          <Heading className={cn(
            "text-balance font-semibold tracking-[-0.02em] text-foreground",
            compact ? "text-sm leading-5" : "text-lg leading-6 sm:text-xl",
          )}>
            {title}
          </Heading>
          <div className={cn(
            "max-w-[68ch] text-text-secondary",
            compact ? "mt-1 text-xs leading-5" : "mt-2 text-sm leading-6",
          )}>
            {description}
          </div>
        </div>
      </div>

      <RecoveryDetails
        label={detailsLabel}
        technicalDetails={technicalDetails}
        className={compact ? "mt-3" : "mt-5"}
      >
        {details}
      </RecoveryDetails>

      {primaryAction || secondaryAction ? (
        <div className={cn(
          "flex gap-2",
          compact ? "mt-3 flex-wrap" : "mt-5 flex-col-reverse sm:flex-row sm:justify-end",
        )}>
          {secondaryAction ? <RecoveryActionButton action={secondaryAction} priority="secondary" className={compact ? "min-h-8 rounded-lg px-3 text-xs" : undefined} /> : null}
          {primaryAction ? <RecoveryActionButton action={primaryAction} priority="primary" className={compact ? "min-h-8 rounded-lg px-3 text-xs" : undefined} /> : null}
        </div>
      ) : null}
    </>
  );
}

export function RecoveryState({
  title,
  description,
  presentation = "panel",
  icon: Icon = RotateCcw,
  details,
  technicalDetails,
  detailsLabel,
  primaryAction,
  secondaryAction,
  onDismiss,
  dismissLabel = "Dismiss",
  announcement = "polite",
  headingLevel,
  className,
  ...props
}: RecoveryStateProps) {
  const role = announcement === "assertive" ? "alert" : announcement === "polite" ? "status" : undefined;
  const live = announcement === "assertive" ? "assertive" : announcement === "polite" ? "polite" : undefined;

  return (
    <section
      data-slot="recovery-state"
      data-presentation={presentation}
      role={role}
      aria-live={live}
      aria-atomic={role ? "true" : undefined}
      className={cn(
        "relative text-left text-foreground",
        presentation === "compact" && "rounded-xl border border-border bg-surface-low/65 p-3",
        presentation === "panel" && "w-full rounded-2xl border border-border bg-popover p-5 shadow-[0_18px_54px_rgb(0_0_0_/_0.18)] sm:p-6",
        presentation === "empty" && "mx-auto flex min-h-72 w-full max-w-2xl flex-col justify-center px-6 py-12 sm:px-10",
        className,
      )}
      {...props}
    >
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="absolute right-3 top-3 rounded-lg px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-high hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
        >
          {dismissLabel}
        </button>
      ) : null}
      <RecoveryContent
        title={title}
        description={description}
        presentation={presentation}
        icon={Icon}
        details={details}
        technicalDetails={technicalDetails}
        detailsLabel={detailsLabel}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
        headingLevel={headingLevel}
      />
    </section>
  );
}

export interface RecoveryDialogProps extends Omit<RecoveryStateProps, "presentation" | "onDismiss" | "announcement"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeLabel?: string;
}

export function RecoveryDialog({
  open,
  onOpenChange,
  closeLabel = "Close",
  title,
  description,
  icon: Icon = RotateCcw,
  details,
  technicalDetails,
  detailsLabel,
  primaryAction,
  secondaryAction,
  headingLevel,
  className,
}: RecoveryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={closeLabel}
        overlayClassName="bg-black/60 backdrop-blur-sm"
        className={cn("max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden rounded-3xl border-border bg-background p-0 shadow-2xl sm:max-w-xl", className)}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto px-5 py-6 sm:px-7 sm:py-7">
          <RecoveryContent
            title={title}
            description={description}
            presentation="panel"
            icon={Icon}
            details={details}
            technicalDetails={technicalDetails}
            detailsLabel={detailsLabel}
            headingLevel={headingLevel}
          />
        </div>
        {primaryAction || secondaryAction ? (
          <DialogFooter className="flex-row justify-end gap-2 border-t border-border bg-surface-low/35 px-5 py-4 sm:px-7">
            {secondaryAction ? <RecoveryActionButton action={secondaryAction} priority="secondary" className="flex-1 sm:flex-none" /> : null}
            {primaryAction ? <RecoveryActionButton action={primaryAction} priority="primary" className="flex-1 sm:flex-none" /> : null}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
