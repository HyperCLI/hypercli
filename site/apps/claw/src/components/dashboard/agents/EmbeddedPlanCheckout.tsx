"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Loader2,
  Rocket,
  Server,
  Sparkles,
  Wallet,
} from "lucide-react";
import { createWalletClient, custom, type WalletClient } from "viem";
import { base } from "viem/chains";
import { notifyBillingPlanChanged } from "@hypercli/shared-ui";

import { createHyperAgentClient } from "@/lib/agent-client";
import { formatTokens } from "@/lib/format";
import { preserveFirstAgentSetupDraftForCheckout } from "@/hooks/useFirstAgentSetupDraft";
import {
  buildStripeCheckoutReturnUrl,
  clearPendingPlanCheckout,
  createPlanCheckoutAttemptId,
  writePendingPlanCheckout,
  type PendingPlanCheckout,
} from "@/lib/plan-checkout-state";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface WalletState {
  client: WalletClient;
  address: string;
}

export interface EmbeddedCheckoutPlan {
  id: string;
  name: string;
  price: number;
  bundle?: Record<string, number>;
  description?: string;
  features?: string[];
  maxAgentSize?: "small" | "medium" | "large" | null;
  agentResources?: {
    maxAgents: number;
    totalCpu: number;
    totalMemory: number;
  } | null;
  limits: {
    tpd: number;
    burst_tpm?: number;
    burstTpm?: number;
    rpm: number;
  };
}

interface EmbeddedPlanCheckoutProps {
  plan: EmbeddedCheckoutPlan;
  ownedCount?: number;
  principalId: string;
  baselineGrantedSlots?: Record<string, number>;
  isPrincipalCurrent?: () => boolean;
  onSuccess: (pending: PendingPlanCheckout) => void;
  onComplete: () => void;
  onProcessingChange?: (processing: boolean) => void;
  getToken: () => Promise<string>;
  firstAgentSetup?: {
    setupId: string;
    workspaceId?: string | null;
    knowledgeCollectionId: string | null;
    size: string;
  };
}

type PaymentMethod = "card" | "crypto";

let embeddedWalletState: WalletState | null = null;

function hasBundle(bundle: Record<string, number> | undefined): bundle is Record<string, number> {
  return Boolean(bundle && Object.values(bundle).some((count) => Number(count) > 0));
}

function titleize(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function uniqueRows(rows: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return rows.filter((row): row is string => {
    const normalized = row?.trim();
    if (!normalized || seen.has(normalized.toLowerCase())) return false;
    seen.add(normalized.toLowerCase());
    return true;
  });
}

function getProvider(): EthereumProvider {
  const win = window as Window & { ethereum?: EthereumProvider };
  if (!win.ethereum) throw new Error("Please install MetaMask or another Ethereum wallet");
  return win.ethereum;
}

async function connectWallet(): Promise<WalletState> {
  if (embeddedWalletState) return embeddedWalletState;
  const provider = getProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
  if (!accounts?.length) throw new Error("No accounts found");

  const chainId = await provider.request({ method: "eth_chainId" }) as string;
  if (chainId !== "0x2105") {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }],
      });
    } catch (error: any) {
      if (error?.code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x2105",
          chainName: "Base",
          nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        }],
      });
    }
  }

  const client = createWalletClient({
    account: accounts[0] as `0x${string}`,
    chain: base,
    transport: custom(provider as any),
  });
  embeddedWalletState = { client, address: accounts[0] };
  return embeddedWalletState;
}

function walletClientToX402Signer(wallet: WalletClient) {
  return {
    address: wallet.account!.address,
    signTypedData: (params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => wallet.signTypedData({
      account: wallet.account!,
      domain: params.domain as any,
      types: params.types as any,
      primaryType: params.primaryType,
      message: params.message as any,
    }),
  };
}

function paymentErrorMessage(error: any): string {
  if (error?.response?.data?.detail) {
    return typeof error.response.data.detail === "string"
      ? error.response.data.detail
      : JSON.stringify(error.response.data.detail);
  }
  return error?.message || "Payment failed. Please try again.";
}

export function EmbeddedPlanCheckout({
  plan,
  ownedCount = 0,
  principalId,
  baselineGrantedSlots = {},
  isPrincipalCurrent,
  onSuccess,
  onComplete,
  onProcessingChange,
  getToken,
  firstAgentSetup,
}: EmbeddedPlanCheckoutProps) {
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [technicalOpen, setTechnicalOpen] = useState(true);
  const [walletAddress, setWalletAddress] = useState<string | null>(() => embeddedWalletState?.address ?? null);
  const activeRef = useRef(true);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canContinue = () => activeRef.current && (isPrincipalCurrent?.() ?? true);
  const updateProcessing = (nextProcessing: boolean) => {
    setProcessing(nextProcessing);
    onProcessingChange?.(nextProcessing);
  };
  const planBundle = hasBundle(plan.bundle) ? plan.bundle : undefined;
  const burstTpm = plan.limits.burst_tpm ?? plan.limits.burstTpm ?? 0;
  const bundleRows = Object.entries(planBundle ?? {})
    .filter(([, count]) => Number(count) > 0)
    .map(([tier, count]) => `${count}x ${titleize(tier)} agent slot${Number(count) === 1 ? "" : "s"}`);
  const maxAgents = Math.max(Number(plan.agentResources?.maxAgents || 0), 0);
  const memoryPerAgent = maxAgents > 0
    ? Number(plan.agentResources?.totalMemory || 0) / maxAgents
    : 0;
  const memoryLabel = memoryPerAgent > 0
    ? `${Number.isInteger(memoryPerAgent) ? memoryPerAgent : memoryPerAgent.toFixed(1)} GB`
    : "-";
  const agentSlots = Object.values(planBundle ?? {}).reduce((total, count) => total + Number(count || 0), 0);
  const includedRows = uniqueRows([
    ...bundleRows,
    ...(plan.features ?? []),
    plan.limits.tpd > 0 ? `${formatTokens(plan.limits.tpd)} tokens a day, shared across your agents` : null,
  ]).slice(0, 3);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const writePendingCheckout = (
    returnSessionId?: string,
    checkoutAttemptId?: string,
    checkoutSessionId?: string | null,
  ): PendingPlanCheckout => {
    if (firstAgentSetup) {
      preserveFirstAgentSetupDraftForCheckout(principalId, firstAgentSetup.setupId);
    }
    const pending = {
      principalId,
      planId: plan.id,
      planName: plan.name,
      ownedCount,
      startedAt: Date.now(),
      ...(returnSessionId ? { returnSessionId } : {}),
      ...(checkoutAttemptId ? { checkoutAttemptId } : {}),
      ...(checkoutSessionId ? { checkoutSessionId } : {}),
      ...(planBundle ? { bundle: planBundle } : {}),
      baselineGrantedSlots,
      ...(firstAgentSetup ? {
        flow: "first-agent-setup" as const,
        setupId: firstAgentSetup.setupId,
        ...(firstAgentSetup.workspaceId ? { workspaceId: firstAgentSetup.workspaceId } : {}),
        knowledgeCollectionId: firstAgentSetup.knowledgeCollectionId,
        agentSize: firstAgentSetup.size,
      } : {}),
    } satisfies PendingPlanCheckout;
    writePendingPlanCheckout(pending);
    return pending;
  };

  const handleCard = async () => {
    updateProcessing(true);
    setError(null);
    try {
      if (!principalId) throw new Error("Sign in again before starting checkout.");
      const token = await getToken();
      if (!canContinue()) return;
      const hyperAgent = createHyperAgentClient(token);
      const checkoutAttemptId = createPlanCheckoutAttemptId();
      const data = await hyperAgent.createStripeCheckout({
        quantity: 1,
        successUrl: buildStripeCheckoutReturnUrl("success", checkoutAttemptId),
        cancelUrl: buildStripeCheckoutReturnUrl("cancelled", checkoutAttemptId),
      }, plan.id);
      if (!canContinue()) return;
      writePendingCheckout(
        undefined,
        data.checkoutAttemptId ?? checkoutAttemptId,
        data.checkoutSessionId,
      );
      if (!canContinue()) return;
      window.location.href = data.checkoutUrl;
    } catch (nextError) {
      if (!canContinue()) return;
      setError(paymentErrorMessage(nextError));
      updateProcessing(false);
    }
  };

  const handleConnectWallet = async () => {
    updateProcessing(true);
    setError(null);
    try {
      const wallet = await connectWallet();
      if (canContinue()) setWalletAddress(wallet.address);
    } catch (nextError) {
      if (canContinue()) setError(paymentErrorMessage(nextError));
    } finally {
      if (canContinue()) updateProcessing(false);
    }
  };

  const handleCrypto = async () => {
    updateProcessing(true);
    setError(null);
    let pendingCheckout: PendingPlanCheckout | null = null;
    try {
      if (!principalId) throw new Error("Sign in again before starting checkout.");
      const token = await getToken();
      if (!canContinue()) return;
      const hyperAgent = createHyperAgentClient(token);
      const wallet = await connectWallet();
      if (!canContinue()) return;
      const checkoutAttemptId = createPlanCheckoutAttemptId();
      pendingCheckout = writePendingCheckout(undefined, checkoutAttemptId);
      await hyperAgent.purchaseViaX402WithSigner(plan.id, {
        quantity: 1,
        signer: walletClientToX402Signer(wallet.client),
        amountUsd: plan.price,
      });
      notifyBillingPlanChanged();
      pendingCheckout = writePendingCheckout(`x402:${checkoutAttemptId}`, checkoutAttemptId);
      const principalCurrent = isPrincipalCurrent ? isPrincipalCurrent() : activeRef.current;
      if (!principalCurrent) return;
      onSuccess(pendingCheckout);
      if (!activeRef.current) return;
      setSuccess(true);
      successTimerRef.current = setTimeout(() => {
        if (canContinue()) onComplete();
      }, 2000);
    } catch (nextError) {
      if (!canContinue()) return;
      if (pendingCheckout) clearPendingPlanCheckout(principalId, pendingCheckout);
      setError(paymentErrorMessage(nextError));
    } finally {
      if (canContinue()) updateProcessing(false);
    }
  };

  const handleSubmit = () => {
    if (method === "card") {
      void handleCard();
    } else if (!walletAddress) {
      void handleConnectWallet();
    } else {
      void handleCrypto();
    }
  };

  const buttonLabel = processing
    ? "Preparing checkout..."
    : method === "card"
      ? "Continue with Card"
      : walletAddress
        ? `Pay $${plan.price} USDC`
        : "Connect Wallet";

  if (success) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 py-8" data-slot="embedded-checkout-content">
        <div role="status" className="max-w-md text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-selection-accent/35 bg-selection-accent/10 text-selection-accent">
            <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
          </span>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-selection-accent">Payment confirmed</p>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">Capacity unlocked</h3>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            {ownedCount > 0 ? `Another ${plan.name} capacity pack is active.` : `${plan.name} capacity is now active.`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6 sm:px-8 sm:py-8" data-slot="embedded-checkout-content">
      <div className="m-auto w-full max-w-[840px] shrink-0" data-slot="embedded-checkout-layout">
        <section aria-labelledby="embedded-payment-method">
          <h3 id="embedded-payment-method" className="text-[18px] font-semibold text-foreground">Payment method</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PaymentMethodButton
              checked={method === "card"}
              disabled={processing}
              icon={<CreditCard className="h-5 w-5" aria-hidden="true" />}
              label="Card"
              description="Via Stripe"
              ariaLabel="Card, Stripe checkout"
              onClick={() => setMethod("card")}
            />
            <PaymentMethodButton
              checked={method === "crypto"}
              disabled={processing}
              icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
              label="Wallet"
              description="On Base"
              ariaLabel="Wallet, Base via USDC"
              onClick={() => setMethod("crypto")}
            />
          </div>
          {method === "crypto" ? (
            <p className="mt-3 text-[13px] text-text-muted">
              {walletAddress ? `Connected ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : `Connect a Base wallet to pay $${plan.price} USDC.`}
            </p>
          ) : null}
        </section>

        <section aria-labelledby="embedded-checkout-plan" className="mt-7 overflow-hidden rounded-[20px] border border-border bg-background" data-slot="embedded-checkout-plan-summary">
          <div className="p-5 sm:p-8">
            <div className="flex items-center justify-between gap-5">
              <div className="flex min-w-0 items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[15px] border border-border bg-surface-high text-foreground">
                  {plan.maxAgentSize === "large" ? <Rocket className="h-6 w-6" aria-hidden="true" /> : <Sparkles className="h-6 w-6" aria-hidden="true" />}
                </span>
                <h3 id="embedded-checkout-plan" className="truncate text-[28px] font-semibold tracking-[-0.03em] text-foreground">{plan.name}</h3>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-[26px] font-semibold text-foreground">{plan.price} US$</span>
                <span className="ml-2 text-[15px] text-text-muted">/ month</span>
              </div>
            </div>

            {memoryPerAgent > 0 ? (
              <div className="mt-7 flex items-start gap-4 rounded-[16px] border border-border bg-background-secondary p-5">
                <Server className="mt-0.5 h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />
                <div>
                  <p className="text-[16px] font-semibold text-foreground">{memoryLabel} RAM included with every {plan.name} agent</p>
                  <p className="mt-2 text-[14px] leading-6 text-text-muted">Dedicated memory and inference capacity are included in this plan.</p>
                </div>
              </div>
            ) : null}

            <div className="mt-7 space-y-4">
              {(includedRows.length > 0 ? includedRows : ["Plan feature details are unavailable right now."]).map((row) => (
                <div key={row} className="flex items-start gap-3 text-[16px] leading-6 text-foreground">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#25d42a]" aria-hidden="true" />
                  <span>{row}</span>
                </div>
              ))}
            </div>

            <details
              open={technicalOpen}
              onToggle={(event) => setTechnicalOpen(event.currentTarget.open)}
              className="group mt-7 rounded-[16px] bg-surface-high p-5"
            >
              <summary className="flex list-none items-center gap-4 outline-none focus-visible:ring-2 focus-visible:ring-selection-accent/45 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1 text-[16px] font-semibold text-foreground">Technical limits</span>
                <ChevronDown className="h-4 w-4 text-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <dl className="mt-5 grid gap-x-10 gap-y-5 border-t border-border pt-5 sm:grid-cols-2">
                <TechnicalLimit label="Memory" value={memoryLabel} />
                <TechnicalLimit label="Daily tokens" value={formatTokens(plan.limits.tpd)} />
                <TechnicalLimit label="Burst TPM" value={formatTokens(burstTpm)} />
                <TechnicalLimit label="Requests / min" value={formatTokens(plan.limits.rpm)} />
                <TechnicalLimit label="Agent slots" value={agentSlots > 0 ? String(agentSlots) : "-"} />
              </dl>
            </details>

            {error ? <div role="alert" className="mt-5 rounded-[12px] border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
          </div>

          <div className="border-t border-border bg-surface-low p-4 sm:px-5">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={processing}
              className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-[12px] bg-[var(--button-primary)] px-4 text-[16px] font-medium text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] disabled:cursor-wait disabled:opacity-65"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {buttonLabel}
              {!processing ? <ArrowRight className="h-5 w-5" aria-hidden="true" /> : null}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function PaymentMethodButton({
  ariaLabel,
  checked,
  description,
  disabled,
  icon,
  label,
  onClick,
}: {
  ariaLabel: string;
  checked: boolean;
  description: string;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={checked}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[92px] items-center gap-4 rounded-[16px] border p-4 text-left transition-colors disabled:opacity-60 ${checked ? "border-selection-accent bg-selection-accent/5" : "border-border bg-background hover:border-border-strong"}`}
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] border border-border bg-background-secondary text-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold text-foreground">{label}</span>
        <span className="mt-1 block text-[14px] text-text-muted">{description}</span>
      </span>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${checked ? "border-border-strong bg-surface-high" : "border-border-strong"}`}>
        {checked ? <span className="h-3 w-3 rounded-full bg-selection-accent" /> : null}
      </span>
    </button>
  );
}

function TechnicalLimit({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-[14px] text-text-muted">{label}</dt>
      <dd className="text-[15px] font-semibold text-foreground">{value}</dd>
    </div>
  );
}
