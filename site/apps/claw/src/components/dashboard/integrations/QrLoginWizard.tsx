"use client";

import { useState } from "react";
import { Loader2, Smartphone, ArrowRight, Copy, Check, Terminal } from "lucide-react";

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
}

export function QrLoginWizard({
  pluginId,
  displayName,
  onEnable,
  onOpenShell,
  onClose,
  configPath,
}: QrLoginWizardProps) {
  const [step, setStep] = useState<"intro" | "enabling">("intro");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCopyCheck, setShowCopyCheck] = useState(false);

  const loginCommand = `openclaw channels login --channel ${pluginId}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(loginCommand);
    setCopied(true);
    setShowCopyCheck(true);
    setTimeout(() => setShowCopyCheck(false), 2000);
  };

  const handleEnable = async () => {
    setStep("enabling");
    setError(null);
    try {
      const patch = configPath?.startsWith("channels.")
        ? { channels: { [pluginId]: { enabled: true } } }
        : { plugins: { entries: { [pluginId]: { enabled: true } } } };

      await onEnable(patch);
      onClose();
      onOpenShell?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable plugin");
      setStep("intro");
    }
  };

  // --- Intro: explain the setup process + copy command ---
  if (step === "intro") {
    return (
      <div className="space-y-6">
        <div className="w-12 h-12 rounded-full bg-[var(--primary)]/10 flex items-center justify-center">
          <Smartphone className="w-6 h-6 text-[var(--primary)]" />
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">Connect {displayName}</p>
          <p className="text-xs text-text-tertiary mt-1">
            Link your {displayName} account by scanning a QR code in the Shell tab.
          </p>
        </div>

        {/* Login command — copy first */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-secondary">
            Step 1: Copy this command
          </p>
          <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] p-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Terminal className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
              <code className="text-xs text-foreground font-mono truncate">{loginCommand}</code>
            </div>
            <button
              onClick={handleCopy}
              className="flex-shrink-0 p-1.5 rounded-md hover:bg-[var(--border)]/50 transition-colors"
              title="Copy command"
            >
              {showCopyCheck
                ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                : <Copy className="w-3.5 h-3.5 text-text-tertiary" />
              }
            </button>
          </div>
        </div>

        {/* Steps after enable */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-secondary">
            Step 2: After clicking Enable below
          </p>
          <ol className="space-y-2 text-xs text-text-secondary">
            <li className="flex items-start gap-2.5">
              <span className="w-4 h-4 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-[10px] font-medium flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
              <span>The Shell tab will open automatically</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-4 h-4 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-[10px] font-medium flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
              <span>Paste the command above and press Enter — a QR code will appear</span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="w-4 h-4 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-[10px] font-medium flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
              <span>Open {displayName} on your phone and scan the QR code to link your account</span>
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
            disabled={!copied}
            className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {copied ? "Enable & Open Shell" : "Copy command first"}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // --- Enabling: spinner while config patch is applied ---
  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
        <p className="text-sm text-text-secondary">Enabling {displayName}...</p>
      </div>
    </div>
  );
}
