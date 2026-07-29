"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Loader2, Ticket } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@hypercli/shared-ui";

interface ActivateCodeModalProps {
  isOpen: boolean;
  processing: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (code: string) => Promise<void>;
}

export function ActivateCodeModal(props: ActivateCodeModalProps) {
  if (!props.isOpen) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !props.processing) props.onClose();
      }}
    >
      <ActivateCodeModalContent {...props} />
    </Dialog>
  );
}

function ActivateCodeModalContent({
  processing,
  error,
  onSubmit,
}: Omit<ActivateCodeModalProps, "isOpen">) {
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const submittingRef = useRef(false);
  const [code, setCode] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (processing || submittingRef.current) return;

    submittingRef.current = true;
    try {
      await onSubmit(code);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <DialogContent
      closeLabel="Close activation dialog"
      overlayClassName="z-[99] bg-black/60 backdrop-blur-sm"
      className={`z-[100] flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-0 overflow-hidden rounded-2xl border-border bg-background p-0 shadow-2xl sm:max-w-[480px] ${
        processing ? "[&>button]:pointer-events-none [&>button]:opacity-30" : ""
      }`}
      onEscapeKeyDown={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => event.preventDefault()}
    >
      <DialogHeader className="gap-0 border-b border-border px-5 py-4 pr-12 text-left">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgb(var(--selection-accent-rgb)_/_0.24)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] text-[var(--selection-accent)]">
            <Ticket className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 pt-0.5">
            <DialogTitle className="text-base leading-5 text-foreground">Activate a code</DialogTitle>
            <DialogDescription className="mt-1 text-xs leading-4 text-text-muted">
              Add the plan and agent capacity from a promo code to this account.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <form className="flex min-h-0 flex-col" aria-busy={processing} onSubmit={(event) => { void handleSubmit(event); }}>
        <div className="space-y-4 overflow-y-auto p-5">
          <div className="space-y-2">
            <Label htmlFor={inputId} className="text-xs font-medium text-foreground">
              Activation code
            </Label>
            <Input
              id={inputId}
              name="activationCode"
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Enter activation code"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              autoFocus
              disabled={processing}
              required
              spellCheck={false}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${helpId} ${errorId}` : helpId}
              className="h-10 rounded-xl border-border bg-surface-low/60 px-3 font-mono text-sm tracking-[0.04em] text-foreground placeholder:font-sans placeholder:tracking-normal placeholder:text-text-muted"
            />
            <p id={helpId} className="text-[11px] leading-4 text-text-muted">
              Enter the complete code exactly as provided. Your plan details refresh after activation.
            </p>
          </div>

          {error ? (
            <div id={errorId} role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs leading-4 text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t border-border bg-surface-low/30 px-5 py-4">
          <Button type="submit" disabled={processing} className="w-full rounded-lg sm:w-auto">
            {processing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {processing ? "Activating..." : "Activate Code"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
