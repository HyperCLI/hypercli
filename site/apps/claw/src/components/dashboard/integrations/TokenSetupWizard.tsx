"use client";

import { useState } from "react";
import { ExternalLink, Check, Loader2, AlertCircle } from "lucide-react";
import type { TokenField } from "./plugin-registry";
import { usePluginVerification } from "@/hooks/usePluginVerification";
import type { ChannelProbeResult } from "@/hooks/usePluginVerification";

interface TokenSetupWizardProps {
  pluginId: string;
  displayName: string;
  fields: TokenField[];
  setupUrl?: string;
  setupHint?: string;
  skipVerification?: boolean;
  /** Config path from plugin registry — "channels.*" uses legacy shape, otherwise uses plugins.entries shape */
  configPath?: string;
  onConnect: (config: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<ChannelProbeResult>;
  onClose: () => void;
  onVerified?: () => void;
}

export function TokenSetupWizard({
  pluginId,
  displayName,
  fields,
  setupUrl,
  setupHint,
  skipVerification = false,
  configPath,
  onConnect,
  onChannelProbe,
  onClose,
  onVerified,
}: TokenSetupWizardProps) {
  const [step, setStep] = useState<"form" | "connecting" | "verifying" | "done">("form");
  const [values, setValues] = useState<Record<string, string>>({});
  const [connectError, setConnectError] = useState<string | null>(null);

  const verification = usePluginVerification({
    pluginId,
    onChannelProbe,
    onVerified: () => {
      setStep("done");
      onVerified?.();
    },
    skip: skipVerification,
  });

  const requiredMissing = fields
    .filter((f) => f.required)
    .some((f) => !values[f.key]?.trim());

  const handleConnect = async () => {
    setStep("connecting");
    setConnectError(null);
    try {
      const fieldValues: Record<string, unknown> = {};
      for (const field of fields) {
        const val = values[field.key]?.trim();
        if (val) fieldValues[field.key] = val;
      }

      // channels.* path: flat config at channels.<id> (same as Telegram/Discord/Slack)
      // plugins.entries.* path: nested config at plugins.entries.<id>.config
      const patch = configPath?.startsWith("channels.")
        ? { channels: { [pluginId]: { enabled: true, ...fieldValues } } }
        : { plugins: { entries: { [pluginId]: { enabled: true, config: fieldValues } } } };

      await onConnect(patch);

      if (skipVerification) {
        setStep("done");
        onVerified?.();
      } else {
        setStep("verifying");
        verification.startVerification();
      }
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Failed to connect");
      setStep("form");
    }
  };

  // --- Form: collect credentials ---
  if (step === "form") {
    return (
      <div className="space-y-6">
        {/* Setup hint + link */}
        {setupHint && (
          <div className="glass-card p-3 flex items-start gap-2.5">
            <div className="flex-1 text-xs text-text-secondary">
              {setupHint}
              {setupUrl && (
                <>
                  {" \u2014 "}
                  <a
                    href={setupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
                  >
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                </>
              )}
            </div>
          </div>
        )}

        {/* Input fields */}
        <div className="space-y-4">
          {fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                {field.label}
                {field.required && <span className="text-[var(--error)] ml-0.5">*</span>}
              </label>
              {field.helpText && (
                <p className="text-xs text-text-tertiary">{field.helpText}</p>
              )}
              <input
                type={field.sensitive ? "password" : "text"}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] text-sm text-foreground font-mono focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
          ))}
        </div>

        {connectError && (
          <div className="flex items-start gap-2 text-sm text-[var(--error)]">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{connectError}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConnect}
            disabled={requiredMissing}
            className="btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  // --- Connecting: saving config ---
  if (step === "connecting") {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
        <p className="text-sm text-text-secondary">Connecting {displayName}...</p>
      </div>
    );
  }

  // --- Verifying: polling channel status ---
  if (step === "verifying") {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        {verification.verifyError ? (
          <>
            <AlertCircle className="w-8 h-8 text-amber-400" />
            <p className="text-sm text-text-secondary text-center">{verification.verifyError}</p>
            <div className="flex gap-2">
              <button
                onClick={verification.retryVerification}
                className="btn-primary px-4 py-2 rounded-lg text-sm font-medium"
              >
                Retry
              </button>
              <button
                onClick={() => { setStep("done"); onVerified?.(); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
              >
                Skip
              </button>
            </div>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
            <p className="text-sm text-text-secondary">Verifying connection...</p>
          </>
        )}
      </div>
    );
  }

  // --- Done: success ---
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Check className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">{displayName} is live!</p>
          <p className="text-xs text-text-tertiary mt-1">
            {skipVerification
              ? "Connection will be established in the background."
              : "Your agent can now send and receive messages."}
          </p>
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <button onClick={onClose} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium">
          Done
        </button>
      </div>
    </div>
  );
}
