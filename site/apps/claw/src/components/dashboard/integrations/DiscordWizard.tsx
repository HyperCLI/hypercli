"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, ExternalLink, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { isChannelLive } from "./TelegramWizard";

interface DiscordWizardProps {
  onConnect: (config: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, any>>;
  onClose: () => void;
  onVerified?: () => void;
  initialStep?: number;
  initialBotUsername?: string;
}

export function DiscordWizard({ onConnect, onChannelProbe, onClose, onVerified, initialStep, initialBotUsername }: DiscordWizardProps) {
  const [step, setStep] = useState(initialStep ?? 1);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(initialBotUsername ?? null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [serverId, setServerId] = useState("");
  const [userId, setUserId] = useState("");
  const [connecting, setConnecting] = useState(false);

  // Verification state
  const [verifying, setVerifying] = useState(initialStep === 3);
  const [verified, setVerified] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const cancelVerifyRef = useRef(false);
  const verifyStartedRef = useRef(false);

  const validateToken = () => {
    setTokenError(null);
    setBotUsername(null);
    const trimmed = token.trim();
    if (!trimmed) {
      setTokenError("Please enter a bot token");
      return;
    }
    // Discord bot tokens are base64-encoded and contain two dots
    const parts = trimmed.split(".");
    if (parts.length < 2) {
      setTokenError("Invalid token format — Discord bot tokens contain at least two dots");
      return;
    }
    // Try to decode the first segment (bot user ID)
    try {
      const decoded = atob(parts[0]);
      if (!/^\d+$/.test(decoded)) {
        setTokenError("Invalid token — the first segment should encode a numeric bot ID");
        return;
      }
    } catch {
      setTokenError("Invalid token format — could not decode bot ID");
      return;
    }
    setBotUsername(`Bot (ID: ${atob(parts[0])})`);
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
        if (isChannelLive(status, "discord")) {
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
      const discordConfig: Record<string, unknown> = {
        enabled: true,
        token: token,
      };

      // If both server ID and user ID provided, configure guild allowlist
      const trimmedServerId = serverId.trim();
      const trimmedUserId = userId.trim();
      if (trimmedServerId && trimmedUserId) {
        discordConfig.groupPolicy = "allowlist";
        discordConfig.guilds = {
          [trimmedServerId]: {
            requireMention: true,
            users: [trimmedUserId],
          },
        };
      }

      await onConnect({
        channels: { discord: discordConfig },
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
          <h3 className="text-base font-semibold text-foreground">Create your Discord bot</h3>
          <div className="space-y-4 text-sm text-text-secondary">
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                1
              </span>
              <div>
                <p>
                  Go to the{" "}
                  <a
                    href="https://discord.com/developers/applications"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--primary)] hover:underline inline-flex items-center gap-1"
                  >
                    Discord Developer Portal <ExternalLink className="w-3 h-3" />
                  </a>{" "}
                  &rarr; <strong>New Application</strong>
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                2
              </span>
              <div>
                <p>
                  Go to the <strong>Bot</strong> tab and set the username
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                3
              </span>
              <div>
                <p>
                  <strong>Enable Privileged Intents</strong> on the Bot page:
                </p>
                <div className="mt-2 space-y-1.5">
                  <p className="flex items-center gap-1.5">
                    <span className="text-[var(--primary)]">&#10003;</span>
                    <strong>Message Content Intent</strong>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--error)]/10 text-[var(--error)] font-medium">required</span>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <span className="text-[var(--primary)]">&#10003;</span>
                    <strong>Server Members Intent</strong>
                    <span className="text-text-tertiary">(recommended)</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                4
              </span>
              <div>
                <p>
                  Click <strong>Reset Token</strong> &rarr; copy and save it securely
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                5
              </span>
              <div>
                <p>
                  Go to <strong>OAuth2 &rarr; URL Generator</strong>
                </p>
                <p className="text-text-tertiary mt-1">
                  Scopes: <code className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">bot</code>{" "}
                  <code className="px-2 py-1 bg-[var(--surface-high)] rounded text-xs font-mono">applications.commands</code>
                </p>
                <p className="text-text-tertiary mt-1">
                  Permissions: View Channels, Send Messages, Read Message History, Embed Links, Attach Files
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                6
              </span>
              <div>
                <p>Copy the generated invite URL &rarr; open in browser &rarr; add bot to your server</p>
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
                disabled={!token.trim()}
                className="btn-secondary px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
              >
                Validate
              </button>
            </div>
            {botUsername && (
              <p className="text-xs text-[var(--primary)] flex items-center gap-1">
                <Check className="w-3 h-3" /> Verified: {botUsername}
              </p>
            )}
            {tokenError && <p className="text-xs text-[var(--error)]">{tokenError}</p>}
          </div>

          {/* Optional: Server & User IDs */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-foreground">Server Setup</label>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-high)] text-text-tertiary font-medium">optional</span>
            </div>
            <p className="text-xs text-text-tertiary">
              Add your Server ID and User ID to pre-configure the guild allowlist. Enable <strong>Developer Mode</strong> in Discord (User Settings &rarr; Advanced), then right-click to copy IDs.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Server ID</label>
                <input
                  type="text"
                  value={serverId}
                  onChange={(e) => setServerId(e.target.value)}
                  placeholder="e.g. 123456789012345678"
                  className="w-full px-3 py-2 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-sm text-foreground placeholder:text-text-tertiary focus:outline-none focus:border-[var(--primary)]/50"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Your User ID</label>
                <input
                  type="text"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="e.g. 987654321098765432"
                  className="w-full px-3 py-2 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-sm text-foreground placeholder:text-text-tertiary focus:outline-none focus:border-[var(--primary)]/50"
                />
              </div>
            </div>
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
                <h3 className="text-base font-semibold text-foreground">Setting up your Discord bot...</h3>
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
            <h3 className="text-base font-semibold text-foreground">Discord is live!</h3>
            <p className="text-sm text-text-secondary mt-1">
              Your agent is now reachable as <strong>{botUsername}</strong> on Discord
            </p>
          </div>
          <div className="glass-card p-4 text-sm text-text-secondary">
            <p>
              When users DM your bot, they&apos;ll be automatically paired. You can manage approved devices from the Shell tab.
            </p>
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
