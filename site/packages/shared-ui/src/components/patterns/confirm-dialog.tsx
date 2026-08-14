"use client";

import { AlertTriangle, Check } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) onCancel();
      }}
    >
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden rounded-3xl border-border bg-background p-0 shadow-2xl sm:max-w-lg">
        <div className="overflow-y-auto px-5 py-6 sm:px-7 sm:py-7">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-surface-high text-text-secondary"
            >
              {danger ? <AlertTriangle className="size-5" /> : <Check className="size-5" />}
            </span>
            <AlertDialogHeader className="min-w-0 flex-1 text-left">
              <AlertDialogTitle className="text-balance text-lg font-semibold leading-6 tracking-[-0.02em] text-foreground sm:text-xl">
                {title}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-1 text-sm leading-6 text-text-secondary">
                {message}
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>
        </div>
        <AlertDialogFooter className="flex-row justify-end gap-2 border-t border-border bg-surface-low/35 px-5 py-4 sm:px-7">
          <AlertDialogCancel disabled={loading} className="min-h-10 flex-1 rounded-xl sm:flex-none">
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            aria-busy={loading || undefined}
            className="min-h-10 flex-1 rounded-xl px-4 sm:flex-none"
          >
            {loading ? "Working..." : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
