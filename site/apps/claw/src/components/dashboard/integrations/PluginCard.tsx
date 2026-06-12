"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { Loader2 } from "lucide-react";
import { ResourceCard } from "@hypercli/shared-ui";
import type { PluginMeta } from "./plugin-registry";

interface PluginCardProps {
  plugin: PluginMeta;
  enabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onClick?: () => void;
}

export function PluginCard({ plugin, enabled, onToggle, onClick }: PluginCardProps) {
  const [saving, setSaving] = useState(false);
  const Icon = plugin.icon;

  const handleToggle = async (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await onToggle(!enabled);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      void handleToggle(event);
    }
  };

  const trailing = (
    <div
      role="switch"
      tabIndex={0}
      aria-checked={enabled}
      aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.displayName}`}
      onClick={handleToggle}
      onKeyDown={handleToggleKeyDown}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--selection-accent-rgb)_/_0.5)] ${
        enabled ? "bg-[var(--button-primary)]" : "bg-[var(--surface-high)]"
      }`}
    >
      {saving ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-3 w-3 animate-spin text-white" />
        </span>
      ) : (
        <span
          className={`pointer-events-none mt-0.5 inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
            enabled ? "ml-0.5 translate-x-4" : "ml-0.5 translate-x-0"
          }`}
        />
      )}
    </div>
  );

  return (
    <ResourceCard
      icon={Icon}
      title={plugin.displayName}
      status={saving ? "saving" : enabled ? "active" : "available"}
      description={plugin.description}
      ctaLabel={enabled && onClick ? "Configure →" : undefined}
      trailing={trailing}
      onClick={onClick}
      disabled={saving}
    />
  );
}
