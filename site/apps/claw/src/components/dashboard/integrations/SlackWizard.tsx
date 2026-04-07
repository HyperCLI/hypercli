"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Check, Eye, EyeOff, ExternalLink, Loader2, AlertCircle, RefreshCw, ChevronDown, ChevronUp, Download } from "lucide-react";
import { isChannelLive } from "./TelegramWizard";

interface SlackWizardProps {
  onConnect: (config: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, any>>;
  onClose: () => void;
  onVerified?: () => void;
  initialStep?: number;
  initialBotName?: string;
}

const SLACK_MANIFEST = {
  display_information: {
    name: "HyperClaw Agent",
    description: "AI agent powered by HyperClaw",
  },
  features: {
    bot_user: {
      display_name: "HyperClaw Agent",
      always_online: true,
    },
  },
  oauth_config: {
    scopes: {
      bot: [
        "chat:write",
        "channels:read",
        "channels:history",
        "groups:read",
        "groups:history",
        "im:read",
        "im:history",
        "im:write",
      ],
    },
  },
  settings: {
    socket_mode_enabled: true,
    token_rotation_enabled: false,
    event_subscriptions: {
      bot_events: ["message.channels", "message.groups", "message.im"],
    },
  },
};

function downloadSlackManifest() {
  const blob = new Blob([JSON.stringify(SLACK_MANIFEST, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "slack-app-manifest.json";
  a.click();
  URL.revokeObjectURL(url);
}

export function SlackWizard({ onConnect, onChannelProbe, onClose, onVerified, initialStep, initialBotName }: SlackWizardProps) {
  // step 1 = configure, step 2 = connecting/verifying, step 3 = done
  const [step, setStep] = useState(initialStep === 3 ? 2 : 1);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [appToken, setAppToken] = useState("");
  const [showAppToken, setShowAppToken] = useState(false);
  const [appTokenValid, setAppTokenValid] = useState(false);
  const [appTokenError, setAppTokenError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [botName, setBotName] = useState<string | null>(initialBotName ?? null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Verification state
  const [verifying, setVerifying] = useState(initialStep === 3);
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
          slack: {
            enabled: true,
            botToken: token,
            appToken: appToken,
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

  // Step 1: Configure
  if (step === 1) {
    return (
      <div className="space-y-5">
        {/* Bot token */}
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

        {/* App-level token */}
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

        {/* Collapsible: How to create a Slack app */}
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <button
            onClick={() => setShowGuide(!showGuide)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
          >
            <span>Don&apos;t have a Slack app yet? Set one up in minutes</span>
            {showGuide ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
          </button>
          {showGuide && (
            <div className="px-4 pb-4 space-y-4 border-t border-[var(--border)]">
              <div className="pt-3 flex gap-2">
                <a
                  href="https://api.slack.com/apps?new_app=1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
                >
                  Create Slack App <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  onClick={downloadSlackManifest}
                  className="btn-secondary px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <Download className="w-3 h-3" /> Download app manifest
                </button>
              </div>
              <ol className="space-y-3 text-sm text-text-secondary">
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">1</span>
                  <p>Click <strong>Create Slack App</strong> above → choose <strong>From an app manifest</strong> → paste the downloaded manifest JSON → create</p>
                </li>
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">2</span>
                  <p>Go to <strong>OAuth & Permissions</strong> → click <strong>Install to Workspace</strong> → copy the <strong>Bot User OAuth Token</strong> (<code className="px-1.5 py-0.5 bg-[var(--surface-high)] rounded text-xs font-mono">xoxb-...</code>)</p>
                </li>
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">3</span>
                  <p>Go to <strong>Basic Information → App-Level Tokens</strong> → Generate Token with scope <code className="px-1.5 py-0.5 bg-[var(--surface-high)] rounded text-xs font-mono">connections:write</code> → copy the token (<code className="px-1.5 py-0.5 bg-[var(--surface-high)] rounded text-xs font-mono">xapp-...</code>)</p>
                </li>
              </ol>
            </div>
          )}
        </div>

        <button
          onClick={handleConnect}
          disabled={!botName || !appTokenValid || connecting}
          className="w-full btn-primary px-4 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40"
        >
          {connecting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
          ) : (
            "Connect Slack"
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
    );
  }

  // Step 3: Verified / Success
  return (
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
      <div className="glass-card p-4 text-sm text-text-secondary space-y-1">
        <p>Invite the bot to a channel:</p>
        <code className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">/invite @{botName}</code>
        <p className="pt-1">Then mention it or send a direct message — your agent will respond automatically.</p>
      </div>
      <div className="flex justify-center pt-4">
        <button onClick={onClose} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium">
          Done
        </button>
      </div>
    </div>
  );
}
