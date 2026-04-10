"use client";

import React, { useEffect, useState } from "react";
import {
  Send, MessageCircle, Hash, Phone, MessageSquare,
  Volume2, Mic, Eye, Image, Video, Box, Loader2,
  Check, Search, X,
} from "lucide-react";
import { IntegrationCard, type CardStatus } from "./IntegrationCard";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@hypercli/shared-ui";
import { SlideOver } from "../SlideOver";
import { TelegramWizard } from "./TelegramWizard";
import { DiscordWizard } from "./DiscordWizard";
import { SlackWizard } from "./SlackWizard";
import { TtsPanel } from "./TtsPanel";
import { SttPanel } from "./SttPanel";
import { VisionPanel } from "./VisionPanel";
import { ImagesPanel } from "./ImagesPanel";
import { VideoPanel } from "./VideoPanel";
import { ThreeDPanel } from "./ThreeDPanel";
import { ConfirmDialog } from "../ConfirmDialog";
import { PluginCard } from "./PluginCard";
import { PluginConfigPanel, getProviderCredentials } from "./PluginConfigPanel";
import { ManagePanel } from "./ManagePanel";
import { QrLoginWizard } from "./QrLoginWizard";
import { TokenSetupWizard } from "./TokenSetupWizard";
import { getPlugin, getPluginsByCategory, isPluginEnabled, countEnabledInCategory } from "./plugin-registry";
import type { PluginMeta } from "./plugin-registry";
import { isChannelLive } from "@/hooks/usePluginVerification";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/gateway";

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

function matchesSearch(plugin: PluginMeta, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    plugin.displayName.toLowerCase().includes(q) ||
    plugin.description.toLowerCase().includes(q) ||
    plugin.id.toLowerCase().includes(q)
  );
}

function nameMatchesSearch(name: string, query: string): boolean {
  if (!query) return true;
  return name.toLowerCase().includes(query.toLowerCase());
}

/** Panel identifiers: legacy literals for existing wizards/panels, "plugin:<id>" for dynamic plugin panels */
type PanelType = string | null;

interface IntegrationsPageProps {
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  connected: boolean;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe?: () => Promise<Record<string, any>>;
  /** Switch the parent view to the Shell tab (for QR-based plugins) */
  onOpenShell?: () => void;
}

interface ChannelState {
  telegram?: { enabled?: boolean; botToken?: string; username?: string };
  discord?: { enabled?: boolean; token?: string; groupPolicy?: string };
  slack?: { enabled?: boolean; botToken?: string; appToken?: string };
}

interface PrefsState {
  voice?: { speaker?: string; format?: string };
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] === null) {
      delete result[key];
    } else if (
      typeof source[key] === "object" && !Array.isArray(source[key]) &&
      typeof result[key] === "object" && result[key] !== null
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function IntegrationsPage({ config: initialConfig, configSchema, connected, onSaveConfig, onChannelProbe, onOpenShell }: IntegrationsPageProps) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(initialConfig);
  const [activePanel, setActivePanel] = useState<PanelType>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const [applyingChanges, setApplyingChanges] = useState(false);
  const [search, setSearch] = useState("");
  // Consolidated verified state for all channels/plugins
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const markVerified = (id: string) => setVerified((prev) => ({ ...prev, [id]: true }));
  const clearVerified = (id: string) => setVerified((prev) => ({ ...prev, [id]: false }));

  // Sync when parent config updates
  useEffect(() => {
    if (initialConfig) setConfig(initialConfig);
  }, [initialConfig]);

  // Clear "applying changes" overlay when gateway reconnects
  useEffect(() => {
    if (connected && applyingChanges) setApplyingChanges(false);
  }, [connected, applyingChanges]);

  // Legacy channel enabled state
  const channels = (config as any)?.channels as ChannelState | undefined;
  const telegramEnabled = !!channels?.telegram?.enabled;
  const discordEnabled = !!channels?.discord?.enabled;
  const slackEnabled = !!channels?.slack?.enabled;

  // Wizard-enabled channels — includes both channels.* and plugins.entries.* paths
  // Order matters: determines card rendering order in the grid
  const wizardPluginIds = ["msteams", "googlechat", "whatsapp", "zalouser", "zalo", "line", "twitch", "irc", "mattermost"] as const;
  const wizardPlugins = wizardPluginIds.reduce<Record<string, { meta: PluginMeta | undefined; enabled: boolean }>>((acc, id) => {
    const meta = getPlugin(id);
    acc[id] = { meta, enabled: meta ? isPluginEnabled(meta, config) : false };
    return acc;
  }, {});

  // Probe channel status on mount / reconnect
  useEffect(() => {
    if (!connected || !onChannelProbe) return;
    const anyEnabled = telegramEnabled || discordEnabled || slackEnabled ||
      wizardPluginIds.some((id) => wizardPlugins[id].enabled);
    if (!anyEnabled) return;
    let cancelled = false;
    onChannelProbe().then((status) => {
      if (cancelled) return;
      // Legacy channels
      if (telegramEnabled && isChannelLive(status, "telegram")) markVerified("telegram");
      if (discordEnabled && isChannelLive(status, "discord")) markVerified("discord");
      if (slackEnabled && isChannelLive(status, "slack")) markVerified("slack");
      // Plugin-based channels
      for (const id of wizardPluginIds) {
        if (wizardPlugins[id].enabled && isChannelLive(status, id)) markVerified(id);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [connected, onChannelProbe, telegramEnabled, discordEnabled, slackEnabled, config]);

  // Reset verified state when channels are disconnected
  useEffect(() => {
    if (!telegramEnabled) clearVerified("telegram");
    if (!discordEnabled) clearVerified("discord");
    if (!slackEnabled) clearVerified("slack");
    for (const id of wizardPluginIds) {
      if (!wizardPlugins[id].enabled) clearVerified(id);
    }
  }, [telegramEnabled, discordEnabled, slackEnabled, config]);

  const integrations = (config as any)?.integrations as { voice?: PrefsState["voice"] } | undefined;

  const handleConfigPatch = async (patch: Record<string, unknown>) => {
    if (!connected) throw new Error("Not connected to agent");
    setApplyingChanges(true);
    try {
      await onSaveConfig(patch);
      // Optimistically merge patch into local state
      setConfig(prev => prev ? deepMerge(prev, patch) : patch);
    } catch (err) {
      setApplyingChanges(false);
      throw err;
    }
  };

  const handleDisconnect = async (target: string) => {
    const plugin = getPlugin(target);
    if (plugin?.configPath?.startsWith("channels.")) {
      // channels.* path (Telegram, Discord, Slack, Teams, Google Chat, WhatsApp, Zalo, etc.)
      await handleConfigPatch({ channels: { [target]: null } });
    } else {
      // plugins.entries.* path (LINE, Mattermost, Twitch, IRC, etc.)
      await handleConfigPatch({ plugins: { entries: { [target]: { enabled: false } } } });
    }
    setDisconnectTarget(null);
    setActivePanel(null);
  };

  const getTelegramStatus = (): { status: CardStatus; statusText?: string; cta?: string } => {
    if (telegramEnabled && verified["telegram"]) {
      return {
        status: "connected",
        statusText: channels?.telegram?.username
          ? `@${channels.telegram.username}`
          : "Active",
        cta: "Manage",
      };
    }
    if (telegramEnabled && !verified["telegram"]) {
      return {
        status: "pending",
        statusText: "Pending verification",
        cta: "Complete setup \u2192",
      };
    }
    return { status: "available", cta: "Set up \u2192" };
  };

  const telegramInfo = getTelegramStatus();

  // Show a non-destructive overlay instead of replacing the entire page,
  // so that any open SlideOver stays visible during gateway reconnection.
  const showWaitingOverlay = !connected && !applyingChanges;

  const chatPlugins = getPluginsByCategory("chat");
  const chatActiveCount = countEnabledInCategory("chat", config);
  const aiPlugins = getPluginsByCategory("ai-providers");
  const aiActiveCount = countEnabledInCategory("ai-providers", config);
  const toolPlugins = getPluginsByCategory("tools");
  const toolActiveCount = countEnabledInCategory("tools", config);

  const handlePluginToggle = async (pluginId: string, enabled: boolean) => {
    const plugin = getPlugin(pluginId);

    if (plugin?.category === "ai-providers") {
      if (enabled) {
        // Turning ON: if key already exists, directly enable. Otherwise open config panel.
        const creds = getProviderCredentials(pluginId, config);
        if (creds.hasExistingKey) {
          await handleConfigPatch({
            plugins: { entries: { [pluginId]: { enabled: true } } },
          });
          return;
        }
        setActivePanel(`plugin:${pluginId}`);
      } else {
        // Turning OFF: directly disable without opening panel
        await handleConfigPatch({
          plugins: { entries: { [pluginId]: { enabled: false } } },
        });
      }
      return;
    }

    await handleConfigPatch({
      plugins: { entries: { [pluginId]: { enabled } } },
    });
  };

  return (
    <div className="p-6 h-full overflow-y-auto relative">
      {/* Overlay while gateway restarts after config change */}
      {applyingChanges && !connected && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--background)]/80 backdrop-blur-sm rounded-lg">
          <div className="flex items-center gap-3 text-sm text-text-secondary">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--primary)]" />
            Applying changes...
          </div>
        </div>
      )}
      {/* Overlay while waiting for initial gateway connection */}
      {showWaitingOverlay && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--background)]/80 backdrop-blur-sm rounded-lg">
          <div className="flex items-center gap-3 text-sm text-text-secondary">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--primary)]" />
            Waiting for gateway connection...
          </div>
        </div>
      )}
      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search integrations..."
          className="w-full pl-9 pr-9 py-2.5 rounded-lg bg-[var(--surface-low)] border border-[var(--border)] text-sm text-foreground placeholder:text-text-tertiary focus:outline-none focus:border-[var(--primary)] transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--border)]/50 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-text-tertiary" />
          </button>
        )}
      </div>
      <Accordion type="multiple" defaultValue={["channels", "built-in", ...(aiActiveCount > 0 ? ["ai-providers"] : []), ...(toolActiveCount > 0 ? ["tools"] : [])]} className="pb-8">
        {/* Chat & Messaging */}
        <AccordionItem value="channels" className="border-b border-[var(--border)] last:border-b-0">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground text-left">Chat & Messaging</h3>
                <p className="text-xs text-text-tertiary mt-0.5 text-left">
                  Give your agent a presence on messaging platforms
                </p>
              </div>
              {chatActiveCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] text-xs font-medium">
                  {chatActiveCount} active
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Telegram — existing wizard */}
              {nameMatchesSearch("Telegram Bot API grammY", search) && (
                <IntegrationCard
                  icon={Send}
                  name="Telegram"
                  status={telegramInfo.status}
                  statusText={telegramInfo.statusText}
                  ctaLabel={telegramInfo.cta}
                  onClick={() => setActivePanel(
                    telegramEnabled && verified["telegram"]
                      ? "telegram-manage"
                      : telegramEnabled
                        ? "telegram-verify"
                        : "telegram"
                  )}
                />
              )}
              {/* Discord — existing wizard */}
              {nameMatchesSearch("Discord servers channels DMs", search) && (
                <IntegrationCard
                  icon={MessageCircle}
                  name="Discord"
                  status={discordEnabled && verified["discord"] ? "connected" : discordEnabled ? "pending" : "available"}
                  statusText={discordEnabled && verified["discord"] ? "Active" : discordEnabled ? "Pending verification" : undefined}
                  ctaLabel={discordEnabled && verified["discord"] ? "Manage" : discordEnabled ? "Complete setup \u2192" : "Set up \u2192"}
                  onClick={() => setActivePanel(
                    discordEnabled && verified["discord"]
                      ? "discord-manage"
                      : discordEnabled
                        ? "discord-verify"
                        : "discord"
                  )}
                />
              )}
              {/* Slack — existing wizard */}
              {nameMatchesSearch("Slack workspace apps Bolt", search) && (
                <IntegrationCard
                  icon={Hash}
                  name="Slack"
                  status={slackEnabled && verified["slack"] ? "connected" : slackEnabled ? "pending" : "available"}
                  statusText={slackEnabled && verified["slack"] ? "Active" : slackEnabled ? "Pending verification" : undefined}
                  ctaLabel={slackEnabled && verified["slack"] ? "Manage" : slackEnabled ? "Complete setup \u2192" : "Set up \u2192"}
                  onClick={() => setActivePanel(
                    slackEnabled && verified["slack"]
                      ? "slack-manage"
                      : slackEnabled
                        ? "slack-verify"
                        : "slack"
                  )}
                />
              )}
              {/* Token-based wizard plugins (Teams, Google Chat, Zalo Bot, LINE, Twitch, IRC, Mattermost) */}
              {wizardPluginIds
                .filter((id) => wizardPlugins[id].meta?.setupFields && id !== "whatsapp" && id !== "zalouser" && (wizardPlugins[id].meta ? matchesSearch(wizardPlugins[id].meta!, search) : true))
                .map((id) => {
                  const { meta, enabled } = wizardPlugins[id];
                  if (!meta) return null;
                  const isVerified = verified[id];
                  return (
                    <IntegrationCard
                      key={id}
                      icon={meta.icon}
                      name={meta.displayName}
                      status={enabled && isVerified ? "connected" : enabled ? "pending" : "available"}
                      statusText={enabled && isVerified ? "Active" : enabled ? "Pending verification" : undefined}
                      ctaLabel={enabled ? "Manage" : "Set up \u2192"}
                      onClick={() => setActivePanel(
                        enabled ? `${id}-manage` : id
                      )}
                    />
                  );
                })}
              {/* WhatsApp — QR wizard */}
              {nameMatchesSearch("WhatsApp QR code", search) && (
                <IntegrationCard
                  icon={Phone}
                  name="WhatsApp"
                  status={wizardPlugins["whatsapp"].enabled && verified["whatsapp"] ? "connected" : wizardPlugins["whatsapp"].enabled ? "pending" : "available"}
                  statusText={wizardPlugins["whatsapp"].enabled && verified["whatsapp"] ? "Active" : wizardPlugins["whatsapp"].enabled ? "Pending verification" : undefined}
                  ctaLabel={wizardPlugins["whatsapp"].enabled && verified["whatsapp"] ? "Manage" : wizardPlugins["whatsapp"].enabled ? "Manage" : "Set up \u2192"}
                  onClick={() => setActivePanel(
                    wizardPlugins["whatsapp"].enabled
                      ? "whatsapp-manage"
                      : "whatsapp"
                  )}
                />
              )}
              {/* Zalo Personal — QR wizard */}
              {nameMatchesSearch("Zalo Personal QR code", search) && (
                <IntegrationCard
                  icon={MessageSquare}
                  name="Zalo Personal"
                status={wizardPlugins["zalouser"].enabled && verified["zalouser"] ? "connected" : wizardPlugins["zalouser"].enabled ? "pending" : "available"}
                statusText={wizardPlugins["zalouser"].enabled && verified["zalouser"] ? "Active" : wizardPlugins["zalouser"].enabled ? "Pending verification" : undefined}
                ctaLabel={wizardPlugins["zalouser"].enabled && verified["zalouser"] ? "Manage" : wizardPlugins["zalouser"].enabled ? "Manage" : "Set up \u2192"}
                onClick={() => setActivePanel(
                  wizardPlugins["zalouser"].enabled
                    ? "zalouser-manage"
                    : "zalouser"
                )}
              />
              )}
              {/* Remaining chat plugins — dynamic PluginCards */}
              {chatPlugins
                .filter((p) => !p.hasWizard && matchesSearch(p, search))
                .map((plugin) => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    enabled={isPluginEnabled(plugin, config)}
                    onToggle={(enabled) => handlePluginToggle(plugin.id, enabled)}
                    onClick={() => setActivePanel(`plugin:${plugin.id}`)}
                  />
                ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Built-in Capabilities */}
        <AccordionItem value="built-in" className="border-b border-[var(--border)] last:border-b-0">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground text-left">Built-in Capabilities</h3>
                <p className="text-xs text-text-tertiary mt-0.5 text-left">
                  Your agent already has these superpowers
                </p>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] text-xs font-medium">
                6 active
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {nameMatchesSearch("Voice TTS speak aloud", search) && (
                <IntegrationCard
                  icon={Volume2}
                  name="Voice"
                  status="built-in"
                  description="Speak aloud with 9 voices or clone any voice"
                  statusText={integrations?.voice?.speaker ? `Speaker: ${integrations.voice.speaker}` : "Qwen3-TTS"}
                  ctaLabel="Customize \u2192"
                  onClick={() => setActivePanel("tts")}
                />
              )}
              {nameMatchesSearch("Speech STT transcribe audio whisper", search) && (
                <IntegrationCard
                  icon={Mic}
                  name="Speech"
                  status="built-in"
                  description="Transcribes any audio file"
                  statusText="faster-whisper turbo"
                  ctaLabel="Details →"
                  onClick={() => setActivePanel("stt")}
                />
              )}
              {nameMatchesSearch("Vision image understanding", search) && (
                <IntegrationCard
                  icon={Eye}
                  name="Vision"
                  status="built-in"
                  description="Understands images in chat"
                  statusText="Kimi K2.5 + vision models"
                  ctaLabel="Details →"
                  onClick={() => setActivePanel("vision")}
                />
              )}
              {nameMatchesSearch("Images generation text-to-image", search) && (
                <IntegrationCard
                  icon={Image}
                  name="Images"
                  status="built-in"
                  description="Text-to-image & image editing"
                  statusText="Qwen-Image + HiDream"
                  ctaLabel="Details →"
                  onClick={() => setActivePanel("images")}
                />
              )}
              {nameMatchesSearch("Video generation", search) && (
                <IntegrationCard
                  icon={Video}
                  name="Video"
                  status="built-in"
                  description="Text & image to video"
                  statusText="Wan 2.2 + HuMo"
                  ctaLabel="Details →"
                  onClick={() => setActivePanel("video")}
                />
              )}
              {nameMatchesSearch("3D model generation", search) && (
                <IntegrationCard
                  icon={Box}
                  name="3D"
                  status="built-in"
                  description="Image to 3D model"
                  statusText="Hunyuan3D 2.1"
                  ctaLabel="Details →"
                  onClick={() => setActivePanel("3d")}
                />
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* AI Model Providers */}
        <AccordionItem value="ai-providers" className="border-b border-[var(--border)] last:border-b-0">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground text-left">AI Model Providers</h3>
                <p className="text-xs text-text-tertiary mt-0.5 text-left">
                  Connect external AI model providers
                </p>
              </div>
              {aiActiveCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] text-xs font-medium">
                  {aiActiveCount} active
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {aiPlugins.filter((p) => matchesSearch(p, search)).map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  enabled={isPluginEnabled(plugin, config)}
                  onToggle={(enabled) => handlePluginToggle(plugin.id, enabled)}
                  onClick={() => setActivePanel(`plugin:${plugin.id}`)}
                />
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Tools & Services */}
        <AccordionItem value="tools" className="border-b border-[var(--border)] last:border-b-0">
          <AccordionTrigger className="hover:no-underline py-4">
            <div className="flex items-center gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground text-left">Tools & Services</h3>
                <p className="text-xs text-text-tertiary mt-0.5 text-left">
                  Search, speech, media, memory, and automation
                </p>
              </div>
              {toolActiveCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] text-xs font-medium">
                  {toolActiveCount} active
                </span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {toolPlugins.filter((p) => matchesSearch(p, search)).map((plugin) => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  enabled={isPluginEnabled(plugin, config)}
                  onToggle={(enabled) => handlePluginToggle(plugin.id, enabled)}
                  onClick={() => setActivePanel(`plugin:${plugin.id}`)}
                />
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Telegram Setup Wizard */}
      <SlideOver
        open={activePanel === "telegram" || activePanel === "telegram-verify"}
        onClose={() => setActivePanel(null)}
        title="Connect Telegram"
        description="Give your agent a Telegram presence"
      >
        <TelegramWizard
          key={activePanel === "telegram-verify" ? "verify" : "setup"}
          onConnect={handleConfigPatch}
          onChannelProbe={onChannelProbe ?? (async () => ({}))}
          initialStep={activePanel === "telegram-verify" ? 3 : undefined}
          initialBotUsername={activePanel === "telegram-verify" ? channels?.telegram?.username : undefined}
          onClose={() => {
            setActivePanel(null);
            // Re-probe after wizard closes to update card status
            if (onChannelProbe && channels?.telegram?.enabled) {
              onChannelProbe().then((status) => {
                if (isChannelLive(status, "telegram")) {
                  markVerified("telegram");
                }
              }).catch(() => {});
            }
          }}
          onVerified={() => markVerified("telegram")}
        />
      </SlideOver>

      {/* Bespoke channel management panels (Telegram, Discord, Slack) */}
      {([
        { id: "telegram", displayName: "Telegram", setupPanel: "telegram", configDetails: [
          { label: "DM Policy", value: (channels?.telegram as any)?.dmPolicy || "pairing" },
          ...(channels?.telegram?.username ? [{ label: "Username", value: `@${channels.telegram.username}` }] : []),
        ] },
        { id: "discord", displayName: "Discord", setupPanel: "discord", configDetails: undefined },
        { id: "slack", displayName: "Slack", setupPanel: "slack", configDetails: undefined },
      ] satisfies { id: string; displayName: string; setupPanel: string; configDetails?: { label: string; value: string }[] }[]).map((ch) => (
        <SlideOver
          key={`${ch.id}-manage`}
          open={activePanel === `${ch.id}-manage`}
          onClose={() => setActivePanel(null)}
          title={ch.displayName}
          description={`Your agent's ${ch.displayName} connection`}
        >
          <ManagePanel
            pluginId={ch.id}
            displayName={ch.displayName}
            isVerified={!!verified[ch.id]}
            configDetails={ch.configDetails}
            onReconfigure={() => setActivePanel(ch.setupPanel)}
            onDisconnect={() => setDisconnectTarget(ch.id)}
          />
        </SlideOver>
      ))}

      {/* Discord Setup Wizard */}
      <SlideOver
        open={activePanel === "discord" || activePanel === "discord-verify"}
        onClose={() => setActivePanel(null)}
        title="Connect Discord"
        description="Give your agent a Discord presence"
      >
        <DiscordWizard
          key={activePanel === "discord-verify" ? "verify" : "setup"}
          onConnect={handleConfigPatch}
          onChannelProbe={onChannelProbe ?? (async () => ({}))}
          initialStep={activePanel === "discord-verify" ? 3 : undefined}
          initialBotUsername={activePanel === "discord-verify" ? "Discord Bot" : undefined}
          onClose={() => {
            setActivePanel(null);
            if (onChannelProbe && channels?.discord?.enabled) {
              onChannelProbe().then((status) => {
                if (isChannelLive(status, "discord")) markVerified("discord");
              }).catch(() => {});
            }
          }}
          onVerified={() => markVerified("discord")}
        />
      </SlideOver>

      {/* Slack Setup Wizard */}
      <SlideOver
        open={activePanel === "slack" || activePanel === "slack-verify"}
        onClose={() => setActivePanel(null)}
        title="Connect Slack"
        description="Give your agent a Slack presence"
      >
        <SlackWizard
          key={activePanel === "slack-verify" ? "verify" : "setup"}
          onConnect={handleConfigPatch}
          onChannelProbe={onChannelProbe ?? (async () => ({}))}
          initialStep={activePanel === "slack-verify" ? 3 : undefined}
          initialBotName={activePanel === "slack-verify" ? "Slack Bot" : undefined}
          onClose={() => {
            setActivePanel(null);
            if (onChannelProbe && channels?.slack?.enabled) {
              onChannelProbe().then((status) => {
                if (isChannelLive(status, "slack")) markVerified("slack");
              }).catch(() => {});
            }
          }}
          onVerified={() => markVerified("slack")}
        />
      </SlideOver>

      {/* QR-based channels — setup + manage (WhatsApp, Zalo Personal) */}
      {([
        { id: "whatsapp", displayName: "WhatsApp", description: "Pair your WhatsApp account via QR code" },
        { id: "zalouser", displayName: "Zalo Personal", description: "Pair your Zalo account via QR code" },
      ] as const).map((qr) => (
        <React.Fragment key={qr.id}>
          <SlideOver
            open={activePanel === qr.id}
            onClose={() => setActivePanel(null)}
            title={`Connect ${qr.displayName}`}
            description={qr.description}
          >
            <QrLoginWizard
              pluginId={qr.id}
              displayName={qr.displayName}
              onEnable={handleConfigPatch}
              onOpenShell={onOpenShell}
              onClose={() => setActivePanel(null)}
              configPath={getPlugin(qr.id)?.configPath}
            />
          </SlideOver>
          <SlideOver
            open={activePanel === `${qr.id}-manage`}
            onClose={() => setActivePanel(null)}
            title={qr.displayName}
            description={`Your agent's ${qr.displayName} connection`}
          >
            <ManagePanel
              pluginId={qr.id}
              displayName={qr.displayName}
              isVerified={!!verified[qr.id]}
              showShellCommand
              onOpenShell={() => { setActivePanel(null); onOpenShell?.(); }}
              onDisconnect={() => setDisconnectTarget(qr.id)}
            />
          </SlideOver>
        </React.Fragment>
      ))}

      {/* Token-based plugin wizards (Zalo Bot, LINE, Twitch, IRC, Mattermost) */}
      {wizardPluginIds
        .filter((id) => wizardPlugins[id].meta?.setupFields && id !== "whatsapp" && id !== "zalouser")
        .map((id) => {
          const meta = wizardPlugins[id].meta!;
          return (
            <SlideOver
              key={`${id}-setup`}
              open={activePanel === id}
              onClose={() => setActivePanel(null)}
              title={`Connect ${meta.displayName}`}
              description={meta.description}
            >
              <TokenSetupWizard
                pluginId={id}
                displayName={meta.displayName}
                fields={meta.setupFields!}
                setupUrl={meta.setupUrl}
                setupHint={meta.setupHint}
                skipVerification={meta.skipVerification}
                configPath={meta.configPath}
                onConnect={handleConfigPatch}
                onChannelProbe={onChannelProbe ?? (async () => ({}))}
                onClose={() => {
                  setActivePanel(null);
                  if (onChannelProbe && wizardPlugins[id].enabled) {
                    onChannelProbe().then((status) => {
                      if (isChannelLive(status, id)) markVerified(id);
                    }).catch(() => {});
                  }
                }}
                onVerified={() => markVerified(id)}
              />
            </SlideOver>
          );
        })}

      {/* Token-based plugin management panels */}
      {wizardPluginIds
        .filter((id) => wizardPlugins[id].meta?.setupFields && id !== "whatsapp" && id !== "zalouser")
        .map((id) => {
          const meta = wizardPlugins[id].meta!;
          return (
            <SlideOver
              key={`${id}-manage`}
              open={activePanel === `${id}-manage`}
              onClose={() => setActivePanel(null)}
              title={meta.displayName}
              description={`Your agent's ${meta.displayName} connection`}
            >
              <ManagePanel
                pluginId={id}
                displayName={meta.displayName}
                isVerified={!!verified[id]}
                onReconfigure={() => setActivePanel(id)}
                onDisconnect={() => setDisconnectTarget(id)}
              />
            </SlideOver>
          );
        })}

      {/* Built-in capability panels */}
      {([
        { id: "tts", title: "Voice (TTS)", description: "Configure your agent's speaking voice",
          render: () => <TtsPanel currentSpeaker={integrations?.voice?.speaker} currentFormat={integrations?.voice?.format} onSave={handleConfigPatch} onClose={() => setActivePanel(null)} /> },
        { id: "stt", title: "Speech Recognition", description: "Audio transcription capabilities",
          render: () => <SttPanel onClose={() => setActivePanel(null)} /> },
        { id: "vision", title: "Vision", description: "Image understanding capabilities",
          render: () => <VisionPanel onClose={() => setActivePanel(null)} /> },
        { id: "images", title: "Image Generation", description: "Text-to-image and image editing",
          render: () => <ImagesPanel onClose={() => setActivePanel(null)} /> },
        { id: "video", title: "Video Generation", description: "Text, image, and audio to video",
          render: () => <VideoPanel onClose={() => setActivePanel(null)} /> },
        { id: "3d", title: "3D Generation", description: "Image to 3D model generation",
          render: () => <ThreeDPanel onClose={() => setActivePanel(null)} /> },
      ] as const).map((panel) => (
        <SlideOver
          key={panel.id}
          open={activePanel === panel.id}
          onClose={() => setActivePanel(null)}
          title={panel.title}
          description={panel.description}
        >
          {panel.render()}
        </SlideOver>
      ))}

      {/* Generic Plugin Config Panel */}
      {(() => {
        const pluginId = activePanel?.startsWith("plugin:") ? activePanel.slice(7) : null;
        const pluginMeta = pluginId ? getPlugin(pluginId) : null;
        return (
          <SlideOver
            open={!!pluginMeta}
            onClose={() => setActivePanel(null)}
            title={pluginMeta?.displayName ?? "Plugin"}
            description={pluginMeta?.description ?? ""}
          >
            {pluginMeta && (
              <PluginConfigPanel
                plugin={pluginMeta}
                config={config}
                configSchema={configSchema}
                onSave={handleConfigPatch}
                onClose={() => setActivePanel(null)}
              />
            )}
          </SlideOver>
        );
      })()}

      {/* Disconnect Confirmation */}
      <ConfirmDialog
        open={!!disconnectTarget}
        title="Disconnect channel"
        message={`Remove your agent's ${disconnectTarget} presence? You can reconnect later.`}
        confirmLabel="Disconnect"
        danger
        onConfirm={() => disconnectTarget && handleDisconnect(disconnectTarget)}
        onCancel={() => setDisconnectTarget(null)}
      />
    </div>
  );
}
