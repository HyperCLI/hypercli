"use client";

import * as React from "react";
import type {
  AgentSkillProposalInspection,
  AgentSkillProposalSummary,
} from "@hypercli.com/sdk/skills";
import { ArrowLeft, Check, FileClock, Loader2, X } from "lucide-react";
import { Button, ConfirmDialog, RecoveryDetails, toast } from "@hypercli/shared-ui";

import { SkillMarkdown } from "./SkillMarkdown";

interface SkillProposalDetailProps {
  proposal: AgentSkillProposalSummary;
  canApply: boolean;
  canReject: boolean;
  onBack: () => void;
  onInspect: (proposalId: string) => Promise<AgentSkillProposalInspection>;
  onApply?: (proposalId: string, revision?: string) => Promise<unknown>;
  onReject?: (proposalId: string, revision?: string) => Promise<unknown>;
  onApproved: () => Promise<unknown>;
}

export function SkillProposalDetail({
  proposal,
  canApply,
  canReject,
  onBack,
  onInspect,
  onApply,
  onReject,
  onApproved,
}: SkillProposalDetailProps) {
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const [inspection, setInspection] = React.useState<AgentSkillProposalInspection | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [decision, setDecision] = React.useState<"apply" | "reject" | null>(null);
  const [rejectOpen, setRejectOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInspection(await onInspect(proposal.id));
    } catch (cause) {
      setInspection(null);
      setError(cause instanceof Error && cause.message.trim()
        ? cause.message.trim()
        : "This pending skill could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [onInspect, proposal.id]);

  React.useEffect(() => {
    titleRef.current?.focus();
    void Promise.resolve().then(load);
  }, [load]);

  const apply = async () => {
    if (!inspection?.content.trim() || decision || !onApply) return;
    setDecision("apply");
    setError(null);
    try {
      await onApply(proposal.id, inspection.revision);
      await onApproved().catch(() => {
        toast.warning("The skill was approved. Refresh Skills to load its installed details.");
      });
      toast.success(`${proposal.skillName} added to My skills.`);
      onBack();
    } catch (cause) {
      setError(cause instanceof Error && cause.message.trim()
        ? cause.message.trim()
        : "The pending skill was not approved. Reload it and try again.");
    } finally {
      setDecision(null);
    }
  };

  const reject = async () => {
    if (decision || !onReject) return;
    setDecision("reject");
    setError(null);
    try {
      await onReject(proposal.id, inspection?.revision);
      toast.success(`${proposal.skillName} proposal rejected.`);
      onBack();
    } catch (cause) {
      setRejectOpen(false);
      setError(cause instanceof Error && cause.message.trim()
        ? cause.message.trim()
        : "The pending skill was not rejected. Reload it and try again.");
    } finally {
      setDecision(null);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-5 sm:py-5">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} className="mb-4 h-8 gap-1.5 px-2 text-xs text-text-muted hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />Back to Skills
        </Button>

        <header className="border-b border-border pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-warning/30 bg-warning/10">
                <FileClock className="h-4 w-4 text-warning" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 ref={titleRef} tabIndex={-1} className="text-xl font-semibold leading-tight outline-none">{proposal.skillName}</h1>
                  <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">Pending review</span>
                </div>
                <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-muted">{proposal.description}</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {canReject && onReject && (
                <Button type="button" variant="outline" size="sm" disabled={decision !== null || loading} onClick={() => setRejectOpen(true)} className="h-8 gap-1.5 px-2.5 text-[11px]">
                  <X className="h-3.5 w-3.5" />Reject
                </Button>
              )}
              {canApply && onApply && (
                <Button type="button" size="sm" disabled={decision !== null || loading || !inspection?.content.trim()} onClick={() => void apply()} className="h-8 gap-1.5 px-2.5 text-[11px]">
                  {decision === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {decision === "apply" ? "Approving..." : "Approve skill"}
                </Button>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-[12px] text-warning">
            <p>The pending skill could not be updated. Reload the latest proposal before trying again.</p>
            <RecoveryDetails label="Technical details" technicalDetails={error} className="mt-2" />
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading || decision !== null} className="mt-3">Reload proposal</Button>
          </div>
        )}

        <section className="mt-5 rounded-xl border border-border bg-surface-low/25 px-4 py-4" aria-labelledby="proposal-skill-document">
          <h2 id="proposal-skill-document" className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">Proposed SKILL.md</h2>
          {loading ? (
            <div role="status" className="flex items-center gap-2 text-[12px] text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading pending instructions...</div>
          ) : inspection?.content.trim() ? (
            <SkillMarkdown content={inspection.content} />
          ) : !error ? (
            <p role="alert" className="text-[12px] text-warning">This proposal does not contain skill instructions and cannot be approved.</p>
          ) : null}
        </section>
      </div>

      <ConfirmDialog
        open={rejectOpen}
        title="Reject pending skill?"
        message="This removes the proposal without installing or changing the skill."
        confirmLabel="Reject proposal"
        loading={decision === "reject"}
        onConfirm={() => void reject()}
        onCancel={() => { if (!decision) setRejectOpen(false); }}
      />
    </div>
  );
}
