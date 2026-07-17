"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import type { AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";
import type { AgentChannelsProvider } from "@hypercli.com/sdk/channels";
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { motion } from "framer-motion";

import { INTEGRATION_BRAND_LOGOS } from "@/components/dashboard/integrations/integration-brand-icons";
import {
  CONNECTOR_WORKFLOW_SCHEMA_ID,
  ensureConnectorWorkflowInputSlots,
  type ConnectorId,
  type ConnectorWorkflow,
  type ConnectorWorkflowInputSlot,
} from "@/lib/connector-workflow";
import {
  connectorWorkflowInputControlIsVisible,
  ConnectorWorkflowGuide,
  type ConnectorWorkflowInputControls,
  type ConnectorWorkflowInputVisibility,
} from "./ConnectorWorkflowGuide";
import { IntegrationBrandPulse } from "./IntegrationBrandPulse";

export type AdditionalChannelConnectorId = "discord" | "slack" | "whatsapp";

interface ChannelChatConnectorCardProps {
  channelId: AdditionalChannelConnectorId;
  connected: boolean;
  config: Record<string, unknown> | null;
  connectorsProvider?: AgentConnectorsProvider | null;
  channelsProvider?: AgentChannelsProvider | null;
  onSaveConfig?: (patch: Record<string, unknown>) => Promise<void>;
  onGenerateConnectorWorkflow?: (connectorId: ConnectorId) => Promise<ConnectorWorkflow>;
  onRunShellProposal?: (command: string) => Promise<void>;
  onReconnectGateway?: () => void;
  onOpenIntegrationDetails?: () => void;
  onOpenFullSetup?: () => void;
  onDismiss?: () => void;
}

type CardMode = "overview" | "setup" | "saved" | "verifying" | "ready" | "failed" | "manage";
type FieldValues = Record<string, string>;

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
    description: "Connect a workspace app through the runtime.",
    fields: [
      { key: "botToken", label: "Bot token", placeholder: "xoxb-...", sensitive: true, help: "Bot User OAuth token. It never enters chat or setup guidance." },
      { key: "appToken", label: "App token", placeholder: "xapp-...", sensitive: true, help: "Socket Mode app token. It is sent only when you save." },
    ],
  },
  whatsapp: {
    displayName: "WhatsApp",
    description: "Pair this workspace using the setup method reported by the runtime.",
    fields: [],
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function configuredChannel(config: Record<string, unknown> | null, channelId: AdditionalChannelConnectorId): boolean {
  const channels = asRecord(config?.channels);
  return Boolean(asRecord(channels?.[channelId]));
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
  onGenerateConnectorWorkflow,
  onRunShellProposal,
  onReconnectGateway,
  onOpenIntegrationDetails,
  onOpenFullSetup,
  onDismiss,
}: ChannelChatConnectorCardProps) {
  const definition = CHANNEL_DEFINITIONS[channelId];
  const brand = INTEGRATION_BRAND_LOGOS[channelId];
  const Icon = brand.icon;
  const configuredFromConfig = configuredChannel(config, channelId);
  const [mode, setMode] = useState<CardMode>(configuredFromConfig ? "manage" : "overview");
  const [runtimeConfigured, setRuntimeConfigured] = useState<boolean | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [workflow, setWorkflow] = useState<ConnectorWorkflow | null>(null);
  const [runtimeInstructions, setRuntimeInstructions] = useState<string | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowUnavailable, setWorkflowUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = runtimeConfigured ?? configuredFromConfig;
  const canConfigure = connected && Boolean(connectorsProvider || onSaveConfig);
  const canRemove = Boolean(onSaveConfig || channelsProvider?.removeConfig);
  const active = mode === "setup" || mode === "saved" || mode === "verifying";
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

  const beginSetup = () => {
    setMode("setup");
    setError(null);
    setWorkflowUnavailable(false);
    if (workflowLoading) return;
    setWorkflow(null);
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
        setWorkflow(null);
        setWorkflowUnavailable(true);
      } finally {
        setWorkflowLoading(false);
      }
    })();
  };

  const save = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!connectorsProvider && !onSaveConfig) {
      setError(`${definition.displayName} setup is unavailable here.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const nextConfig = channelConfig(channelId, activeValues);
      if (connectorsProvider) await connectorsProvider.configure(channelId, nextConfig);
      else await onSaveConfig!({ channels: { [channelId]: nextConfig } });
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

  const verify = async () => {
    if (!connectorsProvider && !channelsProvider) {
      setError("Connection testing is unavailable here.");
      return;
    }
    setMode("verifying");
    setProbing(true);
    setError(null);
    try {
      if (connectorsProvider) {
        const connector = (await connectorsProvider.list({ connectorId: channelId, probe: true })).find((candidate) => candidate.connectorId === channelId);
        if (connector?.usable) {
          setRuntimeConfigured(true);
          setMode("ready");
          return;
        }
      } else if (channelsProvider) {
        const channel = (await channelsProvider.list({ probe: true })).find((candidate) => candidate.channelId === channelId);
        if (channel?.configured && channel.running === true && channel.healthState !== "unhealthy") {
          setRuntimeConfigured(true);
          setAccountName(channel.accountDisplayName ?? null);
          setMode("ready");
          return;
        }
      }
      setError(`${definition.displayName} is configured but not reachable yet.`);
      setMode("failed");
    } catch {
      setError(`Could not test ${definition.displayName} right now.`);
      setMode("failed");
    } finally {
      setProbing(false);
    }
  };

  const disconnect = async () => {
    if (!canRemove) return;
    setSaving(true);
    setError(null);
    try {
      if (onSaveConfig) await onSaveConfig({ channels: { [channelId]: null } });
      else await channelsProvider?.removeConfig?.(channelId);
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

  const heroLabel = !connected
    ? `${definition.displayName} setup`
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
  const heroSubtitle = mode === "setup"
    ? workflow?.summary ?? runtimeInstructions ?? (workflowLoading ? "Preparing guidance for this workspace version." : definition.description)
    : mode === "saved"
      ? "Complete any remaining runtime steps, then test the connection."
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
  const fallbackWorkflow: ConnectorWorkflow | null = !workflowLoading && inputSlots.length > 0 ? {
    schema: CONNECTOR_WORKFLOW_SCHEMA_ID,
    connectorId: channelId,
    runtimeFingerprint: "workspace-inputs",
    summary: definition.description,
    steps: [
      ...(runtimeInstructions ? [{
        id: "runtime-guidance",
        title: "Review runtime guidance",
        instructions: runtimeInstructions,
        kind: "instruction" as const,
        approvalRequired: false,
      }] : []),
      {
        ...inputFallback,
        kind: "input" as const,
        approvalRequired: false,
      },
    ],
  } : null;
  const workflowWithRuntimeInstructions = workflow && runtimeInstructions ? {
    ...workflow,
    steps: [{
      id: "runtime-guidance",
      title: "Review runtime guidance",
      instructions: runtimeInstructions,
      kind: "instruction" as const,
      approvalRequired: false,
    }, ...workflow.steps],
  } : workflow;
  const displayWorkflow = workflowWithRuntimeInstructions
    ? ensureConnectorWorkflowInputSlots(workflowWithRuntimeInstructions, inputFallback)
    : fallbackWorkflow;
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
              style={{ color: "var(--channel-accent)" }}
            >
              {heroLabel}
            </motion.p>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-text-secondary sm:text-sm">{heroSubtitle}</p>
          </div>
        </div>
      </div>

      {(mode === "setup" || mode === "saved" || mode === "verifying" || mode === "ready" || mode === "failed" || error || !connected) ? (
        <div className="relative z-10 space-y-3 border-t border-border bg-surface-low/70 px-4 py-4 text-xs leading-5 text-text-secondary backdrop-blur-md sm:px-5">
          {error ? <p role="alert" className="rounded-2xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-destructive">{error}</p> : null}
          {!connected ? (
            <div className="flex items-start gap-2 rounded-2xl border border-warning/25 bg-warning/10 px-3 py-2 text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Reconnect the workspace before changing channel settings.
            </div>
          ) : null}
          {mode === "setup" ? (
            <>
              <ConnectorWorkflowGuide
                workflow={displayWorkflow}
                loading={workflowLoading}
                unavailable={workflowUnavailable && !runtimeInstructions && !fallbackWorkflow}
                inputControls={inputControls}
                showRuntimeFingerprint={Boolean(workflow)}
                onRunShellProposal={onRunShellProposal}
                onRetry={beginSetup}
              />
              {definition.fields.length === 0 && !displayWorkflow ? (
                <div className="rounded-2xl border border-border bg-background/65 px-3 py-3">
                  This channel does not require a credential in the dashboard. Follow the runtime guidance above, then explicitly enable the channel.
                </div>
              ) : null}
            </>
          ) : null}
          {mode === "saved" ? (
            <div className="flex items-start gap-2 rounded-2xl border border-[var(--channel-accent-border)] bg-[var(--channel-accent-soft)] px-3 py-3 text-[var(--channel-accent)]">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Settings are stored. Complete any remaining steps from the runtime guidance, then test the connection.</p>
            </div>
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
        {mode === "setup" ? (
          <>
            <button type="button" className={buttonClass()} disabled={saving} onClick={() => setMode(configured ? "manage" : "overview")}>Back</button>
            {channelId === "whatsapp" && onOpenFullSetup ? (
              <button type="button" className={buttonClass()} onClick={onOpenFullSetup}>Open pairing setup</button>
            ) : null}
            <button type="button" className={buttonClass("primary")} disabled={!canConfigure || saving || Boolean(validationError)} onClick={() => void save()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {channelId === "whatsapp" ? "Enable channel" : "Save settings"}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </>
        ) : mode === "saved" || mode === "failed" ? (
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
            <button type="button" className={buttonClass()} disabled={!canConfigure || saving} onClick={beginSetup}>Reconfigure</button>
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
        {onOpenIntegrationDetails ? <button type="button" className={buttonClass()} onClick={onOpenIntegrationDetails}>Open in integrations</button> : null}
        {onDismiss ? <button type="button" className={buttonClass()} onClick={onDismiss}><X className="h-3.5 w-3.5" />Dismiss</button> : null}
      </div>
    </section>
  );
}
