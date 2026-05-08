"use client";

import { Check, Loader2, ShieldCheck, Terminal, X } from "lucide-react";
import { useState } from "react";
import { ChatCard, type ChatCardTone } from "./ChatCard";

export type ApprovalRisk = "low" | "medium" | "high";

export type ApprovalState = "pending" | "approved" | "denied";

export interface ApprovalCardProps {
  /** Stable id used by the gateway when approving / denying. */
  approvalId: string;
  /** Action verb shown in the title (e.g. "Run shell command", "Modify file"). */
  action: string;
  /** Single-line summary of what will run (e.g. shell command, file path). */
  summary?: string;
  /** Risk level — controls the tone of the card. */
  risk?: ApprovalRisk;
  /** Optional structured detail rows (key/value) shown in the body. */
  details?: Array<{ label: string; value: string }>;
  /** Optional code/preview block shown in the body (e.g. command, diff snippet). */
  preview?: string;
  /** Current approval state. Defaults to "pending". */
  state?: ApprovalState;
  /** Approval handler. Should call gateway `execApprove` and update state. */
  onApprove?: (approvalId: string) => Promise<void> | void;
  /** Denial handler. Should call gateway `execDeny`. */
  onDeny?: (approvalId: string) => Promise<void> | void;
}

const RISK_TONE: Record<ApprovalRisk, ChatCardTone> = {
  low: "info",
  medium: "warning",
  high: "danger",
};

const RISK_LABEL: Record<ApprovalRisk, string> = {
  low: "Low risk",
  medium: "Needs review",
  high: "High risk",
};

export function ApprovalCard({
  approvalId,
  action,
  summary,
  risk = "medium",
  details,
  preview,
  state = "pending",
  onApprove,
  onDeny,
}: ApprovalCardProps) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const tone = state === "approved" ? "primary" : state === "denied" ? "neutral" : RISK_TONE[risk];
  const isPending = state === "pending";
  const status =
    state === "approved"
      ? { label: "Approved", tone: "primary" as ChatCardTone }
      : state === "denied"
        ? { label: "Denied", tone: "neutral" as ChatCardTone }
        : { label: RISK_LABEL[risk], tone: RISK_TONE[risk] };

  const handle = async (kind: "approve" | "deny") => {
    if (busy || !isPending) return;
    setBusy(kind);
    try {
      if (kind === "approve") await onApprove?.(approvalId);
      else await onDeny?.(approvalId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <ChatCard
      tone={tone}
      icon={ShieldCheck}
      title={action}
      subtitle={summary}
      status={status}
      collapsible
      defaultOpen={isPending}
      actions={
        isPending ? (
          <>
            <button
              type="button"
              onClick={() => handle("deny")}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-[#d05f5f]/40 hover:bg-[#d05f5f]/10 hover:text-[#d05f5f] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "deny" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Deny
            </button>
            <button
              type="button"
              onClick={() => handle("approve")}
              disabled={Boolean(busy)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#38D39F]/40 bg-[#38D39F]/15 px-3 py-1 text-xs font-semibold text-[#38D39F] transition-colors hover:bg-[#38D39F]/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "approve" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Approve
            </button>
          </>
        ) : null
      }
    >
      {(details && details.length > 0) || preview ? (
        <div className="space-y-2">
          {details && details.length > 0 && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
              {details.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-[11px] uppercase tracking-wide text-text-muted">{row.label}</dt>
                  <dd className="truncate font-mono text-[11px] text-text-secondary">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {preview && (
            <pre className="flex items-start gap-2 overflow-x-auto rounded border border-white/8 bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-5 text-text-secondary">
              <Terminal className="mt-0.5 h-3 w-3 shrink-0 text-text-muted" />
              <code className="whitespace-pre-wrap">{preview}</code>
            </pre>
          )}
        </div>
      ) : null}
    </ChatCard>
  );
}
