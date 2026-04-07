"use client";

import { useState } from "react";
import { Check, Loader2, Smartphone, Terminal, ArrowRight } from "lucide-react";

interface QrLoginWizardProps {
  pluginId: string;
  displayName: string;
  /** Enable the plugin via config patch */
  onEnable: (patch: Record<string, unknown>) => Promise<void>;
  /** Switch the parent view to the Shell tab */
  onOpenShell?: () => void;
  onClose: () => void;
}

export function QrLoginWizard({
  pluginId,
  displayName,
  onEnable,
  onOpenShell,
  onClose,
}: QrLoginWizardProps) {
  const [step, setStep] = useState<"intro" | "enabling" | "ready">("intro");
  const [error, setError] = useState<string | null>(null);

  const handleEnable = async () => {
    setStep("enabling");
    setError(null);
    try {
      await onEnable({
        plugins: {
          entries: {
            [pluginId]: { enabled: true },
          },
        },
      });
      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable plugin");
      setStep("intro");
    }
  };

  const handleOpenShell = () => {
    onClose();
    onOpenShell?.();
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

  // --- Ready: plugin enabled, direct user to Shell ---
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Check className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">{displayName} plugin enabled</p>
          <p className="text-xs text-text-tertiary mt-1">Now open the Shell tab to scan the QR code.</p>
        </div>
      </div>

      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Terminal className="w-4 h-4 text-[var(--primary)]" />
          Next step: Scan QR code
        </div>
        <p className="text-xs text-text-tertiary">
          A QR code will appear in the Shell tab. Open {displayName} on your phone, go to{" "}
          <span className="text-text-secondary">Linked Devices</span>, and scan it.
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
        >
          Close
        </button>
        {onOpenShell && (
          <button
            onClick={handleOpenShell}
            className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
          >
            <Terminal className="w-3.5 h-3.5" />
            Open Shell
          </button>
        )}
      </div>
    </div>
  );
}
