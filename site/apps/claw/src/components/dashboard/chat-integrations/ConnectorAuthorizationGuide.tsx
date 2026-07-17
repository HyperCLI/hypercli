"use client";

import { Check, KeyRound, Loader2, Send } from "lucide-react";
import { useState } from "react";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";

import {
  connectorWorkflowInputConditionsMatch,
  type ConnectorWorkflowInputControls,
  type ConnectorWorkflowInputVisibility,
} from "./ConnectorWorkflowGuide";

export interface ConnectorAuthorizationFlow {
  protocol: "short-code";
  visibleWhen: ConnectorWorkflowInputVisibility;
  identityLabel: string;
  identityRequirement: "none" | "optional" | "required";
  codeLength: number;
  codePattern: RegExp;
  expiresInMinutes: number;
  firstEventProcessed: boolean;
}

interface ConnectorAuthorizationGuideProps {
  connectorId: string;
  displayName: string;
  flow: ConnectorAuthorizationFlow;
  provider?: AgentConnectorsProvider | null;
  accountId?: string;
  variant?: "setup" | "owner";
  onApproved?: () => void;
}

export function activeConnectorAuthorizationFlow(
  flows: readonly ConnectorAuthorizationFlow[],
  inputControls: ConnectorWorkflowInputControls,
): ConnectorAuthorizationFlow | null {
  return flows.find((flow) => connectorWorkflowInputConditionsMatch(flow.visibleWhen, inputControls)) ?? null;
}

export function ConnectorAuthorizationGuide({
  connectorId,
  displayName,
  flow,
  provider,
  accountId,
  variant = "setup",
  onApproved,
}: ConnectorAuthorizationGuideProps) {
  const [code, setCode] = useState("");
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedCode = code.trim().toUpperCase();
  const codeValid = normalizedCode.length === flow.codeLength && flow.codePattern.test(normalizedCode);
  const canApprove = Boolean(provider?.approveAuthorization) && codeValid && !approving && !approved;
  const identityRequired = flow.identityRequirement === "required";
  const ownerApproval = variant === "owner";

  const approve = async () => {
    if (!provider?.approveAuthorization || !codeValid) return;
    setApproving(true);
    setError(null);
    try {
      await provider.approveAuthorization({
        connectorId,
        protocol: flow.protocol,
        code: normalizedCode,
        ...(accountId ? { accountId } : {}),
        ...(!ownerApproval ? { notify: true } : {}),
      });
      setApproved(true);
      onApproved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The authorization code could not be approved.");
    } finally {
      setApproving(false);
    }
  };

  return (
    <div data-connector-authorization={flow.protocol} className="space-y-4">
      {!ownerApproval ? (
        <div className="rounded-2xl border border-selection-accent/30 bg-selection-accent/10 p-3 text-text-secondary">
          <p className="font-semibold text-foreground">
            {identityRequired ? `A ${flow.identityLabel} is required` : `No ${flow.identityLabel} is required`}
          </p>
          <p className="mt-1 text-xs leading-5">
            Send the first message from the account you want to authorize. It returns a {flow.codeLength}-character code
            {flow.firstEventProcessed ? "." : ", and that first message is not processed."}
          </p>
        </div>
      ) : null}

      <ol className={`grid gap-3 ${ownerApproval ? "" : "sm:grid-cols-2"}`}>
        {!ownerApproval ? (
          <li className="rounded-2xl border border-border bg-background/65 p-3">
            <div className="flex items-center gap-2 text-foreground">
              <Send className="h-4 w-4 text-selection-accent" />
              <p className="font-semibold">1. Request access</p>
            </div>
            <p className="mt-2 text-xs leading-5 text-text-muted">
              Open {displayName} and send a direct message to this connection. Copy the code from its reply.
            </p>
          </li>
        ) : null}

        <li className="rounded-2xl border border-border bg-background/65 p-3">
          <div className="flex items-center gap-2 text-foreground">
            <KeyRound className="h-4 w-4 text-selection-accent" />
            <p className="font-semibold">{ownerApproval ? "Approve pairing" : "2. Approve the code"}</p>
          </div>
          <label htmlFor={`${connectorId}-authorization-code`} className="mt-2 block text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">
            {flow.codeLength}-character authorization code
          </label>
          <input
            id={`${connectorId}-authorization-code`}
            aria-label={`${displayName} authorization code`}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setError(null);
            }}
            maxLength={flow.codeLength}
            autoComplete="off"
            spellCheck={false}
            placeholder={"X".repeat(flow.codeLength)}
            className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 font-mono text-lg font-bold uppercase tracking-[0.18em] text-foreground outline-none placeholder:text-text-muted focus:border-selection-accent"
          />
          <p className="mt-2 text-[11px] leading-4 text-text-muted">The code expires after {flow.expiresInMinutes} minutes.</p>
          {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
          {!provider?.approveAuthorization ? (
            <p role="alert" className="mt-2 text-xs text-warning">Code approval is not available in this workspace.</p>
          ) : null}
          <button
            type="button"
            disabled={!canApprove}
            onClick={() => void approve()}
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-xl bg-selection-accent px-3 text-xs font-semibold text-selection-accent-foreground transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selection-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : approved ? <Check className="h-4 w-4" /> : null}
            {approved ? (ownerApproval ? "Pairing approved" : "Code approved") : approving ? "Approving" : ownerApproval ? "Approve pairing" : "Approve code"}
          </button>
          {!ownerApproval && !approved ? (
            <button
              type="button"
              onClick={() => {
                setApproved(true);
                setError(null);
                onApproved?.();
              }}
              className="ml-2 mt-3 inline-flex h-9 items-center rounded-xl border border-border px-3 text-xs font-semibold text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-high hover:text-foreground"
            >
              I approved it elsewhere
            </button>
          ) : null}
        </li>
      </ol>

      {!ownerApproval ? (
        <div className={`rounded-2xl border p-3 ${approved ? "border-selection-accent bg-selection-accent/10" : "border-border bg-background/45"}`}>
          <p className={`font-semibold ${approved ? "text-selection-accent" : "text-text-muted"}`}>3. Send the message again</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            After approval, send a new message. The original authorization request is never replayed automatically.
          </p>
        </div>
      ) : null}
    </div>
  );
}
