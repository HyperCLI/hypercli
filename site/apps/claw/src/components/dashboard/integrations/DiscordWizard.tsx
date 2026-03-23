"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, ExternalLink, Loader2 } from "lucide-react";

interface DiscordWizardProps {
  onConnect: (config: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export function DiscordWizard({ onConnect, onClose }: DiscordWizardProps) {
  const [step, setStep] = useState(1);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [validating, setValidating] = useState(false);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const validateToken = () => {
    setValidating(true);
    setTokenError(null);
    setBotUsername(null);
    // Discord API does not allow CORS from browsers, so we validate the
    // token format client-side. The actual token is validated server-side
    // when OpenClaw connects to Discord.
    const trimmed = token.trim();
    if (!trimmed) {
      setTokenError("Please enter a bot token");
      setValidating(false);
      return;
    }
    // Discord bot tokens are base64-encoded and contain two dots
    const parts = trimmed.split(".");
    if (parts.length < 2) {
      setTokenError("Invalid token format — Discord bot tokens contain at least two dots");
      setValidating(false);
      return;
    }
    // Try to decode the first segment (bot user ID)
    try {
      const decoded = atob(parts[0]);
      if (!/^\d+$/.test(decoded)) {
        setTokenError("Invalid token — the first segment should encode a numeric bot ID");
        setValidating(false);
        return;
      }
    } catch {
      setTokenError("Invalid token format — could not decode bot ID");
      setValidating(false);
      return;
    }
    setBotUsername(`Bot (ID: ${atob(parts[0])})`);
    setValidating(false);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await onConnect({
        channels: {
          discord: {
            enabled: true,
            botToken: token,
          },
        },
      });
      setStep(3);
    } catch {
      setTokenError("Failed to save config — try again");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs text-text-tertiary">
        {["Create", "Configure", "Connect"].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            {i > 0 && <div className="w-6 h-px bg-[var(--border)]" />}
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
          <div className="space-y-3 text-sm text-text-secondary">
            <div className="flex gap-3">
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
                  </a>
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                2
              </span>
              <div>
                <p>
                  Click <strong>New Application</strong>, give it a name, then go to the <strong>Bot</strong> tab
                </p>
                <p className="text-text-tertiary mt-1">
                  Click &quot;Reset Token&quot; to generate a bot token and copy it
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                3
              </span>
              <div>
                <p>
                  Go to <strong>OAuth2 &rarr; URL Generator</strong>
                </p>
                <p className="text-text-tertiary mt-1">
                  Select <code className="px-1.5 py-0.5 bg-[var(--surface-high)] rounded text-xs font-mono">bot</code> scope, then add <strong>Send Messages</strong> and <strong>Read Message History</strong> permissions
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-[var(--surface-high)] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0 mt-0.5">
                4
              </span>
              <div>
                <p>Copy the generated URL and open it to invite the bot to your server</p>
              </div>
            </div>
          </div>
          <div className="flex justify-end pt-2">
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
                <Check className="w-3 h-3" /> Verified: {botUsername}
              </p>
            )}
            {tokenError && <p className="text-xs text-[var(--error)]">{tokenError}</p>}
          </div>

          <div className="glass-card p-3 text-xs text-text-tertiary">
            <p>
              Make sure your bot has been invited to at least one server. The bot will respond to messages in channels it has access to.
            </p>
          </div>

          <div className="flex justify-between pt-2">
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

      {/* Step 3: Success */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="w-12 h-12 rounded-full bg-[var(--primary)]/15 flex items-center justify-center mx-auto">
            <Check className="w-6 h-6 text-[var(--primary)]" />
          </div>
          <div className="text-center">
            <h3 className="text-base font-semibold text-foreground">Discord connected!</h3>
            <p className="text-sm text-text-secondary mt-1">
              Your agent is now reachable as <strong>{botUsername}</strong> on Discord
            </p>
          </div>
          <div className="glass-card p-4 space-y-2 text-sm text-text-secondary">
            <p className="font-medium text-foreground">To start chatting:</p>
            <ol className="list-decimal list-inside space-y-1 text-text-secondary">
              <li>Go to a server where your bot has been invited</li>
              <li>Mention the bot or send a DM</li>
              <li>Your agent will respond automatically</li>
            </ol>
          </div>
          <div className="flex justify-center pt-2">
            <button onClick={onClose} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
