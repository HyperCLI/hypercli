"use client";

import { useEffect, useState } from "react";
import {
  Send, MessageCircle, Hash,
  Volume2, Mic, Eye, Image, Video, Box, Loader2,
} from "lucide-react";
import { IntegrationCard, type CardStatus } from "./IntegrationCard";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@hypercli/shared-ui";
import { SlideOver } from "../SlideOver";
import { TelegramWizard, isChannelLive } from "./TelegramWizard";
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
import { PluginConfigPanel } from "./PluginConfigPanel";
import { getPlugin, getPluginsByCategory, isPluginEnabled, countEnabledInCategory } from "./plugin-registry";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/gateway";

/** Panel identifiers: legacy literals for existing wizards/panels, "plugin:<id>" for dynamic plugin panels */
type PanelType = string | null;

interface IntegrationsPageProps {
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  connected: boolean;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe?: () => Promise<Record<string, any>>;
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

export function IntegrationsPage({ config: initialConfig, configSchema, connected, onSaveConfig, onChannelProbe }: IntegrationsPageProps) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(initialConfig);
  const [activePanel, setActivePanel] = useState<PanelType>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);
  const [applyingChanges, setApplyingChanges] = useState(false);
  const [telegramVerified, setTelegramVerified] = useState(false);
  const [discordVerified, setDiscordVerified] = useState(false);
  const [slackVerified, setSlackVerified] = useState(false);

  // Sync when parent config updates
  useEffect(() => {
    if (initialConfig) setConfig(initialConfig);
  }, [initialConfig]);

  // Clear "applying changes" overlay when gateway reconnects
  useEffect(() => {
    if (connected && applyingChanges) setApplyingChanges(false);
  }, [connected, applyingChanges]);

  const channels = (config as any)?.channels as ChannelState | undefined;
  const telegramEnabled = !!channels?.telegram?.enabled;
  const discordEnabled = !!channels?.discord?.enabled;
  const slackEnabled = !!channels?.slack?.enabled;

  // Probe channel status on mount / reconnect to determine verified state
  useEffect(() => {
    if (!connected || !onChannelProbe) return;
    if (!telegramEnabled && !discordEnabled && !slackEnabled) return;
    let cancelled = false;
    onChannelProbe().then((status) => {
      if (cancelled) return;
      if (telegramEnabled && isChannelLive(status, "telegram")) setTelegramVerified(true);
      if (discordEnabled && isChannelLive(status, "discord")) setDiscordVerified(true);
      if (slackEnabled && isChannelLive(status, "slack")) setSlackVerified(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [connected, onChannelProbe, telegramEnabled, discordEnabled, slackEnabled]);

  // Reset verified state when channels are disconnected
  useEffect(() => {
    if (!telegramEnabled) setTelegramVerified(false);
    if (!discordEnabled) setDiscordVerified(false);
    if (!slackEnabled) setSlackVerified(false);
  }, [telegramEnabled, discordEnabled, slackEnabled]);

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

  const handleDisconnect = async (channel: string) => {
    await handleConfigPatch({ channels: { [channel]: null } });
    setDisconnectTarget(null);
    setActivePanel(null);
  };

  const getTelegramStatus = (): { status: CardStatus; statusText?: string; cta?: string } => {
    if (telegramEnabled && telegramVerified) {
      return {
        status: "connected",
        statusText: channels?.telegram?.username
          ? `@${channels.telegram.username}`
          : "Active",
        cta: "Manage",
      };
    }
    if (telegramEnabled && !telegramVerified) {
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

    // AI providers: when enabling, open the config panel so user can enter API key
    // in a single flow. The panel handles both enable + credentials in one save.
    if (plugin?.category === "ai-providers" && enabled) {
      setActivePanel(`plugin:${pluginId}`);
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
              <IntegrationCard
                icon={Send}
                name="Telegram"
                status={telegramInfo.status}
                statusText={telegramInfo.statusText}
                ctaLabel={telegramInfo.cta}
                onClick={() => setActivePanel(
                  telegramEnabled && telegramVerified
                    ? "telegram-manage"
                    : telegramEnabled
                      ? "telegram-verify"
                      : "telegram"
                )}
              />
              {/* Discord — existing wizard */}
              <IntegrationCard
                icon={MessageCircle}
                name="Discord"
                status={discordEnabled && discordVerified ? "connected" : discordEnabled ? "pending" : "available"}
                statusText={discordEnabled && discordVerified ? "Active" : discordEnabled ? "Pending verification" : undefined}
                ctaLabel={discordEnabled && discordVerified ? "Manage" : discordEnabled ? "Complete setup \u2192" : "Set up \u2192"}
                onClick={() => setActivePanel(
                  discordEnabled && discordVerified
                    ? "discord-manage"
                    : discordEnabled
                      ? "discord-verify"
                      : "discord"
                )}
              />
              {/* Slack — existing wizard */}
              <IntegrationCard
                icon={Hash}
                name="Slack"
                status={slackEnabled && slackVerified ? "connected" : slackEnabled ? "pending" : "available"}
                statusText={slackEnabled && slackVerified ? "Active" : slackEnabled ? "Pending verification" : undefined}
                ctaLabel={slackEnabled && slackVerified ? "Manage" : slackEnabled ? "Complete setup \u2192" : "Set up \u2192"}
                onClick={() => setActivePanel(
                  slackEnabled && slackVerified
                    ? "slack-manage"
                    : slackEnabled
                      ? "slack-verify"
                      : "slack"
                )}
              />
              {/* Remaining 19 chat plugins — dynamic PluginCards */}
              {chatPlugins
                .filter((p) => !p.hasWizard)
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
              <IntegrationCard
                icon={Volume2}
                name="Voice"
                status="built-in"
                description="9 preset speakers + voice cloning"
                statusText={integrations?.voice?.speaker ? `Speaker: ${integrations.voice.speaker}` : "Qwen3-TTS"}
                ctaLabel="Customize \u2192"
                onClick={() => setActivePanel("tts")}
              />
              <IntegrationCard
                icon={Mic}
                name="Speech"
                status="built-in"
                description="Transcribes any audio file"
                statusText="faster-whisper turbo"
                ctaLabel="Learn more"
                onClick={() => setActivePanel("stt")}
              />
              <IntegrationCard
                icon={Eye}
                name="Vision"
                status="built-in"
                description="Understands images in chat"
                statusText="Kimi K2.5 + vision models"
                ctaLabel="Learn more"
                onClick={() => setActivePanel("vision")}
              />
              <IntegrationCard
                icon={Image}
                name="Images"
                status="built-in"
                description="Text-to-image & image editing"
                statusText="Qwen-Image + HiDream"
                ctaLabel="Learn more"
                onClick={() => setActivePanel("images")}
              />
              <IntegrationCard
                icon={Video}
                name="Video"
                status="built-in"
                description="Text & image to video"
                statusText="Wan 2.2 + HuMo"
                ctaLabel="Learn more"
                onClick={() => setActivePanel("video")}
              />
              <IntegrationCard
                icon={Box}
                name="3D"
                status="built-in"
                description="Image to 3D model"
                statusText="Hunyuan3D 2.1"
                ctaLabel="Learn more"
                onClick={() => setActivePanel("3d")}
              />
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
              {aiPlugins.map((plugin) => (
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
              {toolPlugins.map((plugin) => (
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
                  setTelegramVerified(true);
                }
              }).catch(() => {});
            }
          }}
          onVerified={() => setTelegramVerified(true)}
        />
      </SlideOver>

      {/* Telegram Management */}
      <SlideOver
        open={activePanel === "telegram-manage"}
        onClose={() => setActivePanel(null)}
        title="Telegram"
        description="Your agent's Telegram connection"
      >
        <div className="space-y-4">
          <div className="glass-card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--primary)]" />
              <span className="text-sm font-medium text-foreground">Connected</span>
            </div>
            <p className="text-sm text-text-secondary">
              DM Policy: {(channels?.telegram as any)?.dmPolicy || "pairing"}
            </p>
          </div>
          <button
            onClick={() => setDisconnectTarget("telegram")}
            className="w-full px-4 py-2 rounded-lg text-sm font-medium text-[var(--error)] border border-[var(--error)]/20 hover:bg-[var(--error)]/5 transition-colors"
          >
            Disconnect Telegram
          </button>
        </div>
      </SlideOver>

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
                if (isChannelLive(status, "discord")) setDiscordVerified(true);
              }).catch(() => {});
            }
          }}
          onVerified={() => setDiscordVerified(true)}
        />
      </SlideOver>

      {/* Discord Management */}
      <SlideOver
        open={activePanel === "discord-manage"}
        onClose={() => setActivePanel(null)}
        title="Discord"
        description="Your agent's Discord connection"
      >
        <div className="space-y-4">
          <div className="glass-card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--primary)]" />
              <span className="text-sm font-medium text-foreground">Connected</span>
            </div>
          </div>
          <button
            onClick={() => setDisconnectTarget("discord")}
            className="w-full px-4 py-2 rounded-lg text-sm font-medium text-[var(--error)] border border-[var(--error)]/20 hover:bg-[var(--error)]/5 transition-colors"
          >
            Disconnect Discord
          </button>
        </div>
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
                if (isChannelLive(status, "slack")) setSlackVerified(true);
              }).catch(() => {});
            }
          }}
          onVerified={() => setSlackVerified(true)}
        />
      </SlideOver>

      {/* Slack Management */}
      <SlideOver
        open={activePanel === "slack-manage"}
        onClose={() => setActivePanel(null)}
        title="Slack"
        description="Your agent's Slack connection"
      >
        <div className="space-y-4">
          <div className="glass-card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--primary)]" />
              <span className="text-sm font-medium text-foreground">Connected</span>
            </div>
          </div>
          <button
            onClick={() => setDisconnectTarget("slack")}
            className="w-full px-4 py-2 rounded-lg text-sm font-medium text-[var(--error)] border border-[var(--error)]/20 hover:bg-[var(--error)]/5 transition-colors"
          >
            Disconnect Slack
          </button>
        </div>
      </SlideOver>

      {/* TTS Panel */}
      <SlideOver
        open={activePanel === "tts"}
        onClose={() => setActivePanel(null)}
        title="Voice (TTS)"
        description="Configure your agent's speaking voice"
      >
        <TtsPanel
          currentSpeaker={integrations?.voice?.speaker}
          currentFormat={integrations?.voice?.format}
          onSave={handleConfigPatch}
          onClose={() => setActivePanel(null)}
        />
      </SlideOver>

      {/* STT Panel */}
      <SlideOver
        open={activePanel === "stt"}
        onClose={() => setActivePanel(null)}
        title="Speech Recognition"
        description="Audio transcription capabilities"
      >
        <SttPanel onClose={() => setActivePanel(null)} />
      </SlideOver>

      {/* Vision Panel */}
      <SlideOver
        open={activePanel === "vision"}
        onClose={() => setActivePanel(null)}
        title="Vision"
        description="Image understanding capabilities"
      >
        <VisionPanel onClose={() => setActivePanel(null)} />
      </SlideOver>

      {/* Images Panel */}
      <SlideOver
        open={activePanel === "images"}
        onClose={() => setActivePanel(null)}
        title="Image Generation"
        description="Text-to-image and image editing"
      >
        <ImagesPanel onClose={() => setActivePanel(null)} />
      </SlideOver>

      {/* Video Panel */}
      <SlideOver
        open={activePanel === "video"}
        onClose={() => setActivePanel(null)}
        title="Video Generation"
        description="Text, image, and audio to video"
      >
        <VideoPanel onClose={() => setActivePanel(null)} />
      </SlideOver>

      {/* 3D Panel */}
      <SlideOver
        open={activePanel === "3d"}
        onClose={() => setActivePanel(null)}
        title="3D Generation"
        description="Image to 3D model generation"
      >
        <ThreeDPanel onClose={() => setActivePanel(null)} />
      </SlideOver>

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
