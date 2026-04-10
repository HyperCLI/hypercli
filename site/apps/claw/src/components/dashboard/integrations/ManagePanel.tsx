"use client";

import { useState } from "react";
import { Copy, Check, Terminal } from "lucide-react";

interface ManagePanelProps {
  pluginId: string;
  displayName: string;
  isVerified: boolean;
  /** Key-value pairs shown below the status (e.g., "DM Policy: pairing") */
  configDetails?: { label: string; value: string }[];
  /** Show a "Reconfigure" button that triggers this callback */
  onReconfigure?: () => void;
  /** Disconnect / remove the integration */
  onDisconnect: () => void;
  /** Show QR login command + Open Shell button (WhatsApp, Zalo Personal) */
  showShellCommand?: boolean;
  /** Switch parent view to Shell tab */
  onOpenShell?: () => void;
}

export function ManagePanel({
  pluginId,
  displayName,
  isVerified,
  configDetails,
  onReconfigure,
  onDisconnect,
  showShellCommand,
  onOpenShell,
}: ManagePanelProps) {
  const [copied, setCopied] = useState(false);
  const loginCommand = showShellCommand ? `openclaw channels login --channel ${pluginId}` : "";

  const handleCopy = async () => {
    if (!loginCommand) return;
    try {
      await navigator.clipboard.writeText(loginCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail on insecure contexts — silent fallback
    }
  };

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="glass-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isVerified ? "bg-[var(--primary)]" : "bg-amber-400"}`} />
          <span className="text-sm font-medium text-foreground">
            {isVerified ? "Connected" : showShellCommand ? "Pending — QR scan needed" : "Pending verification"}
          </span>
        </div>
        {!isVerified && showShellCommand && (
          <p className="text-xs text-text-tertiary">
            Paste the command below in the Shell tab, then scan the QR code with {displayName} on your phone.
          </p>
        )}
        {!isVerified && !showShellCommand && (
          <p className="text-xs text-text-tertiary">
            The connection may still be starting up, or the credentials may need to be updated.
          </p>
        )}
      </div>

      {/* Config details */}
      {configDetails && configDetails.length > 0 && (
        <div className="space-y-1">
          {configDetails.map((detail) => (
            <p key={detail.label} className="text-sm text-text-secondary">
              {detail.label}: <span className="text-foreground">{detail.value}</span>
            </p>
          ))}
        </div>
      )}

      {/* QR login command */}
      {showShellCommand && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-text-secondary">
            {isVerified ? "Re-pair command" : "Login command"}
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
              {copied
                ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                : <Copy className="w-3.5 h-3.5 text-text-tertiary" />
              }
            </button>
          </div>
        </div>
      )}

      {/* Open Shell button (QR-based) */}
      {showShellCommand && onOpenShell && (
        <button
          onClick={onOpenShell}
          className="w-full px-4 py-2 rounded-lg text-sm font-medium text-foreground border border-[var(--border)] hover:bg-[var(--surface-low)] transition-colors flex items-center justify-center gap-2"
        >
          <Terminal className="w-3.5 h-3.5" />
          Open Shell
        </button>
      )}

      {/* Reconfigure button */}
      {onReconfigure && (
        <button
          onClick={onReconfigure}
          className="w-full px-4 py-2 rounded-lg text-sm font-medium text-foreground border border-[var(--border)] hover:bg-[var(--surface-low)] transition-colors"
        >
          Reconfigure
        </button>
      )}

      {/* Disconnect button */}
      <button
        onClick={onDisconnect}
        className="w-full px-4 py-2 rounded-lg text-sm font-medium text-[var(--error)] border border-[var(--error)]/20 hover:bg-[var(--error)]/5 transition-colors"
      >
        Disconnect {displayName}
      </button>
    </div>
  );
}
