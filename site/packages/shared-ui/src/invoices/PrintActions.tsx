"use client";

export function PrintActions() {
  return (
    <div className="print-actions print:hidden flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center justify-center rounded-full border border-border-strong bg-surface-high px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-background"
      >
        Print / Save PDF
      </button>
    </div>
  );
}
