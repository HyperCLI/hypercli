"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Coins,
  CreditCard,
  Loader2,
  LockKeyhole,
  Sparkles,
  Wallet,
} from "lucide-react";
import { createWalletClient, custom, type WalletClient } from "viem";
import { base } from "viem/chains";
import { notifyBillingPlanChanged } from "@hypercli/shared-ui";

import { createHyperAgentClient } from "@/lib/agent-client";
import { formatTokens } from "@/lib/format";
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
      ? "Continue with card"
      : walletAddress
        ? `Pay $${plan.price} USDC`
        : "Connect wallet";

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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5 sm:px-7 sm:py-6" data-slot="embedded-checkout-content">
      <div className="m-auto grid w-full max-w-[940px] shrink-0 gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)] lg:gap-8" data-slot="embedded-checkout-layout">
        <section aria-labelledby="embedded-checkout-plan" className="relative p-5 sm:p-6" data-slot="embedded-checkout-plan-summary">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-selection-accent/30 bg-selection-accent/10 text-selection-accent">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-selection-accent">Selected capacity</p>
                <h3 id="embedded-checkout-plan" className="mt-1 truncate text-xl font-semibold text-foreground">{plan.name}</h3>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <span className="text-[30px] font-bold leading-none text-foreground">${plan.price}</span>
              <span className="mt-1 block text-[10px] font-medium text-text-muted">per plan / month</span>
            </div>
          </div>

          <p className="mt-6 max-w-md text-sm leading-6 text-text-secondary">
            Add a fresh block of capacity without losing any of the setup you have already completed.
          </p>

          <dl className="mt-6 grid grid-cols-3 divide-x divide-border border-y border-border py-4">
            <div className="pr-3">
              <dt className="text-[10px] uppercase tracking-[0.1em] text-text-muted">Daily tokens</dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">{formatTokens(plan.limits.tpd)}</dd>
            </div>
            <div className="px-3">
              <dt className="text-[10px] uppercase tracking-[0.1em] text-text-muted">Burst TPM</dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">{formatTokens(burstTpm)}</dd>
            </div>
            <div className="pl-3">
              <dt className="text-[10px] uppercase tracking-[0.1em] text-text-muted">RPM</dt>
              <dd className="mt-1 text-sm font-semibold text-foreground">{formatTokens(plan.limits.rpm)}</dd>
            </div>
          </dl>

          <div className="mt-5 space-y-2.5">
            {(bundleRows.length > 0 ? bundleRows : ["Additional agent capacity"]).map((row) => (
              <div key={row} className="flex items-center gap-2.5 text-sm text-text-secondary">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-selection-accent/10 text-selection-accent">
                  <Check className="h-3 w-3" aria-hidden="true" />
                </span>
                <span>{row}</span>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="embedded-payment-method" className="flex min-w-0 flex-col lg:border-l lg:border-border lg:pl-8">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-selection-accent">Secure checkout</p>
          <h3 id="embedded-payment-method" className="mt-2 text-xl font-semibold text-foreground">How would you like to pay?</h3>
          <p className="mt-2 text-sm leading-5 text-text-muted">Your agent setup is saved while you finish payment.</p>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              aria-label="Card, Stripe checkout"
              aria-pressed={method === "card"}
              disabled={processing}
              onClick={() => setMethod("card")}
              className={`flex min-h-[92px] flex-col items-start justify-between rounded-[12px] border p-3.5 text-left transition-colors disabled:opacity-60 ${
                method === "card"
                  ? "border-selection-accent bg-selection-accent/10"
                  : "border-border bg-background hover:border-border-strong"
              }`}
            >
              <CreditCard className="h-5 w-5 text-foreground" aria-hidden="true" />
              <span>
                <span className="block text-sm font-semibold text-foreground">Card</span>
                <span className="mt-0.5 block text-[11px] text-text-muted">Stripe checkout</span>
              </span>
            </button>
            <button
              type="button"
              aria-label="USDC, Base via x402"
              aria-pressed={method === "crypto"}
              disabled={processing}
              onClick={() => setMethod("crypto")}
              className={`flex min-h-[92px] flex-col items-start justify-between rounded-[12px] border p-3.5 text-left transition-colors disabled:opacity-60 ${
                method === "crypto"
                  ? "border-selection-accent bg-selection-accent/10"
                  : "border-border bg-background hover:border-border-strong"
              }`}
            >
              <Coins className="h-5 w-5 text-foreground" aria-hidden="true" />
              <span>
                <span className="block text-sm font-semibold text-foreground">USDC</span>
                <span className="mt-0.5 block text-[11px] text-text-muted">Base via x402</span>
              </span>
            </button>
          </div>

          <div className="mt-4 rounded-[12px] border border-border bg-surface-low/55 p-3.5 text-sm text-text-secondary">
            {method === "card" ? (
              <div className="flex items-start gap-3">
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-selection-accent" aria-hidden="true" />
                <p>Continue to Stripe to review and complete your ${plan.price} monthly purchase.</p>
              </div>
            ) : walletAddress ? (
              <div className="flex items-center gap-2.5">
                <Wallet className="h-4 w-4 shrink-0 text-selection-accent" aria-hidden="true" />
                <span className="font-mono text-xs text-foreground">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span>
                <span className="ml-auto text-xs text-text-muted">${plan.price} USDC</span>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-selection-accent" aria-hidden="true" />
                <p>Connect a wallet on Base, then confirm the ${plan.price} USDC payment.</p>
              </div>
            )}
          </div>

          {error ? <div role="alert" className="mt-4 rounded-[10px] border border-destructive/25 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">{error}</div> : null}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={processing}
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--button-primary)] px-4 text-sm font-semibold text-[var(--button-primary-foreground)] transition-colors hover:bg-[var(--button-primary-hover)] disabled:cursor-wait disabled:opacity-65"
          >
            {processing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {buttonLabel}
            {!processing ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : null}
          </button>
          <p className="mt-3 text-center text-[11px] leading-4 text-text-muted">
            Card checkout opens Stripe. USDC settles on Base.
          </p>
        </section>
      </div>
    </div>
  );
}
