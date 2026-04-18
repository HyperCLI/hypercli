"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import { PLUGIN_REGISTRY } from "../integrations/plugin-registry";
import { getPluginDescription } from "./directory-descriptions";
import { isPluginConnected } from "./directory-utils";
import { TelegramWizard } from "../integrations/TelegramWizard";
import { DiscordWizard } from "../integrations/DiscordWizard";
import { SlackWizard } from "../integrations/SlackWizard";
import { TokenSetupWizard } from "../integrations/TokenSetupWizard";
import { QrLoginWizard } from "../integrations/QrLoginWizard";

interface DirectoryDetailProps {
  pluginId: string;
  config: Record<string, unknown> | null;
  connected: boolean;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, unknown>>;
  onOpenShell: () => void;
  onBack: () => void;
  onCloseModal: () => void;
}

export function DirectoryDetail({
  pluginId,
  config,
  connected,
  onSaveConfig,
  onChannelProbe,
  onOpenShell,
  onBack,
  onCloseModal,
}: DirectoryDetailProps) {
  const plugin = useMemo(() => PLUGIN_REGISTRY.find((p) => p.id === pluginId), [pluginId]);
  const [enabling, setEnabling] = useState(false);
  const [justEnabled, setJustEnabled] = useState(false);

  if (!plugin) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-text-muted">Integration not found.</p>
      </div>
    );
  }

  const pluginConnected = isPluginConnected(plugin.id, config);
  const description = getPluginDescription(plugin.id, plugin.description);
  const Icon = plugin.icon;

  const handleSimpleEnable = async () => {
    setEnabling(true);
    try {
      const parts = plugin.configPath.split(".");
      const patch: Record<string, unknown> = {};
      let current: Record<string, unknown> = patch;
      for (let i = 0; i < parts.length - 1; i++) {
        const next: Record<string, unknown> = {};
        current[parts[i]] = next;
        current = next;
      }
      current[parts[parts.length - 1]] = { enabled: true };
      await onSaveConfig(patch);
      setJustEnabled(true);
    } finally {
      setEnabling(false);
    }
  };

  const renderSetup = () => {
    if (pluginConnected || justEnabled) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-[#38D39F]/30 bg-[#38D39F]/5 p-4 flex items-center gap-3"
        >
          <CheckCircle2 className="w-5 h-5 text-[#38D39F] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#38D39F]">Connected</p>
            <p className="text-xs text-text-muted mt-0.5">This integration is active on your agent.</p>
          </div>
        </motion.div>
      );
    }

    if (plugin.id === "telegram") {
      return (
        <TelegramWizard
          onConnect={onSaveConfig}
          onChannelProbe={onChannelProbe}
          onClose={onBack}
          onVerified={() => setJustEnabled(true)}
        />
      );
    }

    if (plugin.id === "discord") {
      return (
        <DiscordWizard
          onConnect={onSaveConfig}
          onChannelProbe={onChannelProbe}
          onClose={onBack}
          onVerified={() => setJustEnabled(true)}
        />
      );
    }

    if (plugin.id === "slack") {
      return (
        <SlackWizard
          onConnect={onSaveConfig}
          onChannelProbe={onChannelProbe}
          onClose={onBack}
          onVerified={() => setJustEnabled(true)}
        />
      );
    }

    if (plugin.id === "whatsapp" || plugin.id === "zalouser") {
      return (
        <QrLoginWizard
          pluginId={plugin.id}
          displayName={plugin.displayName}
          onEnable={onSaveConfig}
          onOpenShell={() => { onCloseModal(); onOpenShell(); }}
          onClose={onBack}
          configPath={plugin.configPath}
        />
      );
    }

    if (plugin.setupFields && plugin.setupFields.length > 0) {
      return (
        <TokenSetupWizard
          pluginId={plugin.id}
          displayName={plugin.displayName}
          fields={plugin.setupFields}
          setupUrl={plugin.setupUrl}
          setupHint={plugin.setupHint}
          skipVerification={plugin.skipVerification}
          configPath={plugin.configPath}
          onConnect={onSaveConfig}
          onChannelProbe={onChannelProbe}
          onClose={onBack}
          onVerified={() => setJustEnabled(true)}
        />
      );
    }

    if (plugin.hasBuiltinPanel) {
      return (
        <div className="rounded-xl border border-border bg-surface-low/30 p-4">
          <p className="text-sm text-text-muted">
            This capability is included with your HyperClaw plan. It activates automatically when needed — no setup required.
          </p>
          <p className="text-xs text-text-muted mt-2">Uses pooled inference tokens.</p>
        </div>
      );
    }

    if (plugin.setupUrl || plugin.setupHint) {
      return (
        <div className="space-y-3">
          {plugin.setupHint && (
            <p className="text-sm text-text-muted">{plugin.setupHint}</p>
          )}
          {plugin.setupUrl && (
            <a
              href={plugin.setupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-[#38D39F] hover:underline"
            >
              Get API key <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <div>
            <button
              onClick={handleSimpleEnable}
              disabled={enabling}
              className="btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
            >
              {enabling ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Enable
            </button>
          </div>
        </div>
      );
    }

    return (
      <button
        onClick={handleSimpleEnable}
        disabled={enabling}
        className="btn-primary px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
      >
        {enabling ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Enable
      </button>
    );
  };

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-12 h-12 rounded-xl bg-surface-low flex items-center justify-center border border-border shrink-0">
          <Icon className="w-6 h-6 text-text-muted" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-semibold text-foreground">{plugin.displayName}</h3>
          <p className="text-sm text-text-muted mt-1">{plugin.description}</p>
        </div>
      </div>

      {/* Description */}
      <div className="mb-6">
        <p className="text-sm text-text-secondary leading-relaxed">{description}</p>
      </div>

      {/* Setup */}
      <div className="mb-6">
        <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted mb-3">Setup</h4>
        {renderSetup()}
      </div>

      {/* Info Footer */}
      <div className="border-t border-border pt-4 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-muted">Config path</span>
          <span className="text-[11px] text-text-muted font-mono">{plugin.configPath}</span>
        </div>
        {plugin.setupUrl && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-muted">Documentation</span>
            <a href={plugin.setupUrl} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-[#38D39F] hover:underline inline-flex items-center gap-1">
              Visit <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
