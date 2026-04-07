"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Check, Eye, EyeOff, ExternalLink, Loader2, AlertCircle, RefreshCw, ChevronDown, ChevronUp, Download } from "lucide-react";
import { isChannelLive } from "./TelegramWizard";

interface DiscordWizardProps {
  onConnect: (config: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, any>>;
  onClose: () => void;
  onVerified?: () => void;
  initialStep?: number;
  initialBotUsername?: string;
}

// View Channels (1<<10) + Send Messages (1<<11) + Send Messages in Threads (1<<38)
// + Embed Links (1<<14) + Attach Files (1<<15) + Read Message History (1<<16)
const DISCORD_REQUIRED_PERMISSIONS = (1024 + 2048 + 274877906944 + 16384 + 32768 + 65536);

function downloadDiscordManifest() {
  const manifest = {
    name: "HyperClaw Agent",
    description: "AI agent powered by HyperClaw",
    bot: {
      public: false,
    },
    oauth2: {
      scopes: ["bot", "applications.commands"],
      permissions: String(DISCORD_REQUIRED_PERMISSIONS),
    },
    features: [],
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "discord-app-manifest.json";
  a.click();
  URL.revokeObjectURL(url);
}

export function DiscordWizard({ onConnect, onChannelProbe, onClose, onVerified, initialStep, initialBotUsername }: DiscordWizardProps) {
  // step 1 = configure, step 2 = connecting/verifying, step 3 = done
  const [step, setStep] = useState(initialStep === 3 ? 2 : 1);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(initialBotUsername ?? null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [serverId, setServerId] = useState("");
  const [userId, setUserId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Verification state
  const [verifying, setVerifying] = useState(initialStep === 3);
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
    const parts = trimmed.split(".");
    if (parts.length < 2) {
      setTokenError("Invalid token format — Discord bot tokens contain at least two dots");
      return;
    }
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
      const discordConfig: Record<string, unknown> = {
        enabled: true,
        token: token,
      };

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

      await onConnect({ channels: { discord: discordConfig } });
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

        {/* Collapsible: How to create a bot */}
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <button
            onClick={() => setShowGuide(!showGuide)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
          >
            <span>Don&apos;t have a bot yet? Set one up in the Discord portal</span>
            {showGuide ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
          </button>
          {showGuide && (
            <div className="px-4 pb-4 space-y-4 border-t border-[var(--border)]">
              <div className="pt-3 flex gap-2">
                <a
                  href="https://discord.com/developers/applications"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
                >
                  Open Developer Portal <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  onClick={downloadDiscordManifest}
                  className="btn-secondary px-3 py-2 rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <Download className="w-3 h-3" /> Download app manifest
                </button>
              </div>
              <ol className="space-y-3 text-sm text-text-secondary">
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">1</span>
                  <p>Click <strong>New Application</strong>, then go to the <strong>Bot</strong> tab and click <strong>Reset Token</strong> — copy and save it</p>
                </li>
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">2</span>
                  <p>Enable <strong>Message Content Intent</strong> and <strong>Server Members Intent</strong> on the Bot page</p>
                </li>
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">3</span>
                  <p>Go to <strong>OAuth2 → URL Generator</strong>, select scopes <code className="px-1.5 py-0.5 bg-[var(--surface-high)] rounded text-xs font-mono">bot</code> + <code className="px-1.5 py-0.5 bg-[var(--surface-high)] rounded text-xs font-mono">applications.commands</code>, then use the generated URL to add the bot to your server</p>
                </li>
              </ol>
            </div>
          )}
        </div>

        {/* Collapsible: Advanced */}
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
          >
            <span>Advanced settings</span>
            {showAdvanced ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
          </button>
          {showAdvanced && (
            <div className="px-4 pb-4 space-y-3 border-t border-[var(--border)]">
              <p className="text-xs text-text-tertiary pt-3">
                Add your Server ID and User ID to pre-configure the guild allowlist. Enable <strong>Developer Mode</strong> in Discord (User Settings → Advanced), then right-click to copy IDs.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Server ID</label>
                  <input
                    type="text"
                    value={serverId}
                    onChange={(e) => setServerId(e.target.value)}
                    placeholder="123456789012345678"
                    className="w-full px-3 py-2 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-sm text-foreground placeholder:text-text-tertiary focus:outline-none focus:border-[var(--primary)]/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Your User ID</label>
                  <input
                    type="text"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    placeholder="987654321098765432"
                    className="w-full px-3 py-2 bg-[var(--surface-low)] border border-[var(--border)] rounded-lg text-sm text-foreground placeholder:text-text-tertiary focus:outline-none focus:border-[var(--primary)]/50"
                  />
                </div>
              </div>
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
            "Connect Discord"
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
    );
  }

  // Step 3: Verified / Success
  return (
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
          Invite the bot to your channels with <code className="px-1.5 py-0.5 bg-[var(--surface-high)] rounded text-xs font-mono">/invite @YourBot</code> and it will respond to mentions automatically.
        </p>
      </div>
      <div className="flex justify-center pt-4">
        <button onClick={onClose} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium">
          Done
        </button>
      </div>
    </div>
  );
}
