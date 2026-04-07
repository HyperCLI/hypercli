"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import type { PluginMeta } from "./plugin-registry";

interface PluginCardProps {
  plugin: PluginMeta;
  enabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onClick?: () => void;
}

export function PluginCard({ plugin, enabled, onToggle, onClick }: PluginCardProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = plugin.icon;

  const handleToggle = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onToggle(!enabled);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update";
      // Strip verbose internal error prefixes for a cleaner message
      const clean = msg.replace(/^(GatewayRequestError:\s*|ConfigRuntimeRefreshError:\s*)/i, "");
      setError(clean);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      handleToggle(e);
    }
  };

  return (
    <motion.button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-all duration-200 w-full ${
        saving
          ? "border-[var(--border)] bg-[var(--surface-low)] opacity-70 pointer-events-none"
          : enabled
            ? "border-[var(--primary)]/30 border-l-2 border-l-[var(--primary)] bg-[var(--primary)]/5 hover:bg-[var(--primary)]/8 hover:border-[var(--primary)]/50 hover:border-l-[var(--primary)] hover:shadow-[0_0_12px_rgba(56,211,159,0.08)]"
            : "border-[var(--border)] hover:border-[var(--primary)]/20 hover:bg-[var(--surface-low)] hover:shadow-[0_0_8px_rgba(56,211,159,0.04)]"
      }`}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
            enabled
              ? "bg-[var(--primary)]/15 text-[var(--primary)]"
              : "bg-[var(--surface-high)] text-[var(--text-secondary)]"
          }`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">{plugin.displayName}</span>
            <div
              role="switch"
              tabIndex={0}
              aria-checked={enabled}
              aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.displayName}`}
              onClick={handleToggle}
              onKeyDown={handleToggleKeyDown}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 ${
                enabled ? "bg-[var(--primary)]" : "bg-[var(--surface-high)]"
              }`}
            >
              {saving ? (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-3 h-3 animate-spin text-white" />
                </span>
              ) : (
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out mt-0.5 ${
                    enabled ? "translate-x-4 ml-0.5" : "translate-x-0 ml-0.5"
                  }`}
                />
              )}
            </div>
          </div>
          {error ? (
            <p className="text-xs text-[var(--error)] mt-1 line-clamp-2">{error}</p>
          ) : plugin.description ? (
            <p className="text-xs text-text-tertiary mt-1 line-clamp-2">{plugin.description}</p>
          ) : null}
          {enabled && onClick && !error && (
            <span className="text-xs text-[var(--primary)] font-medium mt-2 inline-block">
              Configure →
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}
