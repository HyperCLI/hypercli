"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, CreditCard, Coins, Wallet } from "lucide-react";
import { createHyperAgentClient } from "@/lib/agent-client";
import { formatTokens } from "@/lib/format";
import { createWalletClient, custom, type WalletClient } from "viem";
import { base } from "viem/chains";

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface WalletState {
  client: WalletClient;
  address: string;
}

let walletState: WalletState | null = null;

function getProvider(): EthereumProvider {
  const win = window as Window & { ethereum?: EthereumProvider };
  if (!win.ethereum) {
    throw new Error("Please install MetaMask or another Ethereum wallet");
  }
  return win.ethereum;
}

async function connectWallet(): Promise<WalletState> {
  if (walletState) return walletState;

  const provider = getProvider();
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];

  if (!accounts?.length) throw new Error("No accounts found");

  const chainId = (await provider.request({ method: "eth_chainId" })) as string;
  if (chainId !== "0x2105") {
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x2105" }],
      });
    } catch (err: any) {
      if (err?.code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x2105",
              chainName: "Base",
              nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://mainnet.base.org"],
              blockExplorerUrls: ["https://basescan.org"],
            },
          ],
        });
      } else {
        throw err;
      }
    }
  }

  const client = createWalletClient({
    account: accounts[0] as `0x${string}`,
    chain: base,
    transport: custom(provider as any),
  });

  walletState = { client, address: accounts[0] };
  return walletState;
}

function getWalletState(): WalletState | null {
  return walletState;
}

function walletClientToX402Signer(wallet: WalletClient) {
  return {
    address: wallet.account!.address,
    signTypedData: (params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) =>
      wallet.signTypedData({
        account: wallet.account!,
        domain: params.domain as any,
        types: params.types as any,
        primaryType: params.primaryType,
        message: params.message as any,
      }),
  };
}

interface PlanCheckoutModalProps {
  plan: {
    id: string;
    name: string;
    price: number;
    bundle: Record<string, number>;
    limits: {
      tpd: number;
      burst_tpm?: number;
      burstTpm?: number;
      rpm: number;
    };
  };
  ownedCount?: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  getToken: () => Promise<string>;
}

type PaymentMethod = "card" | "crypto";

export function PlanCheckoutModal({
  plan,
  ownedCount = 0,
  isOpen,
  onClose,
  onSuccess,
  getToken,
}: PlanCheckoutModalProps) {
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(
    () => getWalletState()?.address ?? null
  );

  const handleClose = () => {
    if (processing) return;
    setError(null);
    setSuccess(false);
    setMethod("card");
    onClose();
  };

  const handleCard = async () => {
    setProcessing(true);
    setError(null);
    try {
      const token = await getToken();
      const hyperAgent = createHyperAgentClient(token);
      const data = await hyperAgent.createStripeCheckout(
        {
          bundle: plan.bundle,
          quantity: 1,
          successUrl: `${window.location.origin}/plans?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/plans?cancelled=true`,
        },
        plan.id,
      );
      window.location.href = data.checkoutUrl;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create checkout session"
      );
      setProcessing(false);
    }
  };

  const handleConnectWallet = async () => {
    setProcessing(true);
    setError(null);
    try {
      const wallet = await connectWallet();
      setWalletAddress(wallet.address);
    } catch (err: any) {
      setError(err.message || "Failed to connect wallet");
    } finally {
      setProcessing(false);
    }
  };

  const handleCrypto = async () => {
    setProcessing(true);
    setError(null);
    try {
      const token = await getToken();
      const hyperAgent = createHyperAgentClient(token);
      const wallet = await connectWallet();
      await hyperAgent.purchaseViaX402WithSigner(plan.id, {
        bundle: plan.bundle,
        quantity: 1,
        signer: walletClientToX402Signer(wallet.client),
        amountUsd: plan.price,
      });
      setSuccess(true);
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 2000);
    } catch (err: any) {
      let msg = "Payment failed. Please try again.";
      if (err.response?.data?.detail) {
        msg =
          typeof err.response.data.detail === "string"
            ? err.response.data.detail
            : JSON.stringify(err.response.data.detail);
      } else if (err.message) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setProcessing(false);
    }
  };

  const handleSubmit = () => {
    if (method === "card") {
      handleCard();
    } else if (!walletAddress) {
      handleConnectWallet();
    } else {
      handleCrypto();
    }
  };

  if (!isOpen) return null;
  const burstTpm = plan.limits.burst_tpm ?? plan.limits.burstTpm ?? 0;

  const buttonLabel = () => {
    if (processing) return "Processing...";
    if (method === "card") return `Pay $${plan.price} with Card`;
    if (!walletAddress) return "Connect Wallet";
    return `Pay $${plan.price} with USDC`;
  };

  const modal = (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
      onClick={handleClose}
    >
      <div
        className="glass-card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-foreground">
              {ownedCount > 0 ? `Add ${plan.name}` : `Purchase ${plan.name}`}
            </h2>
            <button
              onClick={handleClose}
              disabled={processing}
              className="text-text-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-[#38D39F]/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Entitlement Active!
              </h3>
              <p className="text-text-secondary">
                {ownedCount > 0
                  ? `Another ${plan.name} entitlement is now active.`
                  : `Your ${plan.name} entitlement is now active.`}
              </p>
            </div>
          ) : (
            <>
              {/* Plan summary */}
              <div className="p-4 rounded-lg bg-surface-low/50 border border-white/5 mb-6">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-foreground font-medium">
                    {plan.name}
                  </span>
                  <span className="text-foreground font-bold">
                    ${plan.price}
                    <span className="text-text-muted text-sm font-normal">
                      /mo
                    </span>
                  </span>
                </div>
                <p className="text-sm text-text-tertiary">
                  {formatTokens(plan.limits.tpd)} tokens/day &middot;{" "}
                  Up to {formatTokens(burstTpm)} TPM &middot;{" "}
                  {formatTokens(plan.limits.rpm)} RPM
                </p>
                <p className="text-xs text-text-muted mt-2">
                  Each checkout adds another active entitlement. Inference pools across entitlements and agent slots stack by tier.
                </p>
              </div>

              {/* Payment method */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-foreground mb-3">
                  Payment Method
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setMethod("card")}
                    disabled={processing}
                    className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${
                      method === "card"
                        ? "border-[#38D39F]/60 bg-[#38D39F]/10"
                        : "border-white/10 hover:border-white/20"
                    } disabled:opacity-50`}
                  >
                    <CreditCard className="w-5 h-5 text-foreground" />
                    <div className="text-sm font-medium text-foreground">
                      Credit Card
                    </div>
                    <div className="text-xs text-text-muted">Stripe</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod("crypto")}
                    disabled={processing}
                    className={`p-4 rounded-lg border-2 transition-all flex flex-col items-center gap-2 ${
                      method === "crypto"
                        ? "border-[#38D39F]/60 bg-[#38D39F]/10"
                        : "border-white/10 hover:border-white/20"
                    } disabled:opacity-50`}
                  >
                    <Coins className="w-5 h-5 text-foreground" />
                    <div className="text-sm font-medium text-foreground">
                      USDC
                    </div>
                    <div className="text-xs text-text-muted">x402</div>
                  </button>
                </div>
              </div>

              {/* Crypto wallet status */}
              {method === "crypto" && (
                <div className="mb-4 p-3 rounded-lg bg-surface-low/50 border border-white/5 text-sm">
                  {walletAddress ? (
                    <div className="flex items-center gap-2 text-text-secondary">
                      <Wallet className="w-4 h-4 text-primary" />
                      <span className="font-mono text-xs">
                        {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                      </span>
                      <span className="text-text-muted ml-auto">
                        ${plan.price} USDC on Base
                      </span>
                    </div>
                  ) : (
                    <p className="text-text-muted">
                      Connect your wallet to pay{" "}
                      <span className="text-foreground font-medium">
                        ${plan.price} USDC
                      </span>{" "}
                      on Base.
                    </p>
                  )}
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mb-4 p-3 rounded-lg bg-[#d05f5f]/10 border border-[#d05f5f]/20 text-sm text-[#d05f5f]">
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={processing}
                className="w-full py-3 rounded-lg text-sm font-semibold btn-primary disabled:opacity-50"
              >
                {buttonLabel()}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return typeof window !== "undefined"
    ? createPortal(modal, document.body)
    : null;
}
