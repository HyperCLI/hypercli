"use client";

export function PrintActions() {
  return (
    <div className="print-actions print:hidden flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center justify-center rounded-full border border-[#cbc1af] bg-[#161819] px-4 py-2 text-sm font-semibold text-[#f7f3eb] transition hover:bg-[#0b0d0e]"
      >
        Print / Save PDF
      </button>
    </div>
  );
}
