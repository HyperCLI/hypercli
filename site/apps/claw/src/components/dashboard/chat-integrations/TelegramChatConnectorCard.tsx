"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";

import { isPluginConnected, schemaPathExists } from "@/components/dashboard/directory/directory-utils";
import { INTEGRATION_BRAND_LOGOS } from "@/components/dashboard/integrations/integration-brand-icons";
import { buildTelegramAgentAccessPrompt, TELEGRAM_AGENT_ACCESS_DISPLAY_PROMPT } from "@/lib/telegram-config-workspace";
import {
  CONNECTOR_WORKFLOW_SCHEMA_ID,
  ensureConnectorWorkflowInputSlots,
  ensureConnectorWorkflowVerificationStep,
  type ConnectorWorkflow,
  type ConnectorWorkflowInputSlot,
} from "@/lib/connector-workflow";
import {
  connectorWorkflowInputControlIsRequired,
  connectorWorkflowInputControlIsValid,
  connectorWorkflowInputControlIsVisible,
  ConnectorWorkflowGuide,
  type ConnectorWorkflowInputControls,
  type ConnectorWorkflowVerificationResult,
} from "./ConnectorWorkflowGuide";
import {
  activeConnectorAuthorizationFlow,
  ConnectorAuthorizationGuide,
  type ConnectorAuthorizationFlow,
} from "./ConnectorAuthorizationGuide";
import { TELEGRAM_PAIRING_AUTHORIZATION_FLOW } from "./connector-authorization-flows";
import { IntegrationBrandPulse } from "./IntegrationBrandPulse";

interface TelegramChatConnectorCardProps {
  connected: boolean;
  connectorsProvider?: AgentConnectorsProvider | null;
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  agentName?: string | null;
  onSaveConfig?: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe?: () => Promise<Record<string, unknown>>;
  onAgentConfigUpdate?: (prompt: string, displayContent: string) => Promise<void>;
  onReconnectGateway?: () => void;
  cachedWorkflow?: ConnectorWorkflow | null;
  onGenerateConnectorWorkflow?: (connectorId: "telegram") => Promise<ConnectorWorkflow>;
  onRunShellProposal?: (command: string) => Promise<void>;
  onOpenIntegrationDetails?: () => void;
  onOpenFullSetup?: () => void;
  onDismiss?: () => void;
  directSetup?: boolean;
}

type TelegramTone = "neutral" | "primary" | "warning" | "danger";
type TelegramMode = "overview" | "setup" | "saved" | "finish" | "verifying" | "ready" | "failed" | "manage";
type DmPolicy = "allowlist" | "pairing" | "open" | "disabled";
type GroupPolicy = "allowlist" | "open" | "disabled";
type PolicyChoice<T extends string> = "" | "runtime-default" | T;
type MentionChoice = "" | "runtime-default" | "required" | "not-required";

const TELEGRAM_COLOR = INTEGRATION_BRAND_LOGOS.telegram.color;
const TelegramIcon = INTEGRATION_BRAND_LOGOS.telegram.icon;
const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;
const TOKEN_SHAPED_RE = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g;
const VERIFY_ATTEMPTS = 6;
const VERIFY_INTERVAL_MS = 2500;
const CONNECTOR_AUTHORIZATION_FLOWS: readonly ConnectorAuthorizationFlow[] = [TELEGRAM_PAIRING_AUTHORIZATION_FLOW];

const CARD_TONE_CLASS: Record<TelegramTone, string> = {
  neutral: "border-border",
  primary: "border-[var(--channel-accent-border)]",
  warning: "border-warning/40",
  danger: "border-destructive/40",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasTelegramCapability(configSchema: OpenClawConfigSchemaResponse | null): boolean {
  if (!configSchema) return false;
  return (
    schemaPathExists(configSchema.schema, "channels.telegram") ||
    Boolean(configSchema.uiHints?.["channels.telegram"] || configSchema.uiHints?.["channels.telegram.enabled"])
  );
}

function telegramConfig(config: Record<string, unknown> | null): Record<string, unknown> | null {
  const channels = asRecord(config?.channels);
  return asRecord(channels?.telegram);
}

function telegramChannelStatus(status: Record<string, unknown> | null): Record<string, unknown> | null {
  const channels = asRecord(status?.channels);
  return asRecord(channels?.telegram);
}

function isTelegramLive(status: Record<string, unknown> | null): boolean {
  const entry = telegramChannelStatus(status);
  return entry?.configured === true && entry.running === true;
}

function telegramDisplayNameFrom(value: Record<string, unknown> | null | undefined): string | null {
  const candidates = [
    value?.username,
    value?.botUsername,
    value?.accountDisplayName,
    asRecord(value?.probe)?.username,
    asRecord(value?.probe)?.botUsername,
  ];
  const displayName = candidates.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
  return typeof displayName === "string" ? displayName.trim().replace(/^@+/, "") : null;
}

function telegramProbeError(status: Record<string, unknown> | null): string | null {
  const entry = telegramChannelStatus(status);
  const probe = asRecord(entry?.probe);
  const error = probe?.error ?? entry?.error;
  return typeof error === "string" && error.trim() ? redactTelegramSecrets(error) : null;
}

function redactTelegramSecrets(value: string): string {
  return value.replace(TOKEN_SHAPED_RE, "[redacted token]");
}

function isProtectedConfigError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return /protected|permission|read.?only|denied|forbidden|not allowed/i.test(message);
}

function isGatewayRestartDuringSave(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  return /gateway closed|\brestart\b/i.test(message);
}

function parseTelegramUserIds(value: string): string[] {
  return Array.from(new Set(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)));
}

function valuesAreValid(values: string[], pattern: RegExp, allowEmpty = true): boolean {
  return (allowEmpty || values.length > 0) && values.every((value) => pattern.test(value));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function isDmPolicy(value: unknown): value is DmPolicy {
  return value === "allowlist" || value === "pairing" || value === "open" || value === "disabled";
}

function isGroupPolicy(value: unknown): value is GroupPolicy {
  return value === "allowlist" || value === "open" || value === "disabled";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buttonClass(tone: "primary" | "secondary" | "danger" = "secondary") {
  if (tone === "primary") {
    return "inline-flex h-8 items-center gap-1.5 rounded-full bg-button-primary px-3 text-xs font-black uppercase tracking-[0.12em] text-button-primary-foreground transition-all hover:-translate-y-0.5 hover:bg-button-primary-hover disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
  }
  if (tone === "danger") {
    return "inline-flex h-8 items-center gap-1.5 rounded-full border border-destructive/35 bg-destructive/10 px-3 text-xs font-black uppercase tracking-[0.12em] text-destructive transition-all hover:-translate-y-0.5 hover:bg-destructive/15 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
  }
  return "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-low/70 px-3 text-xs font-black uppercase tracking-[0.12em] text-text-secondary backdrop-blur transition-all hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-high hover:text-foreground disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
}

interface TelegramAccessSettings {
  dmPolicy: PolicyChoice<DmPolicy>;
  allowFrom: string[];
  groupPolicy: PolicyChoice<GroupPolicy>;
  groupAllowFrom: string[];
  groupIds: string[];
  mentionChoice: MentionChoice;
}

function buildTelegramPatch(token: string, settings: TelegramAccessSettings): Record<string, unknown> {
  const telegramConfig: Record<string, unknown> = {
    enabled: true,
  };
  if (token.trim()) telegramConfig.botToken = token.trim();
  if (settings.dmPolicy && settings.dmPolicy !== "runtime-default") telegramConfig.dmPolicy = settings.dmPolicy;
  const allowFrom = settings.dmPolicy === "open"
    ? Array.from(new Set(["*", ...settings.allowFrom]))
    : settings.allowFrom;
  if (allowFrom.length > 0) telegramConfig.allowFrom = allowFrom;
  if (settings.groupPolicy && settings.groupPolicy !== "runtime-default") telegramConfig.groupPolicy = settings.groupPolicy;
  if (settings.groupAllowFrom.length > 0) telegramConfig.groupAllowFrom = settings.groupAllowFrom;
  if (settings.groupIds.length > 0) {
    telegramConfig.groups = Object.fromEntries(settings.groupIds.map((groupId) => [groupId, {
      ...(settings.mentionChoice === "required" ? { requireMention: true } : {}),
      ...(settings.mentionChoice === "not-required" ? { requireMention: false } : {}),
    }]));
  }
  return {
    channels: {
      telegram: telegramConfig,
    },
  };
}

function buildTelegramConfig(token: string, settings: TelegramAccessSettings): Record<string, unknown> {
  return asRecord(asRecord(buildTelegramPatch(token, settings).channels)?.telegram) ?? {};
}

export function TelegramChatConnectorCard({
  connected,
  connectorsProvider,
  config,
  configSchema,
  onSaveConfig,
  onChannelProbe,
  onAgentConfigUpdate,
  onReconnectGateway,
  cachedWorkflow,
  onGenerateConnectorWorkflow,
  onRunShellProposal,
  onOpenIntegrationDetails,
  onOpenFullSetup,
  onDismiss,
  directSetup = false,
}: TelegramChatConnectorCardProps) {
  const currentConfig = telegramConfig(config);
  const configured = isPluginConnected("telegram", config);
  const storedDisplayName = telegramDisplayNameFrom(currentConfig);
  const configuredAllowFrom = stringArray(currentConfig?.allowFrom);
  const configuredGroupAllowFrom = stringArray(currentConfig?.groupAllowFrom);
  const configuredGroups = asRecord(currentConfig?.groups);
  const configuredGroupIds = Object.keys(configuredGroups ?? {});
  const configuredMentionValues = Object.values(configuredGroups ?? {})
    .map((entry) => asRecord(entry)?.requireMention)
    .filter((value): value is boolean => typeof value === "boolean");
  const configuredMentionChoice: MentionChoice = configuredMentionValues.length === 0
    ? "runtime-default"
    : configuredMentionValues.every(Boolean)
      ? "required"
      : configuredMentionValues.every((value) => !value)
        ? "not-required"
        : "runtime-default";
  const hasCapability = hasTelegramCapability(configSchema);
  const runtimeAvailable = hasCapability || Boolean(connectorsProvider);
  const canConfigure = connected && runtimeAvailable && Boolean(connectorsProvider || onSaveConfig);
  const initialMode: TelegramMode = configured ? "manage" : directSetup ? "setup" : "overview";
  const [mode, setMode] = React.useState<TelegramMode>(initialMode);
  const [token, setToken] = React.useState("");
  const [showToken, setShowToken] = React.useState(false);
  const [dmPolicy, setDmPolicy] = React.useState<PolicyChoice<DmPolicy>>(
    isDmPolicy(currentConfig?.dmPolicy) ? currentConfig.dmPolicy : configured ? "runtime-default" : "",
  );
  const [allowFromInput, setAllowFromInput] = React.useState(configuredAllowFrom.join(", "));
  const [groupPolicy, setGroupPolicy] = React.useState<PolicyChoice<GroupPolicy>>(
    isGroupPolicy(currentConfig?.groupPolicy) ? currentConfig.groupPolicy : configured ? "runtime-default" : "",
  );
  const [groupAllowFromInput, setGroupAllowFromInput] = React.useState(configuredGroupAllowFrom.join(", "));
  const [groupIdsInput, setGroupIdsInput] = React.useState(configuredGroupIds.join(", "));
  const [mentionChoice, setMentionChoice] = React.useState<MentionChoice>(configured ? configuredMentionChoice : "");
  const [saving, setSaving] = React.useState(false);
  const [probing, setProbing] = React.useState(false);
  const [probeStatus, setProbeStatus] = React.useState<Record<string, unknown> | null>(null);
  const [displayName, setDisplayName] = React.useState<string | null>(storedDisplayName);
  const [error, setError] = React.useState<string | null>(null);
  const [showManualFallback, setShowManualFallback] = React.useState(false);
  const [generatedWorkflow, setWorkflow] = React.useState<ConnectorWorkflow | null>(null);
  const workflow = cachedWorkflow ?? generatedWorkflow;
  const [workflowLoading, setWorkflowLoading] = React.useState(false);
  const [workflowUnavailable, setWorkflowUnavailable] = React.useState(false);
  const [runtimeInstructions, setRuntimeInstructions] = React.useState<string | null>(null);
  const [authorizationApproved, setAuthorizationApproved] = React.useState(false);
  const [settingsSaved, setSettingsSaved] = React.useState(false);
  const [setupVerified, setSetupVerified] = React.useState(false);
  const requestIdRef = React.useRef(0);
  const directSetupStartedRef = React.useRef(false);
  const connectionConfigured = configured || settingsSaved;

  const effectiveMode: TelegramMode = connectionConfigured && mode === "overview"
    ? "manage"
    : !connectionConfigured && (mode === "manage" || mode === "ready")
      ? "overview"
      : mode;
  const effectiveDisplayName = displayName ?? storedDisplayName;

  const validateToken = React.useCallback(() => {
    const trimmed = token.trim();
    if (!trimmed && connectionConfigured) return null;
    if (!trimmed) return "Enter the bot token.";
    if (!TELEGRAM_TOKEN_RE.test(trimmed)) return "That token format does not look right. Check the value provided by Telegram.";
    return null;
  }, [connectionConfigured, token]);

  const setupUserIds = parseTelegramUserIds(allowFromInput);
  const setupGroupUserIds = parseTelegramUserIds(groupAllowFromInput);
  const setupGroupIds = parseTelegramUserIds(groupIdsInput);
  function validateSetup() {
    const tokenError = validateToken();
    if (tokenError) return tokenError;
    if (!dmPolicy) return "Choose a direct-message policy or explicitly keep the current default.";
    if (!groupPolicy) return "Choose a group policy or explicitly keep the current default.";
    if (!connectorWorkflowInputControlIsValid("telegram.allowFrom", inputControls)) {
      return connectorWorkflowInputControlIsRequired("telegram.allowFrom", inputControls) && setupUserIds.length === 0
        ? "Allowlist access requires at least one numeric Telegram user ID."
        : "Direct-message user IDs must be numeric.";
    }
    if (connectorWorkflowInputControlIsVisible("telegram.groupAllowFrom", inputControls) && !inputControls["telegram.groupAllowFrom"]?.valid) {
      return "Group sender IDs must be numeric or an explicit wildcard.";
    }
    if (connectorWorkflowInputControlIsVisible("telegram.groups", inputControls) && !inputControls["telegram.groups"]?.valid) {
      return "Telegram group IDs must be numeric or an explicit wildcard.";
    }
    if (connectorWorkflowInputControlIsVisible("telegram.requireMention", inputControls) && !inputControls["telegram.requireMention"]?.valid) {
      return "Choose mention behavior or explicitly keep the current default.";
    }
    return null;
  }

  const verifyTelegram = async (options: { poll: boolean; nextModeOnStart?: TelegramMode; inline?: boolean } = { poll: false }): Promise<ConnectorWorkflowVerificationResult> => {
    if (!connectorsProvider && !onChannelProbe) {
      const message = "Telegram settings were saved, but connection testing is not available here.";
      if (!options.inline) {
        setError(message);
        setMode("failed");
      }
      return { success: false, message };
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setProbing(true);
    if (!options.inline) setError(null);
    if (options.nextModeOnStart) setMode(options.nextModeOnStart);

    const attempts = options.poll ? VERIFY_ATTEMPTS : 1;
    let failureMessage = "Telegram settings were saved, but the bot is not reachable yet.";
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if (connectorsProvider) {
          const descriptor = (await connectorsProvider.list({ connectorId: "telegram", probe: true })).find((candidate) => candidate.connectorId === "telegram");
          if (requestIdRef.current !== requestId) return { success: false };
          if (descriptor?.usable) {
            if (!options.inline) setMode("ready");
            else setSetupVerified(true);
            setProbing(false);
            return { success: true, message: "Telegram is online for this workspace." };
          }
          if ((!options.poll || attempt === attempts - 1) && !options.inline) {
            setError(failureMessage);
          }
          if (options.poll && attempt < attempts - 1) await sleep(VERIFY_INTERVAL_MS);
          continue;
        }
        const status = await onChannelProbe!();
        if (requestIdRef.current !== requestId) return { success: false };
        setProbeStatus(status);
        const entry = telegramChannelStatus(status);
        const nextDisplayName = telegramDisplayNameFrom(entry);
        if (nextDisplayName) setDisplayName(nextDisplayName);
        if (isTelegramLive(status)) {
          if (!options.inline) setMode("ready");
          else setSetupVerified(true);
          setProbing(false);
          return { success: true, message: nextDisplayName ? `Telegram is online as @${nextDisplayName}.` : "Telegram is online for this workspace." };
        }
        failureMessage = telegramProbeError(status) ?? failureMessage;
        if (!options.poll || attempt === attempts - 1) {
          if (!options.inline) setError(failureMessage);
        }
      } catch (cause) {
        if (requestIdRef.current !== requestId) return { success: false };
        if (!options.poll || attempt === attempts - 1) {
          failureMessage = redactTelegramSecrets(cause instanceof Error ? cause.message : "Could not test Telegram right now.");
          if (!options.inline) setError(failureMessage);
        }
      }

      if (options.poll && attempt < attempts - 1) await sleep(VERIFY_INTERVAL_MS);
    }

    if (requestIdRef.current === requestId) {
      if (!options.inline) setMode("failed");
      else setSetupVerified(false);
      setProbing(false);
    }
    return { success: false, message: failureMessage };
  };

  React.useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  const saveTelegram = async () => {
    const validationError = validateSetup();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!connectorsProvider && !onSaveConfig) {
      setError("Telegram setup is unavailable here.");
      return;
    }

    const accessSettings = currentTelegramAccessSettings();
    setSaving(true);
    setError(null);
    setShowManualFallback(false);
    try {
      if (connectorsProvider) {
        await connectorsProvider.configure("telegram", buildTelegramConfig(token, accessSettings));
      } else {
        await onSaveConfig!(buildTelegramPatch(token, accessSettings));
      }
      setToken("");
      setShowToken(false);
      setProbeStatus(null);
      setAuthorizationApproved(false);
      setSettingsSaved(true);
      setSetupVerified(false);
      setMode("saved");
    } catch (cause) {
      if (isGatewayRestartDuringSave(cause)) {
        setToken("");
        setShowToken(false);
        setProbeStatus(null);
        setAuthorizationApproved(false);
        setSettingsSaved(true);
        setSetupVerified(false);
        setMode("finish");
        return;
      }
      const protectedConfig = isProtectedConfigError(cause);
      setShowManualFallback(protectedConfig);
      setError(configured && protectedConfig
        ? "Could not patch Telegram settings from here. The agent can update the selected non-secret access controls directly."
        : configured
          ? "Could not patch Telegram settings from here. Try again."
          : null);
      setMode("setup");
    } finally {
      setSaving(false);
    }
  };

  const disconnectTelegram = async () => {
    if (!onSaveConfig) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setSaving(true);
    setError(null);
    try {
      await onSaveConfig({ channels: { telegram: null } });
      if (requestIdRef.current !== requestId) return;
      setProbeStatus(null);
      setDisplayName(null);
      setSettingsSaved(false);
      setSetupVerified(false);
      setMode("overview");
    } catch {
      setError("Could not disconnect Telegram. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const requestAgentAccessUpdate = async () => {
    if (!onAgentConfigUpdate || !configured) return;
    const validationError = validateSetup();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    setShowManualFallback(false);
    try {
      const accessSettings = currentTelegramAccessSettings();
      await onAgentConfigUpdate(buildTelegramAgentAccessPrompt({
        ...accessSettings,
        dmPolicy: accessSettings.dmPolicy || "runtime-default",
        groupPolicy: accessSettings.groupPolicy || "runtime-default",
        mentionChoice: accessSettings.mentionChoice || "runtime-default",
      }), TELEGRAM_AGENT_ACCESS_DISPLAY_PROMPT);
      setProbeStatus(null);
      setAuthorizationApproved(false);
      setMode("finish");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The agent could not update Telegram access settings.";
      setError(redactTelegramSecrets(message));
      setMode("failed");
    } finally {
      setSaving(false);
    }
  };

  const beginSetup = () => {
    setError(null);
    setShowManualFallback(false);
    setAuthorizationApproved(false);
    setMode("setup");
    if (!workflowLoading && (connectorsProvider || onGenerateConnectorWorkflow)) {
      setRuntimeInstructions(null);
      setWorkflowLoading(true);
      setWorkflowUnavailable(false);
      void (async () => {
        try {
          if (connectorsProvider) {
            const setup = await connectorsProvider.startSetup({ connectorId: "telegram", mode: "config" });
            const instructions = setup.instructions?.trim() || null;
            setRuntimeInstructions(instructions);
            if (instructions) return;
          }
          if (!onGenerateConnectorWorkflow) throw new Error("Generated connector guidance is unavailable.");
          setWorkflow(await onGenerateConnectorWorkflow("telegram"));
        } catch {
          if (!workflow) setWorkflowUnavailable(true);
        } finally {
          setWorkflowLoading(false);
        }
      })();
    }
  };
  const beginDirectSetup = React.useEffectEvent(beginSetup);

  React.useEffect(() => {
    if (!directSetup || configured || directSetupStartedRef.current) return;
    directSetupStartedRef.current = true;
    beginDirectSetup();
  }, [configured, directSetup]);

  const finishTelegramSetup = () => {
    setError(null);
    setShowManualFallback(false);
    setMode("manage");
    onReconnectGateway?.();
  };

  const continueTelegramSetup = () => {
    setError(null);
    setShowManualFallback(false);
    setMode("finish");
  };

  const live = isTelegramLive(probeStatus);
  const tone: TelegramTone = effectiveMode === "ready" || live || effectiveMode === "finish"
    ? "primary"
    : !connected || !runtimeAvailable
      ? "warning"
      : effectiveMode === "failed" || error
        ? "danger"
        : "neutral";
  const heroLabel = effectiveMode === "finish"
    ? "Message Telegram"
    : effectiveMode === "saved"
      ? "Settings saved"
    : !connected
      ? "Telegram setup"
      : !runtimeAvailable
        ? "Telegram unavailable"
        : effectiveMode === "setup"
          ? "Connect Telegram"
        : effectiveMode === "verifying"
          ? "Verifying bot"
          : effectiveMode === "ready" || live
            ? "Telegram online"
            : configured
              ? "Telegram configured"
              : "Connect Telegram";
  const heroSubtitle = effectiveMode === "finish"
    ? "Complete the remaining authorization steps, then refresh conversations."
    : effectiveMode === "saved"
      ? "Run the connection check, then continue to message authorization."
    : !connected
      ? "Reconnect the agent before saving Telegram settings."
      : !runtimeAvailable
        ? "Telegram setup is not available for this agent yet."
        : effectiveMode === "setup"
          ? workflow?.summary ?? runtimeInstructions ?? (workflowLoading ? "Preparing setup guidance." : "Complete each setup step, then save the protected settings.")
        : effectiveMode === "verifying"
          ? "Testing whether your bot is live and reachable."
          : effectiveMode === "ready" || live
            ? effectiveDisplayName ? `Your agent is reachable as @${effectiveDisplayName}.` : "Your agent can receive Telegram messages."
            : "Set up a Telegram bot without putting secrets in chat.";
  const telegramAccessHref = effectiveDisplayName ? `https://t.me/${effectiveDisplayName}` : null;
  const showTelegramAccess = Boolean(telegramAccessHref && (configured || effectiveMode === "ready" || live || effectiveMode === "failed"));
  const showSettingsHandoff = effectiveMode === "manage" && connectionConfigured && Boolean(onOpenIntegrationDetails);
  const shouldRenderDetails = Boolean(
    error ||
    showManualFallback ||
    !connected ||
    !runtimeAvailable ||
    effectiveMode === "setup" ||
    effectiveMode === "saved" ||
    effectiveMode === "finish" ||
    effectiveMode === "verifying" ||
    showSettingsHandoff ||
    ((effectiveMode === "ready" || live) && showTelegramAccess) ||
    effectiveMode === "failed" ||
    configured,
  );
  const telegramIconActive = effectiveMode === "setup" || effectiveMode === "saved" || effectiveMode === "finish" || effectiveMode === "verifying";
  const telegramStyle = {
    "--channel-accent": "var(--selection-accent)",
    "--channel-accent-foreground": "var(--selection-accent-foreground)",
    "--channel-accent-border": "color-mix(in srgb, var(--channel-accent) 45%, transparent)",
    "--channel-accent-shadow": "color-mix(in srgb, var(--channel-accent) 10%, transparent)",
  } as React.CSSProperties;
  const inputFallback = {
    id: "required-settings",
    title: "Choose Telegram access",
    instructions: "Choose how direct messages and groups should work. Relevant options appear as you make each choice, and only visible settings are saved.",
    inputSlots: [
      "telegram.botToken",
      "telegram.dmPolicy",
      "telegram.allowFrom",
      "telegram.groupPolicy",
      "telegram.groupAllowFrom",
      "telegram.groups",
      "telegram.requireMention",
    ] as ConnectorWorkflowInputSlot[],
  };
  const runtimeWorkflow: ConnectorWorkflow | null = runtimeInstructions ? {
    schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
    connectorId: "telegram",
    runtimeFingerprint: "runtime-provided",
    summary: "Follow the setup guidance reported by this workspace.",
    steps: [{
      id: "runtime-guidance",
      title: "Review setup guidance",
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
  const inputControls: ConnectorWorkflowInputControls = {
    "telegram.botToken": {
      valid: !validateToken(),
      value: token,
      content: (
        <div className="min-w-0 rounded-2xl border border-border bg-background/65 p-3 text-text-secondary">
          <label htmlFor="telegram-bot-token" className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Secure input</label>
          <p className="mt-1 text-lg font-black text-foreground">Bot token</p>
          <div className="relative mt-2 min-w-0">
            <input
              id="telegram-bot-token"
              aria-label="Telegram bot token"
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(event) => {
                setToken(event.target.value);
                setError(null);
              }}
              placeholder={connectionConfigured ? "Leave blank to keep existing token" : "Enter bot token"}
              autoComplete="off"
              spellCheck={false}
              className="h-14 w-full rounded-2xl border border-border bg-background/80 px-4 pr-12 font-mono text-base text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-text-muted focus:border-[var(--channel-accent)] sm:text-lg"
            />
            <button
              type="button"
              onClick={() => setShowToken((current) => !current)}
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-surface-low hover:text-foreground"
              aria-label={showToken ? "Hide Telegram token" : "Show Telegram token"}
            >
              {showToken ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-text-muted">This value is sent only when you approve saving the integration settings. It is never sent to the setup planner.</p>
        </div>
      ),
    },
    "telegram.allowFrom": {
      valid: valuesAreValid(setupUserIds, /^\d+$/),
      value: allowFromInput,
      visibleWhen: {
        all: [{ inputSlot: "telegram.dmPolicy", operator: "one-of", values: ["allowlist", "pairing"] }],
      },
      requiredWhen: {
        all: [{ inputSlot: "telegram.dmPolicy", operator: "equals", value: "allowlist" }],
      },
      disclosureWhen: {
        all: [{ inputSlot: "telegram.dmPolicy", operator: "equals", value: "pairing" }],
      },
      disclosureLabel: "Pre-authorize a user",
      content: (
        <div className="min-w-0 rounded-2xl border border-border bg-background/65 p-3 text-text-secondary">
          <label htmlFor="telegram-allow-from" className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Direct messages</label>
          <p className="mt-1 text-lg font-black text-foreground">Allowed user IDs</p>
          <input
            id="telegram-allow-from"
            value={allowFromInput}
            onChange={(event) => {
              setAllowFromInput(event.target.value);
              setError(null);
              setShowManualFallback(false);
            }}
            placeholder="123456789"
            inputMode="numeric"
            className="mt-2 h-14 w-full rounded-2xl border border-border bg-background/80 px-4 font-mono text-base text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-[var(--channel-accent)] sm:text-lg"
          />
          <p className="mt-2 text-[11px] leading-4 text-text-muted">Required for allowlist access and optional for pre-authorized pairing senders. Use numeric IDs, not usernames.</p>
        </div>
      ),
    },
    "telegram.dmPolicy": {
      valid: Boolean(dmPolicy),
      value: dmPolicy,
      content: (
        <div className="min-w-0 rounded-2xl border border-border bg-background/65 p-3 text-text-secondary">
          <label htmlFor="telegram-dm-policy" className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Direct messages</label>
          <p className="mt-1 text-lg font-black text-foreground">DM policy</p>
          <select
            id="telegram-dm-policy"
            aria-label="Telegram DM policy"
            value={dmPolicy}
            onChange={(event) => {
              setDmPolicy(event.target.value as PolicyChoice<DmPolicy>);
              setError(null);
            }}
            className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-[var(--channel-accent)]"
          >
            <option value="">Choose a DM policy</option>
            <option value="runtime-default">Keep current default</option>
            <option value="pairing">Pairing</option>
            <option value="allowlist">Allowlisted users</option>
            <option value="open">Open to anyone</option>
            <option value="disabled">Disabled</option>
          </select>
          <p className={`mt-2 text-[11px] leading-4 ${dmPolicy === "open" ? "text-warning" : "text-text-muted"}`}>
            {dmPolicy === "open" ? "Open access allows any Telegram account that finds the bot to contact it." : "Choose explicitly, or keep the current behavior."}
          </p>
        </div>
      ),
    },
    "telegram.groupPolicy": {
      valid: Boolean(groupPolicy),
      value: groupPolicy,
      content: (
        <div className="min-w-0 rounded-2xl border border-border bg-background/65 p-3 text-text-secondary">
          <label htmlFor="telegram-group-policy" className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Groups</label>
          <p className="mt-1 text-lg font-black text-foreground">Group policy</p>
          <select
            id="telegram-group-policy"
            aria-label="Telegram group policy"
            value={groupPolicy}
            onChange={(event) => {
              setGroupPolicy(event.target.value as PolicyChoice<GroupPolicy>);
              setError(null);
            }}
            className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-[var(--channel-accent)]"
          >
            <option value="">Choose a group policy</option>
            <option value="runtime-default">Keep current default</option>
            <option value="allowlist">Allowlisted senders</option>
            <option value="open">Open to group members</option>
            <option value="disabled">Disabled</option>
          </select>
          <p className="mt-2 text-[11px] leading-4 text-text-muted">This controls who may trigger the bot inside configured groups.</p>
        </div>
      ),
    },
    "telegram.groupAllowFrom": {
      valid: valuesAreValid(setupGroupUserIds, /^(?:\*|\d+)$/),
      value: groupAllowFromInput,
      visibleWhen: {
        all: [{ inputSlot: "telegram.groupPolicy", operator: "equals", value: "allowlist" }],
      },
      content: (
        <div className="min-w-0 rounded-2xl border border-border bg-background/65 p-3 text-text-secondary">
          <label htmlFor="telegram-group-allow-from" className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Groups</label>
          <p className="mt-1 text-lg font-black text-foreground">Allowed group sender IDs</p>
          <input
            id="telegram-group-allow-from"
            aria-label="Telegram allowed group sender IDs"
            value={groupAllowFromInput}
            onChange={(event) => {
              setGroupAllowFromInput(event.target.value);
              setError(null);
            }}
            placeholder="123456789 or *"
            className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 font-mono text-sm text-foreground outline-none placeholder:text-text-muted focus:border-[var(--channel-accent)]"
          />
          <p className="mt-2 text-[11px] leading-4 text-text-muted">Optional numeric user IDs. Use an explicit * only when every member of an allowed group should be accepted.</p>
        </div>
      ),
    },
    "telegram.groups": {
      valid: valuesAreValid(setupGroupIds, /^(?:\*|-?\d+)$/),
      value: groupIdsInput,
      visibleWhen: {
        all: [{ inputSlot: "telegram.groupPolicy", operator: "one-of", values: ["allowlist", "open"] }],
      },
      content: (
        <div className="min-w-0 rounded-2xl border border-border bg-background/65 p-3 text-text-secondary">
          <label htmlFor="telegram-group-ids" className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Groups</label>
          <p className="mt-1 text-lg font-black text-foreground">Telegram group IDs</p>
          <input
            id="telegram-group-ids"
            aria-label="Telegram group IDs"
            value={groupIdsInput}
            onChange={(event) => {
              setGroupIdsInput(event.target.value);
              setError(null);
            }}
            placeholder="-1001234567890 or *"
            className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 font-mono text-sm text-foreground outline-none placeholder:text-text-muted focus:border-[var(--channel-accent)]"
          />
          <p className="mt-2 text-[11px] leading-4 text-text-muted">Optional explicit group chat IDs. Leaving this empty does not silently enable every group.</p>
        </div>
      ),
    },
    "telegram.requireMention": {
      valid: Boolean(mentionChoice),
      value: mentionChoice,
      visibleWhen: {
        all: [
          { inputSlot: "telegram.groupPolicy", operator: "one-of", values: ["allowlist", "open"] },
          { inputSlot: "telegram.groups", operator: "not-empty" },
        ],
      },
      content: (
        <div className="min-w-0 rounded-2xl border border-border bg-background/65 p-3 text-text-secondary">
          <label htmlFor="telegram-mention-policy" className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Groups</label>
          <p className="mt-1 text-lg font-black text-foreground">Mention behavior</p>
          <select
            id="telegram-mention-policy"
            aria-label="Telegram mention behavior"
            value={mentionChoice}
            onChange={(event) => {
              setMentionChoice(event.target.value as MentionChoice);
              setError(null);
            }}
            className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-[var(--channel-accent)]"
          >
            <option value="">Choose mention behavior</option>
            <option value="runtime-default">Keep current default</option>
            <option value="required">Require a mention</option>
            <option value="not-required">Respond without a mention</option>
          </select>
          <p className="mt-2 text-[11px] leading-4 text-text-muted">Applied to every group ID listed above.</p>
        </div>
      ),
    },
  };
  const inputIsVisible = (inputSlot: ConnectorWorkflowInputSlot) => connectorWorkflowInputControlIsVisible(inputSlot, inputControls);
  const activeAuthorizationFlow = activeConnectorAuthorizationFlow(CONNECTOR_AUTHORIZATION_FLOWS, inputControls);
  function currentTelegramAccessSettings(): TelegramAccessSettings {
    return {
      dmPolicy,
      allowFrom: inputIsVisible("telegram.allowFrom") ? setupUserIds : [],
      groupPolicy,
      groupAllowFrom: inputIsVisible("telegram.groupAllowFrom") ? setupGroupUserIds : [],
      groupIds: inputIsVisible("telegram.groups") ? setupGroupIds : [],
      mentionChoice: inputIsVisible("telegram.requireMention") ? mentionChoice : "runtime-default",
    };
  }
  const setupValidationError = effectiveMode === "setup" ? validateSetup() : null;
  const setupLooksValid = !setupValidationError;

  return (
    <section
      className={`group relative mb-3 overflow-hidden rounded-[1.75rem] border bg-background shadow-2xl ${CARD_TONE_CLASS[tone]}`}
      style={telegramStyle}
      aria-live="polite"
    >
      <TelegramIcon
        className="pointer-events-none absolute -right-14 -top-10 h-52 w-52 rotate-12 opacity-[0.16] sm:-right-16 sm:h-64 sm:w-64"
        style={{ color: TELEGRAM_COLOR }}
      />
      <div className="relative z-10 p-4 pb-4 sm:p-5">
        <div className="flex items-center gap-4 sm:gap-5">
          <IntegrationBrandPulse active={telegramIconActive} accentColor={TELEGRAM_COLOR}>
            <TelegramIcon className="h-14 w-14 sm:h-[4.5rem] sm:w-[4.5rem]" />
          </IntegrationBrandPulse>
          <div className="min-w-0 flex-1">
            <motion.p
              key={heroLabel}
              initial={{ opacity: 0, y: 18, filter: "blur(7px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ type: "spring", stiffness: 330, damping: 32, mass: 0.8 }}
              className="truncate text-left text-[clamp(1.55rem,5.6vw,3.05rem)] font-black uppercase leading-[0.9] tracking-[0.01em]"
              style={{ color: TELEGRAM_COLOR }}
            >
              {heroLabel}
            </motion.p>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-secondary sm:text-sm">{heroSubtitle}</p>
          </div>
        </div>
      </div>

      {shouldRenderDetails ? (
      <motion.div
        data-telegram-body
        initial={{ opacity: 0, scaleY: 0.96, clipPath: "inset(0 0 100% 0)" }}
        animate={{ opacity: 1, scaleY: 1, clipPath: "inset(0 0 0% 0)" }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 origin-top overflow-hidden border-t border-border bg-surface-low/70 px-4 py-4 text-xs leading-5 text-text-secondary backdrop-blur-md sm:px-5"
      >
        {error ? <p role="alert" className="mb-3 rounded-md border border-destructive/25 bg-destructive/10 px-2.5 py-2 text-destructive">{error}</p> : null}
        {showManualFallback ? (
          <div className="mb-3 rounded-2xl border border-warning/25 bg-warning/10 p-3 text-warning">
            <p className="font-semibold text-foreground">Settings fallback</p>
            <p className="mt-1">{configured ? "The bot token is already stored. The agent can apply the access choices shown in this card without reading or replacing it." : "Apply the selected access settings locally:"}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Use the selected DM and group policies; do not substitute a different access model.</li>
              <li>Apply only the user IDs and group IDs entered above.</li>
              <li>{configured ? "Keep your existing bot token; do not paste it into chat." : "Apply the bot token through secure local settings; do not paste it into chat."}</li>
            </ul>
            {configured && onAgentConfigUpdate ? (
              <button type="button" className={`${buttonClass("primary")} mt-3`} disabled={saving} onClick={() => void requestAgentAccessUpdate()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Ask agent to apply access settings
              </button>
            ) : null}
          </div>
        ) : null}

        {effectiveMode === "finish" ? (
          activeAuthorizationFlow ? (
            <ConnectorAuthorizationGuide
              connectorId="telegram"
              displayName="Telegram"
              flow={activeAuthorizationFlow}
              provider={connectorsProvider}
              onApproved={() => setAuthorizationApproved(true)}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 sm:items-start">
              <div className="min-w-0 py-1">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">First</p>
                <p className="mt-1 text-lg font-black text-foreground">Open your bot</p>
                <p className="mt-1 text-[11px] leading-4 text-text-muted">Use the bot conversation described in the setup guidance.</p>
              </div>
              <div className="min-w-0 py-1">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Then</p>
                <p className="mt-1 text-lg font-black text-foreground">Send a message</p>
                <p className="mt-1 text-[11px] leading-4 text-text-muted">Any short message is fine. The session appears after the message arrives.</p>
              </div>
              <div className="min-w-0 py-1">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Finally</p>
                <p className="mt-1 text-lg font-black text-foreground">Finish here</p>
                <p className="mt-1 text-[11px] leading-4 text-text-muted">Click Finish after sending it to refresh sessions.</p>
              </div>
            </div>
          )
        ) : !connected ? (
          <div className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 px-3 py-2 text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Start or reconnect the agent before saving Telegram settings.</p>
          </div>
        ) : !runtimeAvailable ? (
          <div className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 px-3 py-2 text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Telegram setup is not available for this agent.</p>
          </div>
        ) : effectiveMode === "setup" || effectiveMode === "saved" ? (
          <div className="space-y-3">
            {effectiveMode === "saved" ? (
              <div className="flex items-start gap-3 rounded-2xl border border-[var(--channel-accent-border)] bg-selection-accent/10 px-3 py-3 text-selection-accent">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Settings are stored. Run the connection check below before continuing.</p>
              </div>
            ) : null}
            <ConnectorWorkflowGuide
              workflow={displayWorkflow}
              loading={workflowLoading}
              unavailable={workflowUnavailable && !runtimeInstructions}
              inputControls={inputControls}
              onRunShellProposal={onRunShellProposal}
              onVerifyConnection={() => verifyTelegram({ poll: true, inline: true })}
              verificationDisabled={effectiveMode !== "saved"}
              verificationDisabledReason={effectiveMode !== "saved" ? "Save settings before testing the connection." : undefined}
              onRetry={beginSetup}
            />
          </div>
        ) : effectiveMode === "verifying" ? (
          <div className="flex items-start gap-3 rounded-2xl border border-selection-accent/25 bg-selection-accent/10 px-3 py-3 text-selection-accent">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
            <p>Checking Telegram. This can take a moment while the workspace applies the new settings.</p>
          </div>
        ) : showSettingsHandoff ? (
          <div className="rounded-2xl border border-selection-accent/25 bg-selection-accent/10 p-3.5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-selection-accent" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">Manage Telegram settings</p>
                <p className="mt-1 text-[11px] leading-4 text-text-muted">Update access, privacy mode, bot credentials, and connection checks in Integrations.</p>
                <button type="button" className={`${buttonClass("primary")} mt-3`} onClick={onOpenIntegrationDetails}>
                  Open Telegram settings
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ) : effectiveMode === "ready" || live ? (
          showTelegramAccess && telegramAccessHref ? (
            <div className="flex items-start gap-3 rounded-2xl border border-success/25 bg-success/10 px-3 py-2 text-success">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <a href={telegramAccessHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-success hover:text-foreground hover:underline">
                Open @{effectiveDisplayName} on Telegram
              </a>
            </div>
          ) : null
        ) : effectiveMode === "failed" ? (
          <div className="flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Telegram is not reachable yet. Check the token, make sure the bot exists, then retry.</p>
          </div>
        ) : connectionConfigured ? (
          <div className="space-y-3">
            <p>Telegram settings are saved. Reconfigure the bot token if you need to update it.</p>
            {showTelegramAccess && telegramAccessHref ? (
              <a href={telegramAccessHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-selection-accent hover:text-foreground hover:underline">
                Open @{effectiveDisplayName} on Telegram
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>
        ) : null}
      </motion.div>
      ) : null}

      <div className="relative z-10 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface-high/35 px-4 py-3 backdrop-blur-md sm:px-5">
        {effectiveMode === "setup" ? (
          <>
            {!directSetup ? (
              <button type="button" className={buttonClass()} disabled={saving || probing} onClick={() => setMode(configured ? "manage" : "overview")}>
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>
            ) : null}
            <button type="button" className={buttonClass("primary")} disabled={!canConfigure || saving || probing || !setupLooksValid} onClick={() => void saveTelegram()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Save settings
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        ) : effectiveMode === "saved" ? (
          <>
            <button type="button" className={buttonClass()} disabled={saving || probing} onClick={beginSetup}>Edit settings</button>
            <button type="button" className={buttonClass("primary")} disabled={!setupVerified || probing} onClick={continueTelegramSetup}>
              Continue
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        ) : effectiveMode === "finish" ? (
          <>
            {showTelegramAccess && telegramAccessHref ? (
              <a href={telegramAccessHref} target="_blank" rel="noopener noreferrer" className={buttonClass()}>
                Open Telegram
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            <button
              type="button"
              className={buttonClass("primary")}
              disabled={!onReconnectGateway || Boolean(activeAuthorizationFlow && !authorizationApproved)}
              onClick={finishTelegramSetup}
            >
              Finish
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        ) : effectiveMode === "verifying" ? (
          <button type="button" className={buttonClass()} disabled>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Testing
          </button>
        ) : effectiveMode === "ready" || live ? (
          <>
            {showTelegramAccess && telegramAccessHref ? (
              <a href={telegramAccessHref} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>
                Open Telegram
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            <button type="button" className={buttonClass()} disabled={!canConfigure || saving} onClick={beginSetup}>Reconfigure</button>
            <button type="button" className={buttonClass("danger")} disabled={!canConfigure || saving} onClick={() => void disconnectTelegram()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Disconnect
            </button>
          </>
        ) : effectiveMode === "failed" ? (
          <>
            <button type="button" className={buttonClass("primary")} disabled={(!connectorsProvider && !onChannelProbe) || probing} onClick={() => void verifyTelegram({ poll: false, nextModeOnStart: "verifying" })}>
              {probing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Retry test
            </button>
            <button type="button" className={buttonClass()} disabled={!canConfigure || saving} onClick={beginSetup}>Edit settings</button>
            {configured ? (
              <button type="button" className={buttonClass("danger")} disabled={!canConfigure || saving} onClick={() => void disconnectTelegram()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Disconnect
              </button>
            ) : null}
          </>
        ) : connectionConfigured ? (
          <>
            {showTelegramAccess && telegramAccessHref ? (
              <a href={telegramAccessHref} target="_blank" rel="noopener noreferrer" className={buttonClass("primary")}>
                Open Telegram
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            <button type="button" className={buttonClass()} disabled={!canConfigure || saving} onClick={beginSetup}>Reconfigure</button>
            <button type="button" className={buttonClass("danger")} disabled={!canConfigure || saving} onClick={() => void disconnectTelegram()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Disconnect
            </button>
          </>
        ) : (
          <>
            {onOpenFullSetup && !canConfigure ? <button type="button" className={buttonClass()} onClick={onOpenFullSetup}>Open integrations</button> : null}
            <button type="button" className={buttonClass("primary")} disabled={!canConfigure} onClick={beginSetup}>
              Start setup
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {onOpenIntegrationDetails && !showSettingsHandoff ? <button type="button" className={buttonClass()} onClick={onOpenIntegrationDetails}>Open in integrations</button> : null}
        {onDismiss ? <button type="button" className={buttonClass()} onClick={onDismiss}><X className="h-3.5 w-3.5" />Dismiss</button> : null}
      </div>
    </section>
  );
}
