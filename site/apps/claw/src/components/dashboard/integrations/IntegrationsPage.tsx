"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Send, MessageCircle, Hash, MessageSquareMore, Mail, Phone,
  Volume2, Mic, Eye, Image, Video, Box,
} from "lucide-react";
import { IntegrationCard, type CardStatus } from "./IntegrationCard";
import { SlideOver } from "../SlideOver";
import { TelegramWizard } from "./TelegramWizard";
import { TtsPanel } from "./TtsPanel";
import { SttPanel } from "./SttPanel";
import { ConfirmDialog } from "../ConfirmDialog";
import type { GatewayClient } from "../../../gateway-client";

type PanelType =
  | "telegram"
  | "telegram-manage"
  | "tts"
  | "stt"
  | null;

interface IntegrationsPageProps {
  gatewayClient: GatewayClient | null;
}

interface ChannelState {
  telegram?: { enabled?: boolean; botToken?: string; username?: string };
}

interface PrefsState {
  voice?: { speaker?: string; format?: string };
}

export function IntegrationsPage({ gatewayClient }: IntegrationsPageProps) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState<PanelType>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    if (!gatewayClient) return;
    try {
      const cfg = await gatewayClient.configGet();
      setConfig(cfg);
    } catch {
      // Config may not exist yet
    } finally {
      setLoading(false);
    }
  }, [gatewayClient]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const channels = (config as any)?.channels as ChannelState | undefined;
  const integrations = (config as any)?.integrations as { voice?: PrefsState["voice"] } | undefined;

  const telegramConnected = !!channels?.telegram?.enabled;

  const handleConfigPatch = async (patch: Record<string, unknown>) => {
    if (!gatewayClient) throw new Error("Not connected to agent");
    await gatewayClient.configPatch(patch);
    await loadConfig();
  };

  const handleDisconnect = async (channel: string) => {
    await handleConfigPatch({ channels: { [channel]: null } });
    setDisconnectTarget(null);
    setActivePanel(null);
  };

  const getTelegramStatus = (): { status: CardStatus; statusText?: string; cta?: string } => {
    if (telegramConnected) {
      return {
        status: "connected",
        statusText: channels?.telegram?.username
          ? `@${channels.telegram.username}`
          : "Active",
        cta: "Manage",
      };
    }
    return { status: "available", cta: "Set up \u2192" };
  };

  const telegramInfo = getTelegramStatus();

  if (loading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-4 bg-[var(--surface-low)] rounded w-24" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-[var(--surface-low)] rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      {/* Channels */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Channels</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Give your agent a presence on messaging platforms
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <IntegrationCard
            icon={Send}
            name="Telegram"
            status={telegramInfo.status}
            statusText={telegramInfo.statusText}
            ctaLabel={telegramInfo.cta}
            onClick={() => setActivePanel(telegramConnected ? "telegram-manage" : "telegram")}
          />
          <IntegrationCard icon={MessageCircle} name="Discord" status="coming-soon" />
          <IntegrationCard icon={Hash} name="Slack" status="coming-soon" />
          <IntegrationCard icon={Phone} name="WhatsApp" status="coming-soon" />
          <IntegrationCard icon={Mail} name="Email" status="coming-soon" />
          <IntegrationCard icon={MessageSquareMore} name="Mattermost" status="coming-soon" />
        </div>
      </section>

      {/* Capabilities */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Built-in Capabilities</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Your agent already has these superpowers
          </p>
        </div>
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
          <IntegrationCard icon={Eye} name="Vision" status="coming-soon" description="Image understanding" />
          <IntegrationCard icon={Image} name="Images" status="coming-soon" description="30+ generation models" />
          <IntegrationCard icon={Video} name="Video" status="coming-soon" description="Text & image to video" />
          <IntegrationCard icon={Box} name="3D" status="coming-soon" description="Image to 3D model" />
        </div>
      </section>

      {/* Telegram Setup Wizard */}
      <SlideOver
        open={activePanel === "telegram"}
        onClose={() => setActivePanel(null)}
        title="Connect Telegram"
        description="Give your agent a Telegram presence"
      >
        <TelegramWizard
          onConnect={handleConfigPatch}
          onClose={() => {
            setActivePanel(null);
            loadConfig();
          }}
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
