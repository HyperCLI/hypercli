"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Check, Eye, EyeOff, ExternalLink, Loader2, AlertCircle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

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
  // step 1 = configure, step 2 = connecting/verifying, step 3 = done
  const [step, setStep] = useState(initialStep === 3 ? 2 : 1);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [validating, setValidating] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(initialBotUsername ?? null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [dmPolicy, setDmPolicy] = useState<DmPolicy>("pairing");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [requireMention, setRequireMention] = useState(true);
  const [connecting, setConnecting] = useState(false);

  // Verification state
  const [verifying, setVerifying] = useState(initialStep === 3);
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
          setVerifying(false);
          setStep(3);
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
      setVerifying(true);
      setStep(2);
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

  // Step 1: Configure (token input + optional advanced settings)
  if (step === 1) {
    return (
      <div className="space-y-5">
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

        {/* Collapsible: How to get a token */}
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <button
            onClick={() => setShowGuide(!showGuide)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
          >
            <span>Don&apos;t have a bot yet? Get a token in 60 seconds</span>
            {showGuide ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
          </button>
          {showGuide && (
            <div className="px-4 pb-4 space-y-3 text-sm text-text-secondary border-t border-[var(--border)]">
              <ol className="space-y-3 pt-3">
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">1</span>
                  <p>
                    Open Telegram and message{" "}
                    <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline inline-flex items-center gap-1">
                      @BotFather <ExternalLink className="w-3 h-3" />
                    </a>
                  </p>
                </li>
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">2</span>
                  <p>
                    Send <code className="px-1.5 py-0.5 bg-[var(--surface-high)] rounded text-xs font-mono">/newbot</code> and follow the prompts to pick a name and username
                  </p>
                </li>
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">3</span>
                  <p>Copy the token BotFather gives you — it looks like <code className="px-1.5 py-0.5 bg-[var(--surface-high)] rounded text-xs font-mono">4839574812:AAFD39kkd...</code></p>
                </li>
              </ol>
            </div>
          )}
        </div>

        {/* Collapsible: Advanced settings */}
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
          >
            <span>Advanced settings</span>
            {showAdvanced ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
          </button>
          {showAdvanced && (
            <div className="px-4 pb-4 space-y-4 border-t border-[var(--border)]">
              <div className="space-y-2 pt-3">
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
          )}
        </div>

        <button
          onClick={handleConnect}
          disabled={!botUsername || connecting}
          className="w-full btn-primary px-4 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {connecting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
          ) : (
            "Connect Telegram"
          )}
        </button>
      </div>
    );
  }

  // Step 2: Connecting / Verifying
  if (step === 2) {
    return (
      <div className="space-y-4">
        {(verifying || !verifyError) && (
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
    );
  }

  // Step 3: Verified / Success
  return (
    <div className="space-y-4">
      <div className="w-12 h-12 rounded-full bg-[var(--primary)]/15 flex items-center justify-center mx-auto">
        <Check className="w-6 h-6 text-[var(--primary)]" />
      </div>
      <div className="text-center">
        <h3 className="text-base font-semibold text-foreground">Telegram is live!</h3>
        <p className="text-sm text-text-secondary mt-1">
          {botUsername ? (
            <>
              Your agent is now reachable at{" "}
              <a
                href={`https://t.me/${botUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--primary)] hover:underline"
              >
                @{botUsername}
              </a>
            </>
          ) : (
            "Your Telegram bot is now live and connected."
          )}
        </p>
      </div>
      {dmPolicy === "pairing" && (
        <div className="glass-card p-4 text-sm text-text-secondary">
          <p>
            When users message your bot, they&apos;ll be automatically paired. You can manage approved users from the Shell tab.
          </p>
        </div>
      )}
      <div className="flex justify-center gap-3 pt-4">
        {botUsername && (
          <a
            href={`https://t.me/${botUsername}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary px-4 py-2 rounded-lg text-sm font-medium inline-flex items-center gap-2"
          >
            Open in Telegram <ExternalLink className="w-4 h-4" />
          </a>
        )}
        <button onClick={onClose} className={botUsername ? "btn-secondary px-4 py-2 rounded-lg text-sm font-medium" : "btn-primary px-4 py-2 rounded-lg text-sm font-medium"}>
          Done
        </button>
      </div>
    </div>
  );
}
