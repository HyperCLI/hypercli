"use client";

import { useState } from "react";
import { Copy, Check, Terminal, ExternalLink } from "lucide-react";

export interface CliSetupStep {
  label: string;
  command: string;
  helpText?: string;
  helpUrl?: string;
}

interface CliSetupWizardProps {
  displayName: string;
  description?: string;
  steps: CliSetupStep[];
  onOpenShell: () => void;
  onClose: () => void;
}

export function CliSetupWizard({
  displayName,
  description,
  steps,
  onOpenShell,
  onClose,
}: CliSetupWizardProps) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleCopy = async (command: string, idx: number) => {
    await navigator.clipboard.writeText(command);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const handleOpenShell = () => {
    onClose();
    onOpenShell();
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-foreground">Set up {displayName}</p>
        {description && (
          <p className="text-xs text-text-tertiary mt-1">{description}</p>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-4">
        {steps.map((step, idx) => (
          <div key={idx} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] text-xs font-medium flex items-center justify-center flex-shrink-0">
                {idx + 1}
              </span>
              <span className="text-sm font-medium text-foreground">{step.label}</span>
            </div>

            {step.helpText && (
              <p className="text-xs text-text-tertiary ml-7">
                {step.helpText}
                {step.helpUrl && (
                  <>
                    {" — "}
                    <a
                      href={step.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[var(--primary)] hover:underline"
                    >
                      Open <ExternalLink className="w-3 h-3" />
                    </a>
                  </>
                )}
              </p>
            )}

            {/* Command box */}
            <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] p-3 ml-7">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Terminal className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />
                <code className="text-xs text-foreground font-mono truncate">{step.command}</code>
              </div>
              {!step.command.startsWith("#") && (
                <button
                  onClick={() => handleCopy(step.command, idx)}
                  className="flex-shrink-0 p-1.5 rounded-md hover:bg-[var(--border)]/50 transition-colors"
                  title="Copy command"
                >
                  {copiedIdx === idx
                    ? <Check className="w-3.5 h-3.5 text-emerald-400" />
                    : <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                  }
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
        >
          Close
        </button>
        <button
          onClick={handleOpenShell}
          className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
        >
          <Terminal className="w-3.5 h-3.5" />
          Open Shell
        </button>
      </div>
    </div>
  );
}
