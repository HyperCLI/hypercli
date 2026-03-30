"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, ExternalLink, Loader2, AlertCircle, RefreshCw } from "lucide-react";

interface TelegramWizardProps {
  onConnect: (config: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, any>>;
  onClose: () => void;
  onVerified?: () => void;
  initialStep?: number;
  initialBotUsername?: string;
}

type DmPolicy = "pairing" | "open" | "allowlist" | "disabled";

/**
 * Check whether a channel is live from the channelsStatus(probe=true) response.
 *
 * Response shape (from gateway):
 *   { channels: { telegram: { configured, running, probe: { ok } } } }
 */
export function isChannelLive(status: Record<string, any> | null | undefined, channel: string): boolean {
  if (!status) return false;
  const ch = status.channels?.[channel];
  if (!ch || typeof ch !== "object") return false;
  return ch.configured === true && ch.running === true;
}

export function TelegramWizard({ onConnect, onChannelProbe, onClose, onVerified, initialStep, initialBotUsername }: TelegramWizardProps) {
  const [step, setStep] = useState(initialStep ?? 1);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [validating, setValidating] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(initialBotUsername ?? null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [dmPolicy, setDmPolicy] = useState<DmPolicy>("pairing");
  const [requireMention, setRequireMention] = useState(true);
  const [connecting, setConnecting] = useState(false);

  // Verification state
  const [verifying, setVerifying] = useState(initialStep === 3);
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const cancelVerifyRef = useRef(false);
  const verifyStartedRef = useRef(false);

  const validateToken = async () => {
    setValidating(true);
    setTokenError(null);
    setBotUsername(null);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await res.json();
      if (data.ok && data.result?.username) {
        setBotUsername(data.result.username);
      } else {
        setTokenError("Invalid token — check that you copied it correctly");
      }
    } catch {
      setTokenError("Could not reach Telegram API — check your connection");
    } finally {
      setValidating(false);
    }
  };

  const verifyChannel = useCallback(async () => {
    cancelVerifyRef.current = false;
    setVerifying(true);
    setVerifyError(null);

    const maxAttempts = 8;
    const intervalMs = 4000;

    for (let i = 0; i < maxAttempts; i++) {
      if (cancelVerifyRef.current) return;
      try {
        const status = await onChannelProbe();
        if (cancelVerifyRef.current) return;
        if (isChannelLive(status, "telegram")) {
          setVerified(true);
          setVerifying(false);
          setStep(4);
          onVerified?.();
          return;
        }
      } catch {
        // Probe may fail while gateway restarts — keep trying
      }
      if (i < maxAttempts - 1 && !cancelVerifyRef.current) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }

    if (!cancelVerifyRef.current) {
      setVerifying(false);
      setVerifyError("Bot verification timed out. Your agent may still be starting up.");
    }
  }, [onChannelProbe, onVerified]);

  // Auto-start verification when reopening at step 3 (from pending card click)
  useEffect(() => {
    if (initialStep === 3 && !verifyStartedRef.current) {
      verifyStartedRef.current = true;
      verifyChannel();
    }
    return () => { cancelVerifyRef.current = true; };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await onConnect({
        channels: {
          telegram: {
            enabled: true,
            botToken: token,
            dmPolicy,
            groups: { "*": { requireMention } },
          },
        },
      });
      // Set verifying BEFORE step change so step 3 renders spinner immediately
      setVerifying(true);
      setStep(3);
      // Start verification after config is saved (runs async, state already set)
      verifyChannel();
    } catch {
      setTokenError("Failed to save config — try again");
    } finally {
      setConnecting(false);
    }
  };

  const dmPolicyOptions: { value: DmPolicy; label: string; desc: string }[] = [
    { value: "pairing", label: "Pairing", desc: "Users request access, you approve" },
    { value: "open", label: "Open", desc: "Anyone can message your agent" },
    { value: "allowlist", label: "Allowlist", desc: "Only specific user IDs" },
    { value: "disabled", label: "Disabled", desc: "No direct messages" },
  ];

  const stepLabels = ["Create", "Configure", "Connect", "Verify"];

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-text-tertiary">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-[var(--border)]" />}
            <div
              className={`flex items-center gap-1.5 ${
                step === i + 1
                  ? "text-foreground font-medium"
                  : step > i + 1
                    ? "text-[var(--primary)]"
                    : ""
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium ${
                  step > i + 1
                    ? "bg-[var(--primary)] text-white"
                    : step === i + 1
                      ? "bg-[var(--surface-high)] text-foreground border border-[var(--border-medium)]"
                      : "bg-[var(--surface-high)] text-text-tertiary"
                }`}
              >
                {step > i + 1 ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              <span className="max-sm:hidden">{label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Step 1: Create */}
      {step === 1 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold text-foreground">Create your bot</h3>
          <div className="space-y-4 text-sm text-text-secondary">
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                1
              </span>
              <div>
                <p>
                  Open Telegram and message{" "}
                  <a
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--primary)] hover:underline inline-flex items-center gap-1"
                  >
                    @BotFather <ExternalLink className="w-3 h-3" />
                  </a>
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                2
              </span>
              <div>
                <p>
                  Send <code className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">/newbot</code> and follow the prompts
                </p>
                <p className="text-text-tertiary mt-1">
                  Pick a display name and a username ending in &quot;bot&quot;
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                3
              </span>
              <div>
                <p>Copy the token BotFather gives you</p>
                <p className="text-text-tertiary mt-1">
                  It looks like: <code className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">4839574812:AAFD39kkd...</code>
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                4
              </span>
              <div>
                <p>
                  <span className="text-text-tertiary">(Optional)</span> Send{" "}
                  <code className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">/setprivacy</code>{" "}
                  &rarr; Disable
                </p>
                <p className="text-text-tertiary mt-1">
                  Lets your bot see all group messages, not just @mentions
                </p>
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-4">
            <button onClick={() => setStep(2)} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
              I have my token <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Configure */}
      {step === 2 && (
        <div className="space-y-5">
          <h3 className="text-base font-semibold text-foreground">Configure your bot</h3>

          {/* Token input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Bot Token</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setBotUsername(null);
                    setTokenError(null);
                  }}
                  placeholder="Paste your bot token"
                  className="w-full px-3 py-2 pr-10 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-sm text-foreground placeholder:text-text-tertiary focus:outline-none focus:border-[var(--primary)]/50"
                />
                <button
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-foreground"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button
                onClick={validateToken}
                disabled={!token.trim() || validating}
                className="btn-secondary px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
              >
                {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Validate"}
              </button>
            </div>
            {botUsername && (
              <p className="text-xs text-[var(--primary)] flex items-center gap-1">
                <Check className="w-3 h-3" /> Verified: @{botUsername}
              </p>
            )}
            {tokenError && <p className="text-xs text-[var(--error)]">{tokenError}</p>}
          </div>

          {/* DM Policy */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Who can DM your agent?</label>
            <div className="space-y-2">
              {dmPolicyOptions.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                    dmPolicy === opt.value
                      ? "bg-[var(--primary)]/8 border border-[var(--primary)]/20"
                      : "hover:bg-[var(--surface-low)] border border-transparent"
                  }`}
                >
                  <input
                    type="radio"
                    name="dmPolicy"
                    value={opt.value}
                    checked={dmPolicy === opt.value}
                    onChange={() => setDmPolicy(opt.value)}
                    className="mt-0.5 accent-[var(--primary)]"
                  />
                  <div>
                    <span className="text-sm text-foreground font-medium">{opt.label}</span>
                    {opt.value === "pairing" && (
                      <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-medium">
                        recommended
                      </span>
                    )}
                    <p className="text-xs text-text-tertiary">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Group mention */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={requireMention}
                onChange={(e) => setRequireMention(e.target.checked)}
                className="accent-[var(--primary)]"
              />
              <span className="text-sm text-foreground">Require @mention in groups</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-medium">
                recommended
              </span>
            </label>
          </div>

          <div className="flex justify-between pt-4">
            <button
              onClick={() => setStep(1)}
              className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={handleConnect}
              disabled={!botUsername || connecting}
              className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-40"
            >
              {connecting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Connecting...
                </>
              ) : (
                <>
                  Connect <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Connecting / Verifying */}
      {step === 3 && (
        <div className="space-y-4">
          {(verifying || (!verifyError && !verified)) && (
            <>
              <div className="w-12 h-12 rounded-full bg-[var(--primary)]/15 flex items-center justify-center mx-auto">
                <Loader2 className="w-6 h-6 text-[var(--primary)] animate-spin" />
              </div>
              <div className="text-center">
                <h3 className="text-base font-semibold text-foreground">Setting up your Telegram bot...</h3>
                <p className="text-sm text-text-secondary mt-1">
                  Verifying that your bot is live and reachable. This may take a moment while the agent restarts.
                </p>
              </div>
            </>
          )}

          {!verifying && verifyError && (
            <>
              <div className="w-12 h-12 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6 text-amber-500" />
              </div>
              <div className="text-center">
                <h3 className="text-base font-semibold text-foreground">Verification pending</h3>
                <p className="text-sm text-text-secondary mt-1">{verifyError}</p>
              </div>
              <div className="flex justify-center gap-3 pt-4">
                <button
                  onClick={() => verifyChannel()}
                  className="btn-primary px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Retry
                </button>
                <button onClick={onClose} className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium">
                  Skip for now
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4: Verified / Success */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="w-12 h-12 rounded-full bg-[var(--primary)]/15 flex items-center justify-center mx-auto">
            <Check className="w-6 h-6 text-[var(--primary)]" />
          </div>
          <div className="text-center">
            <h3 className="text-base font-semibold text-foreground">Telegram is live!</h3>
            <p className="text-sm text-text-secondary mt-1">
              Your agent is now reachable at{" "}
              <a
                href={`https://t.me/${botUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline"
              >
                @{botUsername}
              </a>
            </p>
          </div>
          {dmPolicy === "pairing" && (
            <div className="glass-card p-4 text-sm text-text-secondary">
              <p>
                When users message your bot, they&apos;ll be automatically paired. You can manage approved devices from the Shell tab.
              </p>
            </div>
          )}
          <div className="flex justify-center gap-3 pt-4">
            <a
              href={`https://t.me/${botUsername}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2"
            >
              Open in Telegram <ExternalLink className="w-4 h-4" />
            </a>
            <button onClick={onClose} className="btn-secondary px-4 py-2 rounded-lg text-sm font-medium">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
