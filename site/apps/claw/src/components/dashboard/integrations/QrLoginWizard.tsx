"use client";

import { useState } from "react";
import { Loader2, Smartphone, ArrowRight } from "lucide-react";

interface QrLoginWizardProps {
  pluginId: string;
  displayName: string;
  /** Enable the plugin via config patch */
  onEnable: (patch: Record<string, unknown>) => Promise<void>;
  /** Switch the parent view to the Shell tab */
  onOpenShell?: () => void;
  onClose: () => void;
  /** Config path from plugin registry — "channels.*" uses legacy shape, otherwise uses plugins.entries shape */
  configPath?: string;
  /** Trigger web/QR login flow so the QR code appears in Shell */
  onWebLoginStart?: (options?: { force?: boolean; verbose?: boolean; accountId?: string }) => Promise<Record<string, any>>;
}

export function QrLoginWizard({
  pluginId,
  displayName,
  onEnable,
  onOpenShell,
  onClose,
  configPath,
  onWebLoginStart,
}: QrLoginWizardProps) {
  const [step, setStep] = useState<"intro" | "enabling">("intro");
  const [error, setError] = useState<string | null>(null);

  const handleEnable = async () => {
    setStep("enabling");
    setError(null);
    try {
      // channels.* path: flat config at channels.<id> (same as Telegram/Discord/Slack)
      // plugins.entries.* path: nested config at plugins.entries.<id>
      const patch = configPath?.startsWith("channels.")
        ? { channels: { [pluginId]: { enabled: true } } }
        : { plugins: { entries: { [pluginId]: { enabled: true } } } };

      await onEnable(patch);
      // Trigger the QR login flow so the QR code appears in Shell
      onWebLoginStart?.({ force: true, accountId: pluginId });
      // Auto-open Shell tab so user can scan the QR code immediately
      onClose();
      onOpenShell?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable plugin");
      setStep("intro");
    }
  };

  // --- Intro: explain the setup process ---
  if (step === "intro") {
    return (
      <div className="space-y-6">
        <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
          <Smartphone className="w-6 h-6 text-[var(--primary)]" />
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">Connect {displayName}</p>
          <p className="text-xs text-text-tertiary mt-1">
            Link your {displayName} account by scanning a QR code.
          </p>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-medium text-foreground">How it works</h4>
          <ol className="space-y-3 text-sm text-text-secondary">
            <li className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-xs font-medium flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
              <span>We&apos;ll enable the {displayName} plugin on your agent</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-xs font-medium flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
              <span>Open the <span className="font-medium text-foreground">Shell</span> tab — a QR code will appear</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-xs font-medium flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
              <span>
                Open {displayName} on your phone →{" "}
                <span className="text-foreground font-medium">Settings</span> →{" "}
                <span className="text-foreground font-medium">Linked Devices</span> →{" "}
                <span className="text-foreground font-medium">Link a Device</span>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-xs font-medium flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
              <span>Scan the QR code — your agent will start receiving messages</span>
            </li>
          </ol>
        </div>

        {error && (
          <p className="text-xs text-[var(--error)]">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleEnable}
            className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            Enable {displayName}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // --- Enabling: spinner while config patch is applied ---
  if (step === "enabling") {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
          <p className="text-sm text-text-secondary">Enabling {displayName}...</p>
        </div>
      </div>
    );
  }

  // Unreachable — enabling step always transitions to Shell via onClose + onOpenShell
  return null;
}
