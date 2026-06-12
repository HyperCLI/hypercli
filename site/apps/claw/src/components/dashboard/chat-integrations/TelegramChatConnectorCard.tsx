"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";

import { isPluginConnected, schemaPathExists } from "@/components/dashboard/directory/directory-utils";
import { INTEGRATION_BRAND_LOGOS } from "@/components/dashboard/integrations/integration-brand-icons";
import { buildTelegramAgentAllowlistPrompt, TELEGRAM_AGENT_ALLOWLIST_DISPLAY_PROMPT } from "@/lib/telegram-config-workspace";
import { IntegrationBrandPulse } from "./IntegrationBrandPulse";

interface TelegramChatConnectorCardProps {
  connected: boolean;
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  agentName?: string | null;
  onSaveConfig?: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe?: () => Promise<Record<string, unknown>>;
  onAgentConfigUpdate?: (prompt: string, displayContent: string) => Promise<void>;
  onReconnectGateway?: () => void;
  onOpenFullSetup?: () => void;
  onDismiss?: () => void;
}

type TelegramTone = "neutral" | "primary" | "warning" | "danger";
type TelegramMode = "overview" | "setup" | "finish" | "verifying" | "ready" | "failed" | "manage";
type TelegramSetupStep = "bot" | "allowlist";
type DmPolicy = "allowlist" | "pairing" | "open" | "disabled";

const TELEGRAM_COLOR = INTEGRATION_BRAND_LOGOS.telegram.color;
const TelegramIcon = INTEGRATION_BRAND_LOGOS.telegram.icon;
const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{20,}$/;
const TOKEN_SHAPED_RE = /\b\d{5,}:[A-Za-z0-9_-]{20,}\b/g;
const VERIFY_ATTEMPTS = 6;
const VERIFY_INTERVAL_MS = 2500;

const SETUP_STEP_LABELS: Record<TelegramSetupStep, string> = {
  bot: "Create bot",
  allowlist: "Add user ID",
};

const SETUP_STEP_COPY: Record<TelegramSetupStep, string> = {
  bot: "Create the bot in Telegram first, then come back here.",
  allowlist: "Add the numeric Telegram user ID allowed to DM the agent.",
};

const CARD_TONE_CLASS: Record<TelegramTone, string> = {
  neutral: "border-border shadow-background/30",
  primary: "border-[#26a5e4]/45 shadow-[#26a5e4]/10",
  warning: "border-warning/40 shadow-warning/10",
  danger: "border-destructive/40 shadow-destructive/10",
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function userIdsAreValid(userIds: string[]): boolean {
  return userIds.length > 0 && userIds.every((id) => /^\d+$/.test(id));
}

function telegramBotNameSuggestion(agentName: string | null | undefined): string {
  const trimmed = agentName?.trim().replace(/\s+/g, " ");
  return trimmed || "HyperCLI Agent";
}

function telegramBotUsernameSuggestion(agentName: string | null | undefined): string {
  const words = telegramBotNameSuggestion(agentName).match(/[A-Za-z0-9]+/g) ?? ["agent"];
  const base = words
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? lower : `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join("")
    .replace(/^[^A-Za-z]+/, "");
  const safeBase = (base || "agent").slice(0, 28);
  return `${safeBase}_bot`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buttonClass(tone: "primary" | "secondary" | "danger" = "secondary") {
  if (tone === "primary") {
    return "inline-flex h-8 items-center gap-1.5 rounded-full bg-button-primary px-3 text-xs font-black uppercase tracking-[0.12em] text-button-primary-foreground shadow-[0_0_24px_rgba(38,165,228,0.22)] transition-all hover:-translate-y-0.5 hover:bg-button-primary-hover disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
  }
  if (tone === "danger") {
    return "inline-flex h-8 items-center gap-1.5 rounded-full border border-destructive/35 bg-destructive/10 px-3 text-xs font-black uppercase tracking-[0.12em] text-destructive transition-all hover:-translate-y-0.5 hover:bg-destructive/15 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
  }
  return "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-low/70 px-3 text-xs font-black uppercase tracking-[0.12em] text-text-secondary backdrop-blur transition-all hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-high hover:text-foreground disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-50";
}

function buildTelegramPatch(token: string, dmPolicy: DmPolicy, requireMention: boolean, allowFrom: string[]): Record<string, unknown> {
  const telegramConfig: Record<string, unknown> = {
    enabled: true,
    dmPolicy,
    groups: { "*": { requireMention } },
  };
  if (token.trim()) telegramConfig.botToken = token.trim();
  if (dmPolicy === "allowlist") telegramConfig.allowFrom = allowFrom;
  return {
    channels: {
      telegram: telegramConfig,
    },
  };
}

function setupStepsFor(): TelegramSetupStep[] {
  return ["bot", "allowlist"];
}

function nextSetupStep(step: TelegramSetupStep): TelegramSetupStep | null {
  const steps = setupStepsFor();
  const index = steps.indexOf(step);
  if (index === -1) return steps[0] ?? null;
  return steps[index + 1] ?? null;
}

function previousSetupStep(step: TelegramSetupStep): TelegramSetupStep | null {
  const steps = setupStepsFor();
  const index = steps.indexOf(step);
  if (index <= 0) return null;
  return steps[index - 1] ?? null;
}

export function TelegramChatConnectorCard({
  connected,
  config,
  configSchema,
  agentName,
  onSaveConfig,
  onChannelProbe,
  onAgentConfigUpdate,
  onReconnectGateway,
  onOpenFullSetup,
  onDismiss,
}: TelegramChatConnectorCardProps) {
  const currentConfig = telegramConfig(config);
  const configured = isPluginConnected("telegram", config);
  const storedDisplayName = telegramDisplayNameFrom(currentConfig);
  const configuredAllowFrom = stringArray(currentConfig?.allowFrom);
  const hasCapability = hasTelegramCapability(configSchema);
  const canConfigure = connected && hasCapability && Boolean(onSaveConfig);
  const initialMode: TelegramMode = configured ? "manage" : "overview";
  const [mode, setMode] = React.useState<TelegramMode>(initialMode);
  const [setupStep, setSetupStep] = React.useState<TelegramSetupStep>("bot");
  const [token, setToken] = React.useState("");
  const [showToken, setShowToken] = React.useState(false);
  const [copiedCommand, setCopiedCommand] = React.useState<string | null>(null);
  const [allowFromInput, setAllowFromInput] = React.useState(configuredAllowFrom.join(", "));
  const [savedAllowFrom, setSavedAllowFrom] = React.useState<string[]>(configuredAllowFrom);
  const [saving, setSaving] = React.useState(false);
  const [probing, setProbing] = React.useState(false);
  const [probeStatus, setProbeStatus] = React.useState<Record<string, unknown> | null>(null);
  const [displayName, setDisplayName] = React.useState<string | null>(storedDisplayName);
  const [error, setError] = React.useState<string | null>(null);
  const [showManualFallback, setShowManualFallback] = React.useState(false);
  const requestIdRef = React.useRef(0);
  const copiedCommandTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const effectiveMode: TelegramMode = configured && mode === "overview"
    ? "manage"
    : !configured && (mode === "manage" || mode === "ready")
      ? "overview"
      : mode;
  const effectiveDisplayName = displayName ?? storedDisplayName;
  const botNameSuggestion = telegramBotNameSuggestion(agentName);
  const botUsernameSuggestion = telegramBotUsernameSuggestion(agentName);

  const validateToken = React.useCallback(() => {
    const trimmed = token.trim();
    if (!trimmed && configured) return null;
    if (!trimmed) return "Enter the bot token from BotFather.";
    if (!TELEGRAM_TOKEN_RE.test(trimmed)) return "That token format does not look right. Check the value from BotFather.";
    return null;
  }, [configured, token]);

  const setupUserIds = parseTelegramUserIds(allowFromInput);
  const effectiveAllowFrom = savedAllowFrom.length > 0 ? savedAllowFrom : configuredAllowFrom;
  const validateSetup = React.useCallback(() => {
    const tokenError = validateToken();
    if (tokenError) return tokenError;
    if (!userIdsAreValid(setupUserIds)) {
      return "Enter at least one numeric Telegram user ID for the allowlist.";
    }
    return null;
  }, [setupUserIds, validateToken]);

  const verifyTelegram = async (options: { poll: boolean; nextModeOnStart?: TelegramMode } = { poll: false }) => {
    if (!onChannelProbe) {
      setError("Telegram settings were saved, but connection testing is not available here.");
      setMode("failed");
      return false;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setProbing(true);
    setError(null);
    if (options.nextModeOnStart) setMode(options.nextModeOnStart);

    const attempts = options.poll ? VERIFY_ATTEMPTS : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const status = await onChannelProbe();
        if (requestIdRef.current !== requestId) return false;
        setProbeStatus(status);
        const entry = telegramChannelStatus(status);
        const nextDisplayName = telegramDisplayNameFrom(entry);
        if (nextDisplayName) setDisplayName(nextDisplayName);
        if (isTelegramLive(status)) {
          setMode("ready");
          setProbing(false);
          return true;
        }
        if (!options.poll || attempt === attempts - 1) {
          setError(telegramProbeError(status) ?? "Telegram settings were saved, but the bot is not reachable yet.");
        }
      } catch (cause) {
        if (requestIdRef.current !== requestId) return false;
        if (!options.poll || attempt === attempts - 1) {
          const message = cause instanceof Error ? cause.message : "Could not test Telegram right now.";
          setError(redactTelegramSecrets(message));
        }
      }

      if (options.poll && attempt < attempts - 1) await sleep(VERIFY_INTERVAL_MS);
    }

    if (requestIdRef.current === requestId) {
      setMode("failed");
      setProbing(false);
    }
    return false;
  };

  React.useEffect(() => () => {
    requestIdRef.current += 1;
    if (copiedCommandTimerRef.current) clearTimeout(copiedCommandTimerRef.current);
  }, []);

  const copyTelegramCommand = async (command: string) => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setError(`Could not copy ${command}. Select it manually.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
      if (copiedCommandTimerRef.current) clearTimeout(copiedCommandTimerRef.current);
      copiedCommandTimerRef.current = setTimeout(() => {
        setCopiedCommand(null);
        copiedCommandTimerRef.current = null;
      }, 1800);
    } catch {
      setError(`Could not copy ${command}. Select it manually.`);
    }
  };

  const saveTelegram = async () => {
    const validationError = validateSetup();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!onSaveConfig) {
      setError("Telegram setup is unavailable here.");
      return;
    }

    const allowFrom = setupUserIds;
    setSaving(true);
    setError(null);
    setShowManualFallback(false);
    try {
      await onSaveConfig(buildTelegramPatch(token, "allowlist", true, allowFrom));
      setSavedAllowFrom(allowFrom);
      setToken("");
      setShowToken(false);
      setProbeStatus(null);
      setMode("finish");
    } catch (cause) {
      if (isGatewayRestartDuringSave(cause)) {
        setSavedAllowFrom(allowFrom);
        setToken("");
        setShowToken(false);
        setProbeStatus(null);
        setMode("finish");
        return;
      }
      const protectedConfig = isProtectedConfigError(cause);
      setShowManualFallback(protectedConfig);
      setError(configured && protectedConfig
        ? "Could not patch Telegram settings from here. The agent can update the non-secret allowlist directly."
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
      setSavedAllowFrom([]);
      setMode("overview");
    } catch {
      setError("Could not disconnect Telegram. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const requestAgentAllowlistUpdate = async () => {
    if (!onAgentConfigUpdate || !configured) return;
    const userIds = setupUserIds.length > 0 ? setupUserIds : effectiveAllowFrom;
    if (!userIdsAreValid(userIds)) {
      setError("Enter a numeric Telegram user ID before asking the agent to update the allowlist.");
      return;
    }

    setSaving(true);
    setError(null);
    setShowManualFallback(false);
    try {
      await onAgentConfigUpdate(buildTelegramAgentAllowlistPrompt(userIds, true), TELEGRAM_AGENT_ALLOWLIST_DISPLAY_PROMPT);
      setSavedAllowFrom(userIds);
      setProbeStatus(null);
      setMode("finish");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The agent could not update Telegram allowlist settings.";
      setError(redactTelegramSecrets(message));
      setMode("failed");
    } finally {
      setSaving(false);
    }
  };

  const beginSetup = () => {
    setSetupStep("bot");
    setError(null);
    setShowManualFallback(false);
    setMode("setup");
  };

  const finishTelegramSetup = () => {
    setError(null);
    setShowManualFallback(false);
    setMode("manage");
    onReconnectGateway?.();
  };

  const setupSteps = setupStepsFor();
  const effectiveSetupStep = setupSteps.includes(setupStep) ? setupStep : "bot";
  const setupStepCanContinue = effectiveSetupStep === "bot"
    ? !validateToken()
    : effectiveSetupStep === "allowlist"
      ? userIdsAreValid(setupUserIds)
      : true;

  const goPreviousSetupStep = () => {
    const previous = previousSetupStep(effectiveSetupStep);
    if (previous) {
      setSetupStep(previous);
      return;
    }
    setMode(configured ? "manage" : "overview");
  };

  const goNextSetupStep = () => {
    const next = nextSetupStep(effectiveSetupStep);
    if (next) setSetupStep(next);
  };

  const live = isTelegramLive(probeStatus);
  const tone: TelegramTone = effectiveMode === "ready" || live || effectiveMode === "finish"
    ? "primary"
    : !connected || !hasCapability
      ? "warning"
      : effectiveMode === "failed" || error
        ? "danger"
        : "neutral";
  const heroLabel = effectiveMode === "finish"
    ? "Message Telegram"
    : !connected
      ? "Telegram setup"
      : !hasCapability
        ? "Telegram unavailable"
        : effectiveMode === "setup"
          ? SETUP_STEP_LABELS[effectiveSetupStep]
        : effectiveMode === "verifying"
          ? "Verifying bot"
          : effectiveMode === "ready" || live
            ? "Telegram online"
            : configured
              ? "Telegram configured"
              : "Connect Telegram";
  const heroSubtitle = effectiveMode === "finish"
    ? "Send one Telegram message so the workspace can create the Telegram project."
    : !connected
      ? "Reconnect the agent before saving Telegram settings."
      : !hasCapability
        ? "This agent does not advertise Telegram channel settings yet."
        : effectiveMode === "setup"
          ? SETUP_STEP_COPY[effectiveSetupStep]
        : effectiveMode === "verifying"
          ? "Testing whether your bot is live and reachable."
          : effectiveMode === "ready" || live
            ? effectiveDisplayName ? `Your agent is reachable as @${effectiveDisplayName}.` : "Your agent can receive Telegram messages."
            : "Set up a Telegram bot without putting secrets in chat.";
  const setupValidationError = effectiveMode === "setup" ? validateSetup() : null;
  const setupLooksValid = !setupValidationError;
  const telegramAccessHref = effectiveDisplayName ? `https://t.me/${effectiveDisplayName}` : null;
  const showTelegramAccess = Boolean(telegramAccessHref && (configured || effectiveMode === "ready" || live || effectiveMode === "failed"));
  const shouldRenderDetails = Boolean(
    error ||
    showManualFallback ||
    !connected ||
    !hasCapability ||
    effectiveMode === "setup" ||
    effectiveMode === "finish" ||
    effectiveMode === "verifying" ||
    ((effectiveMode === "ready" || live) && showTelegramAccess) ||
    effectiveMode === "failed" ||
    configured,
  );
  const telegramIconActive = effectiveMode === "setup" || effectiveMode === "finish" || effectiveMode === "verifying";

  return (
    <section className={`group relative mb-3 overflow-hidden rounded-[1.75rem] border bg-background shadow-2xl ${CARD_TONE_CLASS[tone]}`} aria-live="polite">
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
              className="truncate text-left text-[clamp(1.55rem,5.6vw,3.05rem)] font-black uppercase leading-[0.9] tracking-[0.01em] text-[#26a5e4]"
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
            <p className="mt-1">{configured ? "The bot token is already stored. The agent can update only the non-secret allowlist settings." : "Apply these settings locally:"}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>Set <span className="font-mono text-foreground">channels.telegram.dmPolicy</span> to <span className="font-mono text-foreground">allowlist</span>.</li>
              <li>Set <span className="font-mono text-foreground">channels.telegram.allowFrom</span> to your numeric Telegram user ID.</li>
              <li>{configured ? "Keep your existing bot token; do not paste it into chat." : "Apply the bot token through secure local settings; do not paste it into chat."}</li>
            </ul>
            {configured && onAgentConfigUpdate ? (
              <button type="button" className={`${buttonClass("primary")} mt-3`} disabled={saving} onClick={() => void requestAgentAllowlistUpdate()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Ask agent to update allowlist
              </button>
            ) : null}
          </div>
        ) : null}

        {effectiveMode === "finish" ? (
          <div className="grid gap-3 sm:grid-cols-3 sm:items-start">
            <div className="min-w-0 py-1">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">First</p>
              <p className="mt-1 text-lg font-black text-foreground">Open your bot</p>
              <p className="mt-1 text-[11px] leading-4 text-text-muted">Use the Telegram chat you started with <span className="font-mono text-foreground">/start</span>.</p>
            </div>
            <div className="min-w-0 py-1">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Then</p>
              <p className="mt-1 text-lg font-black text-foreground">Send a message</p>
              <p className="mt-1 text-[11px] leading-4 text-text-muted">Any short message is fine. The Telegram project appears after the first message arrives.</p>
            </div>
            <div className="min-w-0 py-1">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Finally</p>
              <p className="mt-1 text-lg font-black text-foreground">Finish here</p>
              <p className="mt-1 text-[11px] leading-4 text-text-muted">Click Finish after sending it to refresh projects.</p>
            </div>
          </div>
        ) : !connected ? (
          <div className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 px-3 py-2 text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Start or reconnect the agent before saving Telegram settings.</p>
          </div>
        ) : !hasCapability ? (
          <div className="flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/10 px-3 py-2 text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Telegram is not available in this workspace configuration.</p>
          </div>
        ) : effectiveMode === "setup" ? (
          <div className="space-y-3">
            {effectiveSetupStep === "bot" ? (
              <motion.div
                key="bot"
                initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ type: "spring", stiffness: 340, damping: 34, mass: 0.72 }}
                className="relative text-text-secondary"
              >
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:items-start">
                    <div className="min-w-0 py-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">First</p>
                      <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-lg font-black text-[#8edcff] transition-colors hover:text-[#26a5e4] hover:underline">
                        Message @BotFather <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                    <div className="min-w-0 py-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Then</p>
                      <p className="mt-1 text-lg font-black text-foreground">Create a new bot</p>
                      <p className="mt-1 text-[11px] leading-4 text-text-muted">
                        Use{" "}
                        <button
                          type="button"
                          aria-label="Copy Telegram command /newbot"
                          title="Copy /newbot"
                          onClick={() => void copyTelegramCommand("/newbot")}
                          className="inline-flex items-center gap-1 rounded-md border border-[#26a5e4]/25 bg-[#26a5e4]/10 px-1.5 py-0.5 font-mono text-[#8edcff] transition-colors hover:bg-[#26a5e4]/18 hover:text-foreground"
                        >
                          <span>/newbot</span>
                          {copiedCommand === "/newbot" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {copiedCommand === "/newbot" ? <span className="font-sans text-[10px] font-black uppercase tracking-[0.12em]">Copied</span> : null}
                        </button>{" "}
                        to start the bot flow.
                      </p>
                    </div>
                    <div className="min-w-0 py-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Then</p>
                      <p className="mt-1 text-lg font-black text-foreground">Give it a name</p>
                      <p className="mt-1 text-[11px] leading-4 text-text-muted">
                        Preferably{" "}
                        <button
                          type="button"
                          aria-label={`Copy Telegram bot name ${botNameSuggestion}`}
                          title={`Copy ${botNameSuggestion}`}
                          onClick={() => void copyTelegramCommand(botNameSuggestion)}
                          className="inline-flex max-w-full items-center gap-1 rounded-md border border-[#26a5e4]/25 bg-[#26a5e4]/10 px-1.5 py-0.5 font-mono text-[#8edcff] transition-colors hover:bg-[#26a5e4]/18 hover:text-foreground"
                        >
                          <span className="truncate">{botNameSuggestion}</span>
                          {copiedCommand === botNameSuggestion ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
                          {copiedCommand === botNameSuggestion ? <span className="font-sans text-[10px] font-black uppercase tracking-[0.12em]">Copied</span> : null}
                        </button>
                        .
                      </p>
                    </div>
                    <div className="min-w-0 py-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Then</p>
                      <p className="mt-1 text-lg font-black text-foreground">Give it a username</p>
                      <p className="mt-1 text-[11px] leading-4 text-text-muted">
                        Preferably{" "}
                        <button
                          type="button"
                          aria-label={`Copy Telegram bot username ${botUsernameSuggestion}`}
                          title={`Copy ${botUsernameSuggestion}`}
                          onClick={() => void copyTelegramCommand(botUsernameSuggestion)}
                          className="inline-flex max-w-full items-center gap-1 rounded-md border border-[#26a5e4]/25 bg-[#26a5e4]/10 px-1.5 py-0.5 font-mono text-[#8edcff] transition-colors hover:bg-[#26a5e4]/18 hover:text-foreground"
                        >
                          <span className="truncate">{botUsernameSuggestion}</span>
                          {copiedCommand === botUsernameSuggestion ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
                          {copiedCommand === botUsernameSuggestion ? <span className="font-sans text-[10px] font-black uppercase tracking-[0.12em]">Copied</span> : null}
                        </button>
                        . BotFather sends the token after this.
                      </p>
                    </div>
                    <div className="min-w-0 py-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Then</p>
                      <p className="mt-1 text-lg font-black text-foreground">Paste the token</p>
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
                          placeholder={configured ? "Leave blank to keep existing token" : "Paste token from BotFather"}
                          autoComplete="off"
                          spellCheck={false}
                          className="h-14 w-full rounded-2xl border border-border bg-background/80 px-4 pr-12 font-mono text-base text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-text-muted focus:border-[#26a5e4]/55 sm:text-lg"
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
                      <p className="mt-2 text-[11px] leading-4 text-text-muted">It stays local until you save.</p>
                    </div>
                    <div className="min-w-0 py-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Finally</p>
                      <p className="mt-1 text-lg font-black text-foreground">Message it</p>
                      <p className="mt-1 text-[11px] leading-4 text-text-muted">
                        Open your new bot, send{" "}
                        <button
                          type="button"
                          aria-label="Copy Telegram command /start"
                          title="Copy /start"
                          onClick={() => void copyTelegramCommand("/start")}
                          className="inline-flex items-center gap-1 rounded-md border border-[#26a5e4]/25 bg-[#26a5e4]/10 px-1.5 py-0.5 font-mono text-[#8edcff] transition-colors hover:bg-[#26a5e4]/18 hover:text-foreground"
                        >
                          <span>/start</span>
                          {copiedCommand === "/start" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {copiedCommand === "/start" ? <span className="font-sans text-[10px] font-black uppercase tracking-[0.12em]">Copied</span> : null}
                        </button>
                        , then come back here and click Continue.
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="allowlist"
                initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ type: "spring", stiffness: 340, damping: 34, mass: 0.72 }}
                className="relative text-text-secondary"
              >
                <div className="grid gap-3 sm:grid-cols-3 sm:items-start">
                  <div className="min-w-0 py-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">First</p>
                    <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-lg font-black text-[#8edcff] transition-colors hover:text-[#26a5e4] hover:underline">
                      Open @userinfobot <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  <div className="min-w-0 py-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Then</p>
                    <p className="mt-1 text-lg font-black text-foreground">Hit Start</p>
                    <p className="mt-1 text-[11px] leading-4 text-text-muted">
                      It replies with a number like <span className="font-mono text-foreground">123456789</span>. Telegram usernames cannot be used for this allowlist.
                    </p>
                  </div>
                  <div className="min-w-0 py-1">
                    <label htmlFor="telegram-allow-from" className="text-[10px] font-black uppercase tracking-[0.18em] text-text-muted">Finally</label>
                    <p className="mt-1 text-lg font-black text-foreground">Paste it here</p>
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
                      className="mt-2 h-14 w-full rounded-2xl border border-border bg-background/80 px-4 font-mono text-base text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-[#26a5e4]/55 sm:text-lg"
                    />
                    <p className="mt-2 text-[11px] leading-4 text-text-muted">Only this Telegram user can DM the agent.</p>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        ) : effectiveMode === "verifying" ? (
          <div className="flex items-start gap-3 rounded-2xl border border-[#26a5e4]/25 bg-[#26a5e4]/10 px-3 py-3 text-[#8edcff]">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
            <p>Checking Telegram. This can take a moment while the workspace applies the new settings.</p>
          </div>
        ) : effectiveMode === "ready" || live ? (
          showTelegramAccess && telegramAccessHref ? (
            <div className="flex items-start gap-3 rounded-2xl border border-[#26a5e4]/25 bg-[#26a5e4]/10 px-3 py-2 text-[#8edcff]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <a href={telegramAccessHref} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#8edcff] hover:text-foreground hover:underline">
                Open @{effectiveDisplayName} on Telegram
              </a>
            </div>
          ) : null
        ) : effectiveMode === "failed" ? (
          <div className="flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Telegram is not reachable yet. Check the token, make sure the bot exists, then retry.</p>
          </div>
        ) : configured ? (
          <div className="space-y-3">
            <p>Telegram settings are saved. Reconfigure the bot token if you need to update it.</p>
            {showTelegramAccess && telegramAccessHref ? (
              <a href={telegramAccessHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-[#8edcff] hover:text-foreground hover:underline">
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
            <button type="button" className={buttonClass()} disabled={saving || probing} onClick={goPreviousSetupStep}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            {effectiveSetupStep === "allowlist" ? (
              <button type="button" className={buttonClass("primary")} disabled={!canConfigure || saving || probing || !setupLooksValid} onClick={() => void saveTelegram()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save settings
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button type="button" className={buttonClass("primary")} disabled={saving || probing || !setupStepCanContinue} onClick={goNextSetupStep}>
                Continue
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        ) : effectiveMode === "finish" ? (
          <>
            {showTelegramAccess && telegramAccessHref ? (
              <a href={telegramAccessHref} target="_blank" rel="noopener noreferrer" className={buttonClass()}>
                Open Telegram
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
            <button type="button" className={buttonClass("primary")} disabled={!onReconnectGateway} onClick={finishTelegramSetup}>
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
            <button type="button" className={buttonClass("primary")} disabled={!onChannelProbe || probing} onClick={() => void verifyTelegram({ poll: false, nextModeOnStart: "verifying" })}>
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
        ) : configured ? (
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
        {onDismiss ? <button type="button" className={buttonClass()} onClick={onDismiss}><X className="h-3.5 w-3.5" />Dismiss</button> : null}
      </div>
    </section>
  );
}
