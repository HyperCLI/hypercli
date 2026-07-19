"use client";

import type { CSSProperties } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import Image from "next/image";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import type { AgentChannelsProvider } from "@hypercli.com/sdk/channels";
import type {
  GatewayWebLoginStartOptions,
  GatewayWebLoginStartResult,
  GatewayWebLoginWaitOptions,
  GatewayWebLoginWaitResult,
} from "@hypercli.com/sdk/openclaw/gateway";
import type { OpenClawWhatsAppProgressEvent } from "@hypercli.com/sdk/openclaw/whatsapp";
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, RefreshCw, Terminal, Trash2, X } from "lucide-react";
import { motion } from "framer-motion";

import { INTEGRATION_BRAND_LOGOS } from "@/components/dashboard/integrations/integration-brand-icons";
import {
  CONNECTOR_WORKFLOW_SCHEMA_ID,
  ensureConnectorWorkflowInputSlots,
  ensureConnectorWorkflowVerificationStep,
  type ConnectorId,
  type ConnectorWorkflow,
  type ConnectorWorkflowInputSlot,
} from "@/lib/connector-workflow";
import {
  connectorWorkflowInputControlIsVisible,
  ConnectorWorkflowGuide,
  type ConnectorWorkflowInputControls,
  type ConnectorWorkflowInputVisibility,
  type ConnectorWorkflowVerificationResult,
} from "./ConnectorWorkflowGuide";
import { IntegrationBrandPulse } from "./IntegrationBrandPulse";

export type AdditionalChannelConnectorId = "discord" | "slack" | "whatsapp";

export interface SlackRelaySetupOptions {
  mode: "prompt" | "hosted" | "self-hosted";
  handle: string;
  connected: boolean | null;
  workspace: string | null;
  checking: boolean;
  configuring: boolean;
  error: string | null;
  connectHref: string;
  onChooseHosted: () => void;
  onChooseSelfHosted: () => void;
  onBackToChoice: () => void;
  onRefreshHosted: () => void;
  onConfigureHosted: () => void;
  onRememberReturn?: () => void;
}

interface ChannelChatConnectorCardProps {
  channelId: AdditionalChannelConnectorId;
  connected: boolean;
  config: Record<string, unknown> | null;
  connectorsProvider?: AgentConnectorsProvider | null;
  channelsProvider?: AgentChannelsProvider | null;
  onSaveConfig?: (patch: Record<string, unknown>) => Promise<void>;
  onEnsureWhatsAppSupport?: (reportProgress?: (event: OpenClawWhatsAppProgressEvent) => void) => Promise<void>;
  onWhatsAppPairingStart?: (
    options?: GatewayWebLoginStartOptions,
    reportProgress?: (event: OpenClawWhatsAppProgressEvent) => void,
  ) => Promise<GatewayWebLoginStartResult>;
  whatsAppPairingState?: {
    status: "idle" | "starting" | "waiting" | "connected" | "failed";
    qrDataUrl: string | null;
    message: string | null;
    progress: OpenClawWhatsAppProgressEvent[];
    error: string | null;
  };
  onCancelWhatsAppPairing?: () => void;
  onWebLoginStart?: (options?: GatewayWebLoginStartOptions) => Promise<GatewayWebLoginStartResult>;
  onWebLoginWait?: (options?: GatewayWebLoginWaitOptions) => Promise<GatewayWebLoginWaitResult>;
  cachedWorkflow?: ConnectorWorkflow | null;
  onGenerateConnectorWorkflow?: (connectorId: ConnectorId) => Promise<ConnectorWorkflow>;
  onRunShellProposal?: (command: string) => Promise<void>;
  onReconnectGateway?: () => void;
  onOpenIntegrationDetails?: () => void;
  onOpenFullSetup?: () => void;
  onDismiss?: () => void;
  directSetup?: boolean;
  slackRelaySetup?: SlackRelaySetupOptions;
}

type CardMode = "overview" | "setup" | "saved" | "verifying" | "ready" | "failed" | "manage";
type FieldValues = Record<string, string>;
type WhatsAppPairingStatus = "idle" | "preparing" | "configuring" | "starting" | "waiting";

const WHATSAPP_LOGIN_START_TIMEOUT_MS = 25_000;
const WHATSAPP_LOGIN_WAIT_TIMEOUT_MS = 30_000;
const WHATSAPP_LOGIN_WAIT_ATTEMPTS = 20;
const WHATSAPP_VERIFY_ATTEMPTS = 6;
const WHATSAPP_VERIFY_INTERVAL_MS = 2_500;

interface ChannelDefinition {
  displayName: string;
  description: string;
  fields: Array<{
    key: string;
    label: string;
    placeholder: string;
    sensitive?: boolean;
    optional?: boolean;
    help: string;
    visibleWhen?: ConnectorWorkflowInputVisibility;
    requiredWhen?: ConnectorWorkflowInputVisibility;
  }>;
}

const CHANNEL_DEFINITIONS: Record<AdditionalChannelConnectorId, ChannelDefinition> = {
  discord: {
    displayName: "Discord",
    description: "Connect servers, channels, and direct messages.",
    fields: [
      { key: "token", label: "Bot token", placeholder: "Enter Discord bot token", sensitive: true, help: "Stored only when you approve saving this channel." },
      { key: "guildId", label: "Server ID", placeholder: "Optional server ID", optional: true, help: "Use with a user ID to restrict access to one server member." },
      {
        key: "userId",
        label: "Allowed user ID",
        placeholder: "Optional user ID",
        optional: true,
        help: "Required after you enter a server ID.",
        visibleWhen: {
          all: [{ inputSlot: "discord.guildId", operator: "not-empty" }],
        },
        requiredWhen: {
          all: [{ inputSlot: "discord.guildId", operator: "not-empty" }],
        },
      },
    ],
  },
  slack: {
    displayName: "Slack",
    description: "Connect channels, conversations, and direct messages.",
    fields: [
      { key: "botToken", label: "Bot token", placeholder: "xoxb-...", sensitive: true, help: "Bot User OAuth token. It never enters chat or setup guidance." },
      { key: "appToken", label: "App token", placeholder: "xapp-...", sensitive: true, help: "Socket Mode app token. It is sent only when you save." },
    ],
  },
  whatsapp: {
    displayName: "WhatsApp",
    description: "Connect messages and conversations.",
    fields: [],
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validWhatsAppQrDataUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 16_384) return false;
  const prefix = "data:image/png;base64,";
  return value.startsWith(prefix) && /^[A-Za-z0-9+/=]+$/.test(value.slice(prefix.length));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function configuredChannel(config: Record<string, unknown> | null, channelId: AdditionalChannelConnectorId): boolean {
  const channels = asRecord(config?.channels);
  return Boolean(asRecord(channels?.[channelId]));
}

function configuredSlackMode(config: Record<string, unknown> | null): "socket" | "http" | "relay" {
  const mode = asRecord(asRecord(config?.channels)?.slack)?.mode;
  return mode === "http" || mode === "relay" ? mode : "socket";
}

function validateFields(channelId: AdditionalChannelConnectorId, values: FieldValues, configured: boolean): string | null {
  if (channelId === "whatsapp") return null;
  if (channelId === "discord") {
    if (!configured && !values.token?.trim()) return "Enter the Discord bot token.";
    const guildId = values.guildId?.trim() ?? "";
    const userId = values.userId?.trim() ?? "";
    if (Boolean(guildId) !== Boolean(userId)) return "Enter both the server ID and allowed user ID, or leave both blank.";
    if ((guildId && !/^\d+$/.test(guildId)) || (userId && !/^\d+$/.test(userId))) return "Discord server and user IDs must be numeric.";
    return null;
  }
  if (!configured && !values.botToken?.trim()) return "Enter the Slack bot token.";
  if (!configured && !values.appToken?.trim()) return "Enter the Slack app token.";
  if (values.botToken?.trim() && !values.botToken.trim().startsWith("xoxb-")) return "Slack bot tokens start with xoxb-.";
  if (values.appToken?.trim() && !values.appToken.trim().startsWith("xapp-")) return "Slack app tokens start with xapp-.";
  return null;
}

function channelFieldIsValid(channelId: AdditionalChannelConnectorId, fieldKey: string, values: FieldValues, configured: boolean): boolean {
  const value = values[fieldKey]?.trim() ?? "";
  if (channelId === "discord") {
    if (fieldKey === "token") return configured || value.length > 0;
    if (fieldKey === "guildId") return !value || /^\d+$/.test(value);
    if (fieldKey === "userId") {
      return !value || /^\d+$/.test(value);
    }
  }
  if (channelId === "slack") {
    if (fieldKey === "botToken") return configured ? !value || value.startsWith("xoxb-") : value.startsWith("xoxb-");
    if (fieldKey === "appToken") return configured ? !value || value.startsWith("xapp-") : value.startsWith("xapp-");
  }
  return true;
}

function channelConfig(channelId: AdditionalChannelConnectorId, values: FieldValues): Record<string, unknown> {
  if (channelId === "whatsapp") return { enabled: true };
  if (channelId === "slack") {
    return {
      enabled: true,
      mode: "socket",
      ...(values.botToken?.trim() ? { botToken: values.botToken.trim() } : {}),
      ...(values.appToken?.trim() ? { appToken: values.appToken.trim() } : {}),
    };
  }

  const guildId = values.guildId?.trim();
  const userId = values.userId?.trim();
  return {
    enabled: true,
    ...(values.token?.trim() ? { token: values.token.trim() } : {}),
    ...(guildId && userId ? {
      groupPolicy: "allowlist",
      guilds: { [guildId]: { requireMention: true, users: [userId] } },
    } : {}),
  };
}

function buttonClass(tone: "primary" | "secondary" | "danger" = "secondary") {
  if (tone === "primary") {
    return "inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--channel-accent)] px-3 text-xs font-black uppercase tracking-[0.12em] text-[var(--channel-accent-foreground)] shadow-[0_0_24px_color-mix(in_srgb,var(--channel-accent)_24%,transparent)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
  }
  if (tone === "danger") {
    return "inline-flex h-8 items-center gap-1.5 rounded-full border border-destructive/35 bg-destructive/10 px-3 text-xs font-black uppercase tracking-[0.12em] text-destructive transition-all hover:-translate-y-0.5 hover:bg-destructive/15 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
  }
  return "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-low/70 px-3 text-xs font-black uppercase tracking-[0.12em] text-text-secondary backdrop-blur transition-all hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-high hover:text-foreground disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
}

export function ChannelChatConnectorCard({
  channelId,
  connected,
  config,
  connectorsProvider,
  channelsProvider,
  onSaveConfig,
  onEnsureWhatsAppSupport,
  onWhatsAppPairingStart,
  whatsAppPairingState,
  onCancelWhatsAppPairing,
  onWebLoginStart,
  onWebLoginWait,
  cachedWorkflow,
  onGenerateConnectorWorkflow,
  onRunShellProposal,
  onReconnectGateway,
  onOpenIntegrationDetails,
  onOpenFullSetup,
  onDismiss,
  directSetup = false,
  slackRelaySetup,
}: ChannelChatConnectorCardProps) {
  const definition = CHANNEL_DEFINITIONS[channelId];
  const brand = INTEGRATION_BRAND_LOGOS[channelId];
  const Icon = brand.icon;
  const configuredFromConfig = configuredChannel(config, channelId);
  const slackMode = channelId === "slack" ? configuredSlackMode(config) : "socket";
  const advancedSlackTransport = channelId === "slack" && slackMode !== "socket";
  const slackRelayChoiceActive = channelId === "slack" && Boolean(slackRelaySetup) && !configuredFromConfig;
  const visibleSlackRelaySetup: SlackRelaySetupOptions | null = slackRelayChoiceActive && slackRelaySetup && slackRelaySetup.mode !== "self-hosted"
    ? slackRelaySetup
    : null;
  const directWhatsAppSetup = directSetup && channelId === "whatsapp";
  const [localMode, setMode] = useState<CardMode>(configuredFromConfig && !directWhatsAppSetup ? "manage" : directSetup ? "setup" : "overview");
  const [localRuntimeConfigured, setRuntimeConfigured] = useState<boolean | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [generatedWorkflow, setWorkflow] = useState<ConnectorWorkflow | null>(null);
  const workflow = cachedWorkflow ?? generatedWorkflow;
  const [runtimeInstructions, setRuntimeInstructions] = useState<string | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowUnavailable, setWorkflowUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [localError, setError] = useState<string | null>(null);
  const [localWhatsAppPairingStatus, setWhatsAppPairingStatus] = useState<WhatsAppPairingStatus>("idle");
  const [localWhatsAppQrDataUrl, setWhatsAppQrDataUrl] = useState<string | null>(null);
  const [localWhatsAppPairingMessage, setWhatsAppPairingMessage] = useState<string | null>(null);
  const [localWhatsAppSetupProgress, setWhatsAppSetupProgress] = useState<OpenClawWhatsAppProgressEvent[]>([]);
  const directSetupStartedRef = useRef(false);
  const whatsAppPairingRequestRef = useRef(0);
  const whatsAppSupportPreparedRef = useRef(false);
  const persistedWhatsAppPairing = channelId === "whatsapp" && whatsAppPairingState?.status !== "idle"
    ? whatsAppPairingState
    : null;
  const mode = persistedWhatsAppPairing?.status === "connected"
    ? "ready"
    : persistedWhatsAppPairing
      ? "setup"
      : localMode;
  const configured = persistedWhatsAppPairing?.status === "connected" || (localRuntimeConfigured ?? configuredFromConfig);
  const error = persistedWhatsAppPairing?.status === "failed"
    ? persistedWhatsAppPairing.error ?? "WhatsApp pairing failed."
    : localError;
  const whatsAppPairingStatus: WhatsAppPairingStatus = persistedWhatsAppPairing?.status === "starting"
    ? "preparing"
    : persistedWhatsAppPairing?.status === "waiting"
      ? "waiting"
      : persistedWhatsAppPairing
        ? "idle"
        : localWhatsAppPairingStatus;
  const whatsAppQrDataUrl = persistedWhatsAppPairing
    ? persistedWhatsAppPairing.qrDataUrl
    : localWhatsAppQrDataUrl;
  const whatsAppPairingMessage = persistedWhatsAppPairing
    ? persistedWhatsAppPairing.message
    : localWhatsAppPairingMessage;
  const whatsAppSetupProgress = persistedWhatsAppPairing?.progress ?? localWhatsAppSetupProgress;
  const canConfigure = connected && Boolean(channelsProvider?.configure || connectorsProvider || onSaveConfig);
  const canRemove = Boolean(onSaveConfig || channelsProvider?.removeConfig);
  const whatsAppPairingStarting = whatsAppPairingStatus === "preparing" || whatsAppPairingStatus === "configuring" || whatsAppPairingStatus === "starting";
  const active = mode === "setup" || mode === "saved" || mode === "verifying" || whatsAppPairingStatus !== "idle";
  const style = {
    "--channel-accent": "var(--selection-accent)",
    "--channel-accent-foreground": "var(--selection-accent-foreground)",
    "--channel-accent-border": "color-mix(in srgb, var(--channel-accent) 33%, transparent)",
    "--channel-accent-soft": "color-mix(in srgb, var(--channel-accent) 9%, transparent)",
  } as CSSProperties;

  useEffect(() => {
    if (!connected || !connectorsProvider) return;
    let cancelled = false;
    void connectorsProvider.list({ connectorId: channelId }).then((connectors) => {
      if (cancelled) return;
      const connector = connectors.find((candidate) => candidate.connectorId === channelId);
      setRuntimeConfigured(connector ? connector.configured : null);
      if (connector?.configured) setMode((current) => current === "overview" ? "manage" : current);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [channelId, connected, connectorsProvider]);

  const persistChannelConfig = async (nextConfig: Record<string, unknown>) => {
    if (channelsProvider?.configure) await channelsProvider.configure(channelId, nextConfig);
    else if (connectorsProvider) await connectorsProvider.configure(channelId, nextConfig);
    else await onSaveConfig!({ channels: { [channelId]: nextConfig } });
  };

  const save = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!channelsProvider?.configure && !connectorsProvider && !onSaveConfig) {
      setError(`${definition.displayName} setup is unavailable here.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nextConfig = channelConfig(channelId, activeValues);
      await persistChannelConfig(nextConfig);
      setValues({});
      setVisibleFields(new Set());
      setRuntimeConfigured(true);
      setMode("saved");
    } catch {
      setError(`Could not save ${definition.displayName} settings. No credential values were added to chat.`);
    } finally {
      setSaving(false);
    }
  };

  const probeConnection = async (): Promise<ConnectorWorkflowVerificationResult> => {
    if (!connectorsProvider && !channelsProvider) {
      return { success: false, message: "Connection testing is unavailable here." };
    }
    try {
      if (channelsProvider?.read) {
        const snapshot = await channelsProvider.read({ channelId, probe: true });
        const channel = snapshot.channels.find((candidate) => candidate.channelId === channelId);
        const account = channel?.defaultAccountId
          ? channel.accounts.find((candidate) => candidate.accountId === channel.defaultAccountId)
          : channel?.accounts.length === 1 ? channel.accounts[0] : undefined;
        if (account?.configured && account.running === true && account.healthState === "healthy") {
          setRuntimeConfigured(true);
          setAccountName(account.accountDisplayName ?? null);
          return { success: true, message: `${definition.displayName} is online for this workspace.` };
        }
        if (account) {
          return {
            success: false,
            message: account.lastError?.trim() || `${definition.displayName} is configured but not healthy yet.`,
          };
        }
        if (channel && channel.accounts.length > 1) {
          return { success: false, message: `Choose a ${definition.displayName} account in integrations before testing.` };
        }
      } else if (connectorsProvider) {
        const connector = (await connectorsProvider.list({ connectorId: channelId, probe: true })).find((candidate) => candidate.connectorId === channelId);
        if (connector?.usable) {
          setRuntimeConfigured(true);
          return { success: true, message: `${definition.displayName} is online for this workspace.` };
        }
      } else if (channelsProvider) {
        const channel = (await channelsProvider.list({ probe: true })).find((candidate) => candidate.channelId === channelId);
        if (channel?.configured && channel.running === true && channel.healthState === "healthy") {
          setRuntimeConfigured(true);
          setAccountName(channel.accountDisplayName ?? null);
          return { success: true, message: `${definition.displayName} is online for this workspace.` };
        }
      }
      return { success: false, message: `${definition.displayName} is configured but not reachable yet.` };
    } catch {
      return { success: false, message: `Could not test ${definition.displayName} right now.` };
    }
  };

  async function verifyWhatsAppPairing(requestId: number) {
    setWhatsAppPairingStatus("idle");
    setWhatsAppPairingMessage(null);
    setMode("verifying");
    setProbing(true);
    let failureMessage = "WhatsApp was linked, but it is not online yet.";
    for (let attempt = 0; attempt < WHATSAPP_VERIFY_ATTEMPTS; attempt += 1) {
      const result = await probeConnection();
      if (whatsAppPairingRequestRef.current !== requestId) return;
      if (result.success) {
        setMode("ready");
        setProbing(false);
        return;
      }
      failureMessage = result.message || failureMessage;
      if (attempt < WHATSAPP_VERIFY_ATTEMPTS - 1) await sleep(WHATSAPP_VERIFY_INTERVAL_MS);
    }
    if (whatsAppPairingRequestRef.current !== requestId) return;
    setError(failureMessage);
    setMode("failed");
    setProbing(false);
  }

  const beginWhatsAppSetup = async (force = false) => {
    const requestId = whatsAppPairingRequestRef.current + 1;
    whatsAppPairingRequestRef.current = requestId;
    setMode("setup");
    setError(null);
    setWhatsAppQrDataUrl(null);
    setWhatsAppPairingMessage(null);
    setWhatsAppSetupProgress([]);

    if (!connected || (!onWhatsAppPairingStart && !onWebLoginStart) || !onWebLoginWait) {
      setWhatsAppPairingStatus("idle");
      setError("Automatic WhatsApp pairing is unavailable for this workspace.");
      return;
    }

    try {
      const reportProgress = (event: OpenClawWhatsAppProgressEvent) => {
        if (whatsAppPairingRequestRef.current !== requestId) return;
        setWhatsAppSetupProgress((current) => {
          const existingIndex = current.findIndex((entry) => entry.id === event.id);
          if (existingIndex === -1) return [...current, event];
          return current.map((entry, index) => index === existingIndex ? event : entry);
        });
      };
      let started: GatewayWebLoginStartResult;
      if (onWhatsAppPairingStart) {
        setWhatsAppPairingStatus("preparing");
        started = await onWhatsAppPairingStart({
          force,
          timeoutMs: WHATSAPP_LOGIN_START_TIMEOUT_MS,
          verbose: true,
        }, reportProgress);
        if (whatsAppPairingRequestRef.current !== requestId) return;
        whatsAppSupportPreparedRef.current = true;
        setRuntimeConfigured(true);
      } else {
        if (onEnsureWhatsAppSupport && !whatsAppSupportPreparedRef.current) {
          setWhatsAppPairingStatus("preparing");
          await onEnsureWhatsAppSupport(reportProgress);
          if (whatsAppPairingRequestRef.current !== requestId) return;
          whatsAppSupportPreparedRef.current = true;
        }
        if (onEnsureWhatsAppSupport) {
          setRuntimeConfigured(true);
        } else if (!configured) {
          if (!canConfigure) throw new Error("WhatsApp configuration is unavailable for this workspace.");
          setWhatsAppPairingStatus("configuring");
          await persistChannelConfig({ enabled: true });
          if (whatsAppPairingRequestRef.current !== requestId) return;
          setRuntimeConfigured(true);
        }
        setWhatsAppPairingStatus("starting");
        started = await onWebLoginStart!({
          force,
          timeoutMs: WHATSAPP_LOGIN_START_TIMEOUT_MS,
          verbose: true,
        });
      }
      if (whatsAppPairingRequestRef.current !== requestId) return;

      if (started.connected) {
        await verifyWhatsAppPairing(requestId);
        return;
      }
      if (!validWhatsAppQrDataUrl(started.qrDataUrl)) {
        throw new Error(started.message || "WhatsApp did not provide a pairing code.");
      }

      let currentQrDataUrl = started.qrDataUrl;
      setWhatsAppQrDataUrl(currentQrDataUrl);
      setWhatsAppPairingMessage(started.message || "Scan this code with WhatsApp to link your phone.");
      setWhatsAppPairingStatus("waiting");
      if (onWhatsAppPairingStart) return;

      for (let attempt = 0; attempt < WHATSAPP_LOGIN_WAIT_ATTEMPTS; attempt += 1) {
        const result = await onWebLoginWait({
          timeoutMs: WHATSAPP_LOGIN_WAIT_TIMEOUT_MS,
          currentQrDataUrl,
        });
        if (whatsAppPairingRequestRef.current !== requestId) return;
        if (result.connected) {
          setWhatsAppQrDataUrl(null);
          await verifyWhatsAppPairing(requestId);
          return;
        }
        if (!validWhatsAppQrDataUrl(result.qrDataUrl)) {
          throw new Error(result.message || "The WhatsApp pairing code expired.");
        }
        currentQrDataUrl = result.qrDataUrl;
        setWhatsAppQrDataUrl(currentQrDataUrl);
        setWhatsAppPairingMessage(result.message || "The pairing code was refreshed. Scan the latest code.");
      }
      throw new Error("WhatsApp pairing timed out. Generate a new code to try again.");
    } catch (cause) {
      if (whatsAppPairingRequestRef.current !== requestId) return;
      setWhatsAppPairingStatus("idle");
      setWhatsAppQrDataUrl(null);
      setError(cause instanceof Error ? cause.message : "Could not start WhatsApp pairing.");
    }
  };

  const beginSetup = () => {
    if (channelId === "whatsapp") {
      void beginWhatsAppSetup(configured);
      return;
    }
    if (advancedSlackTransport) {
      setError(`This Slack account uses ${slackMode === "http" ? "HTTP Request URLs" : "Relay"}. Manage it in integrations.`);
      return;
    }
    setMode("setup");
    setError(null);
    setWorkflowUnavailable(false);
    if (workflowLoading) return;
    setRuntimeInstructions(null);
    setWorkflowLoading(true);
    void (async () => {
      try {
        if (connectorsProvider) {
          const setup = await connectorsProvider.startSetup({ connectorId: channelId, mode: "config" });
          const instructions = setup.instructions?.trim() || null;
          setRuntimeInstructions(instructions);
          if (instructions) return;
        }
        if (!onGenerateConnectorWorkflow) throw new Error("Generated guidance is unavailable.");
        setWorkflow(await onGenerateConnectorWorkflow(channelId));
      } catch {
        if (!workflow) setWorkflowUnavailable(true);
      } finally {
        setWorkflowLoading(false);
      }
    })();
  };
  const beginDirectSetup = useEffectEvent(beginSetup);

  useEffect(() => {
    if (
      !directSetup ||
      (slackRelayChoiceActive && slackRelaySetup?.mode !== "self-hosted") ||
      (configured && channelId !== "whatsapp") ||
      directSetupStartedRef.current ||
      (channelId === "whatsapp" && whatsAppPairingState?.status !== undefined && whatsAppPairingState.status !== "idle")
    ) return;
    directSetupStartedRef.current = true;
    beginDirectSetup();
  }, [channelId, configured, directSetup, slackRelayChoiceActive, slackRelaySetup?.mode, whatsAppPairingState?.status]);

  useEffect(() => () => {
    whatsAppPairingRequestRef.current += 1;
  }, []);

  const cancelWhatsAppSetup = () => {
    whatsAppPairingRequestRef.current += 1;
    onCancelWhatsAppPairing?.();
    setWhatsAppPairingStatus("idle");
    setWhatsAppQrDataUrl(null);
    setWhatsAppPairingMessage(null);
    setWhatsAppSetupProgress([]);
    setError(null);
    setMode(configured ? "manage" : "overview");
  };

  const verify = async () => {
    setMode("verifying");
    setProbing(true);
    setError(null);
    const result = await probeConnection();
    if (result.success) {
      setMode("ready");
    } else {
      setError(result.message ?? `${definition.displayName} is configured but not reachable yet.`);
      setMode("failed");
    }
    setProbing(false);
  };

  const disconnect = async () => {
    if (!canRemove) return;
    setSaving(true);
    setError(null);
    try {
      if (channelsProvider?.removeConfig && channelsProvider.read) {
        const snapshot = await channelsProvider.read({ channelId });
        const channel = snapshot.channels.find((candidate) => candidate.channelId === channelId);
        const defaultAccountId = channel?.defaultAccountId;
        const accountScope = defaultAccountId && channelsProvider.readConfig
          ? await channelsProvider.readConfig({ channelId, accountId: defaultAccountId })
          : null;
        if (channel && channel.accounts.length > 1 && !accountScope?.accountId) {
          setError(`Open ${definition.displayName} in integrations to choose the account to disconnect.`);
          return;
        }
        await channelsProvider.removeConfig(channelId, accountScope?.accountId);
      } else if (onSaveConfig) {
        const channelConfig = asRecord(asRecord(config?.channels)?.[channelId]);
        if (Object.keys(asRecord(channelConfig?.accounts) ?? {}).length > 0) {
          setError(`Open ${definition.displayName} in integrations to choose the account to disconnect.`);
          return;
        }
        await onSaveConfig({ channels: { [channelId]: null } });
      } else {
        await channelsProvider?.removeConfig?.(channelId);
      }
      setRuntimeConfigured(false);
      setWorkflow(null);
      setRuntimeInstructions(null);
      setMode("overview");
    } catch {
      setError(`Could not disconnect ${definition.displayName}.`);
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    setMode("manage");
    onReconnectGateway?.();
  };

  const currentWhatsAppProgress = whatsAppSetupProgress.findLast((entry) => entry.status === "running") ?? whatsAppSetupProgress.at(-1);
  const heroLabel = !connected
    ? `${definition.displayName} setup`
    : visibleSlackRelaySetup
      ? `Create ${definition.displayName} app`
    : mode === "setup"
      ? `Connect ${definition.displayName}`
      : mode === "saved"
        ? "Settings saved"
        : mode === "verifying"
          ? `Testing ${definition.displayName}`
          : mode === "ready"
            ? `${definition.displayName} online`
            : mode === "failed"
              ? "Needs attention"
              : configured
                ? `${definition.displayName} configured`
                : `Connect ${definition.displayName}`;
  const heroSubtitle = mode === "setup" && channelId === "whatsapp"
    ? whatsAppPairingStatus === "preparing"
      ? currentWhatsAppProgress?.label ?? "Starting WhatsApp setup."
      : whatsAppPairingStatus === "configuring"
      ? "Enabling WhatsApp for this workspace."
      : whatsAppPairingStatus === "starting"
        ? "Generating a secure pairing code."
        : whatsAppPairingStatus === "waiting"
          ? whatsAppPairingMessage ?? "Scan the code with WhatsApp to link your phone."
          : "Link your phone with a secure QR code."
    : visibleSlackRelaySetup
      ? "Select self-hosted setup or use the HyperCLI Slack App."
    : mode === "setup"
      ? workflow?.summary ?? runtimeInstructions ?? (workflowLoading ? "Preparing setup guidance." : definition.description)
    : mode === "saved"
      ? "Complete any remaining setup steps, then test the connection."
      : mode === "ready"
        ? accountName ? `Connected as ${accountName}.` : `${definition.displayName} can receive messages.`
        : definition.description;
  const tone = mode === "ready" ? "var(--selection-accent)" : mode === "failed" || error ? "var(--destructive)" : "var(--border)";
  const inputSlots = definition.fields.map((field) => `${channelId}.${field.key}` as ConnectorWorkflowInputSlot);
  const inputFallback = {
    id: "required-settings",
    title: `Enter ${definition.displayName} settings`,
    instructions: "Enter the protected values required by this workspace. They are sent only when you save settings.",
    inputSlots,
  };
  const runtimeWorkflow: ConnectorWorkflow | null = runtimeInstructions ? {
    schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
    connectorId: channelId,
    runtimeFingerprint: "runtime-provided",
    summary: `Follow the ${definition.displayName} setup guidance reported by this workspace.`,
    steps: [{
      id: "runtime-guidance",
      title: "Review runtime guidance",
      instructions: runtimeInstructions,
      kind: "instruction",
      approvalRequired: false,
    }],
  } : null;
  const sourceWorkflow = workflow ?? runtimeWorkflow;
  const displayWorkflowWithInputs = sourceWorkflow
    ? ensureConnectorWorkflowInputSlots(sourceWorkflow, inputFallback)
    : null;
  const displayWorkflow = displayWorkflowWithInputs
    ? ensureConnectorWorkflowVerificationStep(displayWorkflowWithInputs)
    : null;
  const inputControls = Object.fromEntries(definition.fields.map((field) => {
    const inputSlot = `${channelId}.${field.key}` as ConnectorWorkflowInputSlot;
    const visible = visibleFields.has(field.key);
    const keepExisting = configured && !field.optional;
    const content = (
      <label className="block min-w-0 rounded-2xl border border-border bg-background/65 p-3">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-text-muted">
          {field.label}{field.optional ? " · optional" : ""}
        </span>
        <span className="relative mt-2 block">
          <input
            aria-label={`${definition.displayName} ${field.label}`}
            type={field.sensitive && !visible ? "password" : "text"}
            value={values[field.key] ?? ""}
            onChange={(event) => {
              setValues((current) => ({ ...current, [field.key]: event.target.value }));
              setError(null);
            }}
            placeholder={keepExisting ? "Leave blank to keep existing value" : field.placeholder}
            autoComplete="off"
            spellCheck={false}
            inputMode={field.key.endsWith("Id") ? "numeric" : undefined}
            className="h-12 w-full rounded-xl border border-border bg-background px-3 pr-10 font-mono text-sm text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-text-muted focus:border-[var(--channel-accent)]"
          />
          {field.sensitive ? (
            <button
              type="button"
              onClick={() => setVisibleFields((current) => {
                const next = new Set(current);
                if (next.has(field.key)) next.delete(field.key);
                else next.add(field.key);
                return next;
              })}
              className="absolute right-1 top-1 flex h-10 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-surface-low hover:text-foreground"
              aria-label={`${visible ? "Hide" : "Show"} ${definition.displayName} ${field.label}`}
            >
              {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          ) : null}
        </span>
        <span className="mt-2 block text-[11px] leading-4 text-text-muted">{field.help}</span>
      </label>
    );
    return [inputSlot, {
      content,
      valid: channelFieldIsValid(channelId, field.key, values, configured),
      value: values[field.key] ?? "",
      visibleWhen: field.visibleWhen,
      requiredWhen: field.requiredWhen,
    }];
  })) as ConnectorWorkflowInputControls;
  const activeValues = Object.fromEntries(definition.fields
    .filter((field) => connectorWorkflowInputControlIsVisible(`${channelId}.${field.key}` as ConnectorWorkflowInputSlot, inputControls))
    .map((field) => [field.key, values[field.key] ?? ""]));
  const validationError = validateFields(channelId, activeValues, configured);

  return (
    <section
      className="group relative mb-3 overflow-hidden rounded-[1.75rem] border bg-background shadow-2xl"
      style={{ ...style, borderColor: tone }}
      aria-live="polite"
    >
      <Icon className="pointer-events-none absolute -right-14 -top-10 h-52 w-52 rotate-12 opacity-[0.14] sm:-right-16 sm:h-64 sm:w-64" style={{ color: brand.color }} />
      <div className="relative z-10 p-4 sm:p-5">
        <div className="flex items-center gap-4 sm:gap-5">
          <IntegrationBrandPulse active={active} accentColor={brand.color}>
            <Icon className="h-14 w-14 sm:h-[4.5rem] sm:w-[4.5rem]" style={{ color: brand.color }} />
          </IntegrationBrandPulse>
          <div className="min-w-0 flex-1">
            <motion.p
              key={heroLabel}
              initial={{ opacity: 0, y: 18, filter: "blur(7px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ type: "spring", stiffness: 330, damping: 32, mass: 0.8 }}
              className="truncate text-left text-[clamp(1.55rem,5.6vw,3.05rem)] font-black uppercase leading-[0.9] tracking-[0.01em]"
              style={{ color: brand.color }}
            >
              {heroLabel}
            </motion.p>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-secondary sm:text-sm">{heroSubtitle}</p>
          </div>
        </div>
      </div>

      {visibleSlackRelaySetup || mode === "setup" || mode === "saved" || mode === "verifying" || mode === "ready" || mode === "failed" || error || !connected ? (
        <div className="relative z-10 space-y-3 border-t border-border bg-surface-low/70 px-4 py-4 text-xs leading-5 text-text-secondary backdrop-blur-md sm:px-5">
          {error ? <p role="alert" className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-destructive">{error}</p> : null}
          {visibleSlackRelaySetup ? (
            <div className="rounded-2xl border border-[var(--channel-accent-border)] bg-background/75 p-4 sm:p-5">
              {visibleSlackRelaySetup.mode === "prompt" ? (
                <>
                  <p className="text-sm font-bold text-foreground">Create Slack app</p>
                  <p className="mt-2 text-xs leading-5 text-text-secondary">
                    Select self-hosted to enter Slack bot and app tokens, or use the HyperCLI Slack App for the hosted relay.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-foreground">Use the HyperCLI Slack App</p>
                      <p className="mt-1 text-xs leading-5 text-text-secondary">
                        The hosted @{visibleSlackRelaySetup.handle} app connects through relay. No Slack bot or app token is pasted into this agent.
                      </p>
                    </div>
                    <button type="button" className={buttonClass()} onClick={visibleSlackRelaySetup.onRefreshHosted} disabled={visibleSlackRelaySetup.checking}>
                      {visibleSlackRelaySetup.checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Refresh
                    </button>
                  </div>
                  <div className="mt-4 rounded-xl border border-border bg-surface-low px-3 py-2 text-xs text-text-secondary">
                    {visibleSlackRelaySetup.checking
                      ? "Checking Slack connection..."
                      : visibleSlackRelaySetup.connected
                        ? `Connected${visibleSlackRelaySetup.workspace ? ` to ${visibleSlackRelaySetup.workspace}` : ""}.`
                        : "Connect Slack once for this HyperCLI account, then return here to use the hosted app."}
                  </div>
                </>
              )}
              {visibleSlackRelaySetup.error ? (
                <p role="alert" className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-destructive">{visibleSlackRelaySetup.error}</p>
              ) : null}
            </div>
          ) : null}
          {!connected ? (
            <div className="flex items-start gap-2 rounded-2xl border border-warning/25 bg-warning/10 px-3 py-2 text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Reconnect the workspace before changing integration settings.
            </div>
          ) : null}
          {mode === "setup" || mode === "saved" ? (
            channelId === "whatsapp" && mode === "setup" ? (
              <div className="rounded-2xl border border-[var(--channel-accent-border)] bg-background/75 p-4 sm:p-5">
                {whatsAppQrDataUrl ? (
                  <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,17rem)_1fr] sm:gap-7">
                    <div className="relative mx-auto w-full max-w-[17rem] overflow-hidden rounded-[1.35rem] border border-[var(--channel-accent-border)] bg-white p-3 shadow-[0_18px_60px_rgba(0,0,0,0.3)]">
                      <Image
                        src={whatsAppQrDataUrl}
                        alt="WhatsApp pairing QR code"
                        width={256}
                        height={256}
                        unoptimized
                        className="h-auto w-full"
                      />
                      <div className="absolute inset-x-3 bottom-3 flex justify-center">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-black/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur">
                          <Loader2 className="h-3 w-3 animate-spin" /> Waiting for scan
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">Scan with your phone</p>
                      <p className="mt-2 text-xs leading-5 text-text-secondary">
                        Open WhatsApp, go to Settings, choose Linked Devices, then choose Link a Device and scan this code.
                      </p>
                      <p className="mt-3 rounded-xl border border-border bg-surface-low px-3 py-2 text-[11px] leading-4 text-text-muted">
                        Keep this page open. The code refreshes here automatically until pairing completes.
                      </p>
                    </div>
                  </div>
                ) : whatsAppPairingStarting ? (
                  <div role="status" className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
                    <Loader2 className="h-7 w-7 animate-spin text-[var(--channel-accent)]" />
                    <div>
                      <p className="font-bold text-foreground">
                        {whatsAppPairingStatus === "preparing"
                          ? currentWhatsAppProgress?.label ?? "Preparing WhatsApp support"
                          : whatsAppPairingStatus === "configuring"
                            ? "Enabling WhatsApp"
                            : "Generating your pairing code"}
                      </p>
                      <p className="mt-1 text-[11px] text-text-muted">
                        {whatsAppPairingStatus === "preparing" ? "Installation and workspace restart are automatic." : "This usually takes only a few seconds."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs leading-5 text-text-muted">
                    Generate a new pairing code to continue. No terminal commands are required.
                  </p>
                )}
                {whatsAppSetupProgress.length > 0 || (onWhatsAppPairingStart && whatsAppPairingStarting) ? (
                  <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface-low/80" aria-label="WhatsApp setup activity">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-text-muted">
                      <Terminal className="h-3.5 w-3.5" /> Setup activity
                    </div>
                    <div className="divide-y divide-border">
                      {whatsAppSetupProgress.length === 0 ? (
                        <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 px-3 py-2.5">
                          <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-warning" aria-hidden="true" />
                          <p className="text-[11px] text-text-muted">Starting WhatsApp setup</p>
                        </div>
                      ) : whatsAppSetupProgress.map((entry) => (
                        <div key={entry.id} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 px-3 py-2.5">
                          {entry.status === "running" ? (
                            <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-warning" aria-hidden="true" />
                          ) : entry.status === "succeeded" ? (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success" aria-hidden="true" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                          )}
                          <div className="min-w-0">
                            {entry.command ? (
                              <code className="block overflow-x-auto whitespace-nowrap font-mono text-[11px] text-foreground">$ {entry.command}</code>
                            ) : (
                              <p className="text-[11px] font-semibold text-foreground">{entry.label}</p>
                            )}
                            <p className={`mt-1 text-[10px] ${entry.status === "failed" ? "text-destructive" : "text-text-muted"}`}>
                              {entry.detail ?? (entry.status === "running" ? "Running" : entry.status === "succeeded" ? "Completed" : "Failed")}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : <>
              {mode === "saved" ? (
                <div className="flex items-start gap-2 rounded-2xl border border-[var(--channel-accent-border)] bg-[var(--channel-accent-soft)] px-3 py-3 text-[var(--channel-accent)]">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>Settings are stored. Run the connection check below before finishing.</p>
                </div>
              ) : null}
              <ConnectorWorkflowGuide
                workflow={displayWorkflow}
                loading={workflowLoading}
                unavailable={workflowUnavailable && !runtimeInstructions}
                inputControls={inputControls}
                onRunShellProposal={onRunShellProposal}
                onVerifyConnection={probeConnection}
                verificationDisabled={mode !== "saved"}
                verificationDisabledReason={mode !== "saved" ? "Save settings before testing the connection." : undefined}
                onRetry={beginSetup}
              />
              {definition.fields.length === 0 && !displayWorkflow ? (
                <div className="rounded-2xl border border-border bg-background/65 px-3 py-3">
                  This channel does not require a credential in the dashboard. Follow the runtime guidance above, then explicitly enable the channel.
                </div>
              ) : null}
            </>
          ) : null}
          {mode === "verifying" ? (
            <div role="status" className="flex items-center gap-2 rounded-2xl border border-border bg-background/65 px-3 py-3">
              <Loader2 className="h-4 w-4 animate-spin" /> Testing runtime channel status...
            </div>
          ) : null}
          {mode === "ready" ? (
            <div className="flex items-start gap-2 rounded-2xl border border-[var(--channel-accent-border)] bg-[var(--channel-accent-soft)] px-3 py-3 text-[var(--channel-accent)]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{definition.displayName} is online for this workspace.</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="relative z-10 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-high/35 px-4 py-3 backdrop-blur-md sm:px-5">
        {visibleSlackRelaySetup?.mode === "prompt" ? (
          <>
            <button type="button" className={buttonClass()} onClick={visibleSlackRelaySetup.onChooseSelfHosted}>
              Self-hosted
            </button>
            <button type="button" className={buttonClass("primary")} disabled={!connected} onClick={visibleSlackRelaySetup.onChooseHosted}>
              Use HyperCLI Slack App <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        ) : visibleSlackRelaySetup?.mode === "hosted" ? (
          <>
            <button type="button" className={buttonClass()} disabled={visibleSlackRelaySetup.configuring} onClick={visibleSlackRelaySetup.onBackToChoice}>Back</button>
            {visibleSlackRelaySetup.connected ? (
              <button type="button" className={buttonClass("primary")} disabled={!connected || visibleSlackRelaySetup.configuring} onClick={visibleSlackRelaySetup.onConfigureHosted}>
                {visibleSlackRelaySetup.configuring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Use hosted app
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <a href={visibleSlackRelaySetup.connectHref} onClick={visibleSlackRelaySetup.onRememberReturn} className={buttonClass("primary")}>
                Connect Slack <ArrowRight className="h-3.5 w-3.5" />
              </a>
            )}
          </>
        ) : mode === "setup" ? (
          channelId === "whatsapp" ? (
            <>
              {!directSetup ? <button type="button" className={buttonClass()} onClick={cancelWhatsAppSetup}>Back</button> : null}
              {error && onOpenFullSetup ? (
                <button type="button" className={buttonClass()} onClick={onOpenFullSetup}>Use shell instead</button>
              ) : null}
              <button
                type="button"
                className={buttonClass("primary")}
                disabled={!connected || whatsAppPairingStarting || (!onWhatsAppPairingStart && !onWebLoginStart) || !onWebLoginWait}
                onClick={() => void beginWhatsAppSetup(true)}
              >
                {whatsAppPairingStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {whatsAppPairingStarting ? "Preparing" : whatsAppQrDataUrl ? "Refresh QR" : "Try again"}
              </button>
            </>
          ) : <>
              {!directSetup ? <button type="button" className={buttonClass()} disabled={saving} onClick={() => setMode(configured ? "manage" : "overview")}>Back</button> : null}
              <button type="button" className={buttonClass("primary")} disabled={!canConfigure || saving || Boolean(validationError)} onClick={() => void save()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save settings
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </>
        ) : mode === "saved" ? (
          <button type="button" className={buttonClass()} onClick={finish}>Finish</button>
        ) : mode === "failed" ? (
          <>
            <button type="button" className={buttonClass("primary")} disabled={probing || (!connectorsProvider && !channelsProvider)} onClick={() => void verify()}>
              {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Test connection
            </button>
            <button type="button" className={buttonClass()} onClick={finish}>Finish</button>
          </>
        ) : mode === "verifying" ? (
          <button type="button" className={buttonClass()} disabled><Loader2 className="h-3.5 w-3.5 animate-spin" />Testing</button>
        ) : configured || mode === "ready" ? (
          <>
            {advancedSlackTransport ? (
              <button type="button" className={buttonClass()} disabled={!onOpenIntegrationDetails} onClick={onOpenIntegrationDetails}>Manage in integrations</button>
            ) : (
              <button type="button" className={buttonClass()} disabled={!canConfigure || saving} onClick={beginSetup}>{channelId === "whatsapp" ? "Re-pair" : "Reconfigure"}</button>
            )}
            <button type="button" className={buttonClass()} disabled={probing || (!connectorsProvider && !channelsProvider)} onClick={() => void verify()}>
              <RefreshCw className="h-3.5 w-3.5" />Test
            </button>
            <button type="button" className={buttonClass("danger")} disabled={!canRemove || saving} onClick={() => void disconnect()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Disconnect
            </button>
          </>
        ) : (
          <>
            {onOpenFullSetup && !canConfigure ? <button type="button" className={buttonClass()} onClick={onOpenFullSetup}>Open integrations</button> : null}
            <button type="button" className={buttonClass("primary")} disabled={!canConfigure} onClick={beginSetup}>
              Start setup <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {onOpenIntegrationDetails && !advancedSlackTransport ? <button type="button" className={buttonClass()} onClick={onOpenIntegrationDetails}>Open in integrations</button> : null}
        {onDismiss ? <button type="button" className={buttonClass()} onClick={onDismiss}><X className="h-3.5 w-3.5" />Dismiss</button> : null}
      </div>
    </section>
  );
}
