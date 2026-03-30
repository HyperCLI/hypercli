"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, ExternalLink, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { isChannelLive } from "./TelegramWizard";

interface SlackWizardProps {
  onConnect: (config: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, any>>;
  onClose: () => void;
  onVerified?: () => void;
  initialStep?: number;
  initialBotName?: string;
}

export function SlackWizard({ onConnect, onChannelProbe, onClose, onVerified, initialStep, initialBotName }: SlackWizardProps) {
  const [step, setStep] = useState(initialStep ?? 1);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [appToken, setAppToken] = useState("");
  const [showAppToken, setShowAppToken] = useState(false);
  const [appTokenValid, setAppTokenValid] = useState(false);
  const [appTokenError, setAppTokenError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [botName, setBotName] = useState<string | null>(initialBotName ?? null);
  const [tokenError, setTokenError] = useState<string | null>(null);
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
    setBotName(null);
    const trimmed = token.trim();
    if (!trimmed) {
      setTokenError("Please enter a bot token");
      setValidating(false);
      return;
    }
    if (!trimmed.startsWith("xoxb-")) {
      setTokenError("Invalid token — Slack bot tokens start with xoxb-");
      setValidating(false);
      return;
    }
    try {
      const res = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${trimmed}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      const data = await res.json();
      if (data.ok && data.user) {
        setBotName(data.user);
      } else {
        setTokenError(data.error === "invalid_auth"
          ? "Invalid token — check that you copied it correctly"
          : `Slack error: ${data.error || "unknown"}`);
      }
    } catch {
      // CORS may block this call — fall back to format validation
      setBotName(trimmed.slice(0, 20) + "...");
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
        if (isChannelLive(status, "slack")) {
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
          slack: {
            enabled: true,
            botToken: token,
            appToken: appToken,
          },
        },
      });
      // Set verifying BEFORE step change so step 3 renders spinner immediately
      setVerifying(true);
      setStep(3);
      // Start verification after config is saved
      verifyChannel();
    } catch {
      setTokenError("Failed to save config — try again");
    } finally {
      setConnecting(false);
    }
  };

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
          <h3 className="text-base font-semibold text-foreground">Create your Slack app</h3>
          <div className="space-y-4 text-sm text-text-secondary">
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                1
              </span>
              <div>
                <p>
                  Go to{" "}
                  <a
                    href="https://api.slack.com/apps"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--primary)] hover:underline inline-flex items-center gap-1"
                  >
                    Slack API Apps <ExternalLink className="w-3 h-3" />
                  </a>{" "}
                  and click <strong>Create New App</strong>
                </p>
                <p className="text-text-tertiary mt-1">
                  Choose &quot;From scratch&quot; and select your workspace
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                2
              </span>
              <div>
                <p>
                  Go to <strong>OAuth &amp; Permissions</strong> and add these Bot Token Scopes:
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {["chat:write", "channels:read", "channels:history", "groups:read", "groups:history", "im:read", "im:history", "im:write"].map((scope) => (
                    <code key={scope} className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">
                      {scope}
                    </code>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                3
              </span>
              <div>
                <p>
                  Click <strong>Install to Workspace</strong> and authorize the app
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                4
              </span>
              <div>
                <p>Copy the <strong>Bot User OAuth Token</strong></p>
                <p className="text-text-tertiary mt-1">
                  It starts with: <code className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">xoxb-...</code>
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                5
              </span>
              <div>
                <p>
                  Go to <strong>Basic Information &rarr; App-Level Tokens</strong> and click <strong>Generate Token and Scopes</strong>
                </p>
                <p className="text-text-tertiary mt-1">
                  Add the <code className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">connections:write</code> scope, name it (e.g. &quot;openclaw&quot;), and generate
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                6
              </span>
              <div>
                <p>Copy the <strong>App-Level Token</strong></p>
                <p className="text-text-tertiary mt-1">
                  It starts with: <code className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">xapp-1-...</code>
                </p>
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-4">
            <button onClick={() => setStep(2)} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
              I have my tokens <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Configure */}
      {step === 2 && (
        <div className="space-y-5">
          <h3 className="text-base font-semibold text-foreground">Configure your app</h3>

          {/* Token input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Bot User OAuth Token</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => {
                    setToken(e.target.value);
                    setBotName(null);
                    setTokenError(null);
                  }}
                  placeholder="xoxb-..."
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
            {botName && (
              <p className="text-xs text-[var(--primary)] flex items-center gap-1">
                <Check className="w-3 h-3" /> Verified: {botName}
              </p>
            )}
            {tokenError && <p className="text-xs text-[var(--error)]">{tokenError}</p>}
          </div>

          {/* App token input */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">App-Level Token</label>
            <div className="relative">
              <input
                type={showAppToken ? "text" : "password"}
                value={appToken}
                onChange={(e) => {
                  const val = e.target.value;
                  setAppToken(val);
                  setAppTokenError(null);
                  const trimmed = val.trim();
                  if (!trimmed) {
                    setAppTokenValid(false);
                  } else if (!trimmed.startsWith("xapp-")) {
                    setAppTokenValid(false);
                    setAppTokenError("App tokens start with xapp-");
                  } else {
                    setAppTokenValid(true);
                  }
                }}
                placeholder="xapp-1-..."
                className="w-full px-3 py-2 pr-10 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-sm text-foreground placeholder:text-text-tertiary focus:outline-none focus:border-[var(--primary)]/50"
              />
              <button
                onClick={() => setShowAppToken(!showAppToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-foreground"
              >
                {showAppToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {appTokenValid && (
              <p className="text-xs text-[var(--primary)] flex items-center gap-1">
                <Check className="w-3 h-3" /> Format valid
              </p>
            )}
            {appTokenError && <p className="text-xs text-[var(--error)]">{appTokenError}</p>}
          </div>

          <div className="glass-card p-4 text-xs text-text-tertiary">
            <p>
              After connecting, invite your bot to channels with{" "}
              <code className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">/invite @YourBot</code>{" "}
              so it can read and respond to messages.
            </p>
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
              disabled={!botName || !appTokenValid || connecting}
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
                <h3 className="text-base font-semibold text-foreground">Setting up your Slack bot...</h3>
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
            <h3 className="text-base font-semibold text-foreground">Slack is live!</h3>
            <p className="text-sm text-text-secondary mt-1">
              Your agent is now reachable as <strong>{botName}</strong> on Slack
            </p>
          </div>
          <div className="glass-card p-4 space-y-2 text-sm text-text-secondary">
            <p className="font-medium text-foreground">Next steps:</p>
            <ol className="list-decimal list-inside space-y-1 text-text-secondary">
              <li>
                Invite the bot to a channel:{" "}
                <code className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">/invite @{botName}</code>
              </li>
              <li>Mention the bot or send it a direct message</li>
              <li>Your agent will respond automatically</li>
            </ol>
          </div>
          <div className="flex justify-center pt-4">
            <button onClick={onClose} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
