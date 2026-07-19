"use client";

import React from "react";
import { AlertTriangle, Loader2, MessageSquare, Plus, RefreshCw, Search } from "lucide-react";
import { attachSlackRelayAgent, getSlackInstallStatus, type SlackInstallStatus } from "@hypercli.com/sdk/agents";
import type { AgentChannel, AgentChannelSummary, AgentChannelsProvider, AgentChannelsSnapshot } from "@hypercli.com/sdk/channels";
import type { AgentConnectorDescriptor, AgentConnectorsProvider } from "@hypercli.com/sdk/connectors";

import type { AgentGatewaySession } from "../agents/AgentGatewayProvider";
import { IntegrationChatCardHost } from "../chat-integrations/IntegrationChatCardHost";
import { OpenClawChannelSettingsPanel } from "../chat-integrations/OpenClawChannelSettingsPanel";
import type { OpenClawConfiguredChannelId } from "../chat-integrations/openclaw-channel-settings";
import type { ClawIntegrationConnectId } from "../chat-integrations/claw-ui-actions";
import { DirectoryDetail } from "../directory/DirectoryDetail";
import type { DirectoryCategory } from "../directory/directory-utils";
import { CHANNEL_SETUP_CANDIDATE_IDS, PLUGIN_REGISTRY, type PluginMeta } from "./plugin-registry";
import { INTEGRATION_BRAND_LOGOS, type IntegrationBrandIcon } from "./integration-brand-icons";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { SLACK_APP_HANDLE, SLACK_RELAY_BASE_URL } from "@/lib/api";
import { AgentLoadingState } from "../agents/page-helpers";
import { getAgentGatewayPanelBootStatus } from "../agents/chat-boot-stage";

type IntegrationIcon = IntegrationBrandIcon;
type StatusTone = "success" | "warning" | "neutral";
type IntegrationFilter = "messaging" | "all";
type SlackSetupMode = "prompt" | "hosted" | "self-hosted";
type SlackRelayState =
  | { mode: "prompt"; phase: "idle" | "checking"; installStatus: SlackInstallStatus | null; error: string | null }
  | { mode: "self-hosted" }
  | { mode: "hosted"; phase: "idle" | "checking" | "configuring"; installStatus: SlackInstallStatus | null; error: string | null; attached: boolean };

type SlackRelayAction =
  | { type: "reset" }
  | { type: "choose-hosted" }
  | { type: "choose-self-hosted" }
  | { type: "check-start" }
  | { type: "check-success"; installStatus: SlackInstallStatus }
  | { type: "check-error"; error: string }
  | { type: "configure-start" }
  | { type: "configure-success"; installStatus: SlackInstallStatus }
  | { type: "configure-error"; error: string };

interface IntegrationsDirectoryPanelProps {
  initialCategory?: DirectoryCategory | null;
  initialPluginId?: string | null;
  slackOAuthResult?: "success" | "failure" | null;
  slackOAuthError?: string | null;
  detailBackLabel?: string;
  onDetailBack?: () => void;
  agentId?: string | null;
  agentName?: string | null;
  agentPublicUrl?: string | null;
  gatewaySession: AgentGatewaySession;
  channelsProvider: AgentChannelsProvider | null;
  reportedChannels?: AgentChannelSummary[];
  reportedChannelSnapshot?: AgentChannelsSnapshot | null;
  reportedChannelsReady?: boolean;
  reportedChannelsError?: string | null;
  onRefreshChannels?: (probe?: boolean) => Promise<AgentChannelsSnapshot | void>;
  config: Record<string, unknown> | null;
  connected: boolean;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, unknown>>;
  onOpenShell: () => void;
}

interface IntegrationTile {
  id: string;
  displayName: string;
  subtitle: string;
  icon: IntegrationIcon;
  iconColor?: string;
  plugin?: PluginMeta;
  channels: AgentChannelSummary[];
  channel?: AgentChannel;
  connector?: AgentConnectorDescriptor;
  supported: boolean;
  runtimeReported: boolean;
  defaultAccountId?: string;
}

interface ConnectorState {
  provider: AgentConnectorsProvider | null;
  github: AgentConnectorDescriptor | null;
}

interface ChannelState {
  provider: AgentChannelsProvider | null;
  channels: AgentChannelSummary[];
  snapshot: AgentChannelsSnapshot | null;
  error: string | null;
}

interface ChannelSelectionState {
  requestedId: string | null;
  selectedId: string | null;
}

interface SlackPreparationState {
  operation: AgentGatewaySession["ensureSlackSupport"];
  status: "preparing" | "ready" | "error";
  error: string | null;
}

function slackRelayReducer(state: SlackRelayState, action: SlackRelayAction): SlackRelayState {
  switch (action.type) {
    case "reset":
      return { mode: "prompt", phase: "idle", installStatus: null, error: null };
    case "choose-hosted":
      return {
        mode: "hosted",
        phase: "idle",
        installStatus: state.mode === "self-hosted" ? null : state.installStatus,
        error: state.mode === "self-hosted" ? null : state.error,
        attached: false,
      };
    case "choose-self-hosted":
      return { mode: "self-hosted" };
    case "check-start":
      if (state.mode === "self-hosted") return state;
      return { ...state, phase: "checking", error: null };
    case "check-success":
      if (state.mode === "self-hosted") return state;
      return { ...state, phase: "idle", installStatus: action.installStatus, error: null };
    case "check-error":
      if (state.mode === "self-hosted") return state;
      return { ...state, phase: "idle", installStatus: null, error: action.error };
    case "configure-start":
      return { mode: "hosted", phase: "configuring", installStatus: state.mode === "hosted" ? state.installStatus : null, error: null, attached: state.mode === "hosted" ? state.attached : false };
    case "configure-success":
      return { mode: "hosted", phase: "idle", installStatus: action.installStatus, error: null, attached: true };
    case "configure-error":
      return { mode: "hosted", phase: "idle", installStatus: state.mode === "hosted" ? state.installStatus : null, error: action.error, attached: state.mode === "hosted" ? state.attached : false };
  }
}

function displayNameFromId(id: string): string {
  return id
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const RUNTIME_CONNECTOR_IDS = new Set<ClawIntegrationConnectId>(["github", "telegram", "discord", "slack", "whatsapp"]);
const CONFIGURED_CHANNEL_IDS = new Set<OpenClawConfiguredChannelId>(["telegram", "discord", "slack", "whatsapp"]);

function isRuntimeConnectorId(id: string): id is ClawIntegrationConnectId {
  return RUNTIME_CONNECTOR_IDS.has(id as ClawIntegrationConnectId);
}

function themedBrandColor(color?: string): string {
  return color?.startsWith("var(--") ? color : "var(--selection-accent)";
}

function tileIsOnline(tile: IntegrationTile): boolean {
  return tile.connector?.usable === true || tile.channels.some((channel) => channel.running === true);
}

function tileIsConfigured(tile: IntegrationTile): boolean {
  return tile.connector?.configured === true || tile.channels.some((channel) => channel.configured);
}

function configuredChannelSummaries(
  channelId: OpenClawConfiguredChannelId,
  configuredChannel: Record<string, unknown>,
): AgentChannelSummary[] {
  const accounts = asRecord(configuredChannel.accounts);
  const accountIds = accounts ? Object.keys(accounts) : [];
  if (accountIds.length > 0) {
    const defaultAccountId = typeof configuredChannel.defaultAccount === "string" ? configuredChannel.defaultAccount : null;
    accountIds.sort((a, b) => (a === defaultAccountId ? -1 : b === defaultAccountId ? 1 : 0));
    return accountIds.map((accountId) => ({
      channelId,
      accountId,
      configured: true,
      healthState: "unknown",
    }));
  }
  return [{ channelId, accountId: "default", configured: true, healthState: "unknown" }];
}

function buildTiles(
  channels: AgentChannelSummary[],
  github: AgentConnectorDescriptor | null,
  snapshot: AgentChannelsSnapshot | null,
  config: Record<string, unknown> | null,
): IntegrationTile[] {
  const grouped = new Map<string, AgentChannelSummary[]>();
  channels.forEach((channel) => {
    const entries = grouped.get(channel.channelId) ?? [];
    entries.push(channel);
    grouped.set(channel.channelId, entries);
  });

  const runtimeChannels = new Map(snapshot?.channels.map((channel) => [channel.channelId, channel]) ?? []);
  const runtimeOrder = new Map(snapshot?.channels.map((channel, index) => [channel.channelId, index]) ?? []);
  const tiles: IntegrationTile[] = Array.from(grouped.entries())
    .map(([id, entries]) => {
      const channel = runtimeChannels.get(id);
      const plugin = PLUGIN_REGISTRY.find((candidate) => candidate.id === id && candidate.category === "chat");
      const brand = INTEGRATION_BRAND_LOGOS[id];
      const accountNames = entries
        .map((entry) => entry.accountDisplayName)
        .filter((name): name is string => Boolean(name));
      const subtitle = accountNames.length === 1
        ? accountNames[0]
        : entries.length > 1
          ? `${entries.length} accounts`
          : "Integration";
      return {
        id,
        displayName: channel?.label ?? plugin?.displayName ?? displayNameFromId(id),
        subtitle: channel?.detailLabel ?? subtitle,
        icon: brand?.icon ?? plugin?.icon ?? MessageSquare,
        iconColor: themedBrandColor(brand?.color),
        plugin,
        channels: entries,
        channel,
        supported: true,
        runtimeReported: true,
      };
    });
  const configuredChannels = asRecord(config?.channels);
  CHANNEL_SETUP_CANDIDATE_IDS.forEach((id) => {
    if (grouped.has(id)) return;
    const plugin = PLUGIN_REGISTRY.find((candidate) => candidate.id === id && candidate.category === "chat");
    const brand = INTEGRATION_BRAND_LOGOS[id];
    const savedConfiguration = asRecord(configuredChannels?.[id]);
    const hasSavedConfiguration = Boolean(savedConfiguration);
    tiles.push({
      id,
      displayName: plugin?.displayName ?? displayNameFromId(id),
      subtitle: hasSavedConfiguration ? "Configured · live status unavailable" : plugin?.description ?? "Messaging integration",
      icon: brand?.icon ?? plugin?.icon ?? MessageSquare,
      iconColor: themedBrandColor(brand?.color),
      plugin,
      channels: savedConfiguration ? configuredChannelSummaries(id, savedConfiguration) : [],
      ...(typeof savedConfiguration?.defaultAccount === "string" ? { defaultAccountId: savedConfiguration.defaultAccount } : {}),
      supported: true,
      runtimeReported: false,
    });
  });
  const githubPlugin = PLUGIN_REGISTRY.find((candidate) => candidate.id === "github");
  const githubBrand = INTEGRATION_BRAND_LOGOS.github;
  if (githubPlugin && !grouped.has("github")) {
    tiles.push({
      id: "github",
      displayName: githubPlugin.displayName,
      subtitle: "Repositories, issues, and pull requests",
      icon: githubBrand?.icon ?? githubPlugin.icon,
      iconColor: themedBrandColor(githubBrand?.color),
      plugin: githubPlugin,
      channels: [],
      supported: true,
      runtimeReported: Boolean(github),
      ...(github ? { connector: github } : {}),
    });
  }
  return tiles.sort((a, b) => {
      const aOrder = runtimeOrder.get(a.id);
      const bOrder = runtimeOrder.get(b.id);
      if (aOrder !== undefined || bOrder !== undefined) return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
      return a.displayName.localeCompare(b.displayName);
    });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isConfiguredChannelId(id: string): id is OpenClawConfiguredChannelId {
  return CONFIGURED_CHANNEL_IDS.has(id as OpenClawConfiguredChannelId);
}

function tileStatus(tile: IntegrationTile): { label: string; tone: StatusTone; setupRequired: boolean } {
  const configured = tileIsConfigured(tile);
  if (configured && tile.channels.some((channel) => channel.healthState === "unhealthy" || Boolean(channel.lastError))) {
    return { label: "Needs attention", tone: "warning", setupRequired: false };
  }
  if (tileIsOnline(tile)) {
    return { label: "Online", tone: "success", setupRequired: false };
  }
  if (configured) {
    return { label: "Configured", tone: "neutral", setupRequired: false };
  }
  return { label: "Setup required", tone: "neutral", setupRequired: true };
}

function statusClass(tone: StatusTone): string {
  if (tone === "success") return "border border-selection-accent/30 bg-selection-accent/10 text-selection-accent";
  if (tone === "warning") return "border border-warning/30 bg-warning/10 text-warning";
  return "border border-border bg-surface-high text-text-secondary";
}

function slackStartHref(): string {
  return "/slack/start";
}

function IntegrationCard({ tile, onOpen }: { tile: IntegrationTile; onOpen: () => void }) {
  const Icon = tile.icon;
  const status = tileStatus(tile);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-h-[76px] w-full items-start gap-3 rounded-[10px] border border-border bg-surface-low p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-high"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-background text-foreground">
        <Icon className="h-5 w-5" style={{ color: tile.iconColor }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold leading-tight text-foreground">{tile.displayName}</h3>
            <p className="mt-1 text-[13px] leading-tight text-text-muted">{tile.subtitle}</p>
          </div>
          {status.setupRequired && tile.plugin ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-high text-foreground transition-colors group-hover:bg-secondary" aria-label="Set up">
              <Plus className="h-5 w-5" />
            </span>
          ) : (
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium leading-none ${statusClass(status.tone)}`}>
              {status.label}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function RuntimeStatusNotice({
  displayName,
  detail,
  refreshing,
  onRefresh,
  slackPreparation,
  onRetrySlack,
}: {
  displayName: string;
  detail: string;
  refreshing: boolean;
  onRefresh: () => void;
  slackPreparation?: SlackPreparationState | null;
  onRetrySlack?: () => void;
}) {
  const preparingSlack = slackPreparation === null || slackPreparation?.status === "preparing";

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-warning/25 bg-surface-low">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-warning/25 bg-warning/10 text-warning">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground">{displayName} status is not currently reported</h2>
            <p className="mt-1 text-xs leading-5 text-text-muted">{detail}</p>
            {preparingSlack ? (
              <p role="status" className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparing Slack support. The gateway will reconnect automatically.
              </p>
            ) : slackPreparation?.status === "ready" ? (
              <p className="mt-2 text-xs text-text-secondary">Slack support is installed. Waiting for live status.</p>
            ) : null}
            {slackPreparation?.error ? <p role="alert" className="mt-2 text-xs text-destructive">{slackPreparation.error}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={onRefresh} disabled={refreshing} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground disabled:opacity-45">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh status
          </button>
          {slackPreparation?.status === "error" && onRetrySlack ? (
            <button type="button" onClick={onRetrySlack} className="inline-flex h-9 items-center rounded-lg border border-selection-accent/30 bg-selection-accent/10 px-3 text-xs font-semibold text-selection-accent transition-colors hover:bg-selection-accent/15">
              Retry Slack preparation
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function SlackPreparationBanner({
  state,
  onRetry,
}: {
  state: SlackPreparationState | null;
  onRetry: () => void;
}) {
  if (!state || state.status === "ready") return null;
  return (
    <section className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-low p-4">
      <div className="flex min-w-0 items-center gap-2 text-xs text-text-secondary">
        {state?.status === "error" ? <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
        <span role={state?.status === "error" ? "alert" : "status"}>
          {state?.error ?? "Preparing Slack support. The gateway will reconnect automatically."}
        </span>
      </div>
      {state?.status === "error" ? (
        <button type="button" onClick={onRetry} className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface-high">
          Retry
        </button>
      ) : null}
    </section>
  );
}

export function IntegrationsDirectoryPanel({
  initialCategory,
  initialPluginId,
  slackOAuthResult = null,
  slackOAuthError = null,
  detailBackLabel = "Back to integrations",
  onDetailBack,
  agentId,
  agentName,
  agentPublicUrl,
  gatewaySession,
  channelsProvider,
  reportedChannels = [],
  reportedChannelSnapshot = null,
  reportedChannelsReady = false,
  reportedChannelsError = null,
  onRefreshChannels,
  config,
  connected,
  onSaveConfig,
  onChannelProbe,
  onOpenShell,
}: IntegrationsDirectoryPanelProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const requestedChannelId = initialPluginId ?? null;
  const [selection, setSelection] = React.useState<ChannelSelectionState>({
    requestedId: requestedChannelId,
    selectedId: requestedChannelId,
  });
  const [channelState, setChannelState] = React.useState<ChannelState>({ provider: null, channels: [], snapshot: null, error: null });
  const [connectorState, setConnectorState] = React.useState<ConnectorState>({ provider: null, github: null });
  const [refreshing, setRefreshing] = React.useState(false);
  const [slackPreparationState, setSlackPreparationState] = React.useState<SlackPreparationState | null>(null);
  const [slackRelayState, dispatchSlackRelay] = React.useReducer(slackRelayReducer, { mode: "prompt", phase: "idle", installStatus: null, error: null });
  const slackRelayOperationRef = React.useRef(0);
  const appliedSlackOAuthResultRef = React.useRef<string | null>(null);
  const { getToken, isAuthenticated, isLoading: authLoading } = useAgentAuth();
  const scopeLabel = agentName?.trim() || "this agent";
  const selectedChannelId = selection.requestedId === requestedChannelId
    ? selection.selectedId
    : requestedChannelId;
  const selectChannel = React.useCallback((channelId: string | null) => {
    setSelection({ requestedId: requestedChannelId, selectedId: channelId });
    slackRelayOperationRef.current += 1;
    dispatchSlackRelay({ type: "reset" });
  }, [requestedChannelId]);

  React.useEffect(() => {
    if (!connected || !channelsProvider) return;
    if (reportedChannelsReady) return;
    let cancelled = false;
    void Promise.all([
      channelsProvider.list(),
      channelsProvider.read?.().catch(() => null) ?? Promise.resolve(null),
    ])
      .then(([channels, snapshot]) => {
        if (!cancelled) setChannelState({ provider: channelsProvider, channels, snapshot, error: null });
      })
      .catch((cause) => {
        if (!cancelled) {
          setChannelState({
            provider: channelsProvider,
            channels: [],
            snapshot: null,
            error: cause instanceof Error ? cause.message : "Could not read available integrations.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [channelsProvider, connected, reportedChannelSnapshot, reportedChannels, reportedChannelsReady]);

  React.useEffect(() => {
    const provider = gatewaySession.connectorsProvider;
    if (!connected || !provider) return;
    let cancelled = false;
    void provider.list({ connectorId: "github" })
      .then((connectors) => {
        if (cancelled) return;
        setConnectorState({
          provider,
          github: connectors.find((connector) => connector.connectorId === "github") ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setConnectorState({ provider, github: null });
      });
    return () => {
      cancelled = true;
    };
  }, [connected, gatewaySession.connectorsProvider]);

  const refreshIntegrations = React.useCallback(async () => {
    const connectorsProvider = gatewaySession.connectorsProvider;
    if (!channelsProvider && !connectorsProvider) return;
    setRefreshing(true);
    try {
      const [refreshedSnapshot, channels, githubConnectors] = await Promise.all([
        onRefreshChannels?.(true) ?? Promise.resolve(undefined),
        onRefreshChannels ? Promise.resolve(null) : channelsProvider?.list({ probe: true }) ?? Promise.resolve([]),
        connectorsProvider?.list({ connectorId: "github", probe: true }) ?? Promise.resolve([]),
      ]);
      if (channelsProvider && channels) setChannelState({ provider: channelsProvider, channels, snapshot: null, error: null });
      if (channelsProvider && refreshedSnapshot) {
        setChannelState((current) => ({ ...current, provider: channelsProvider, snapshot: refreshedSnapshot, error: null }));
      }
      if (connectorsProvider) {
        setConnectorState({
          provider: connectorsProvider,
          github: githubConnectors.find((connector) => connector.connectorId === "github") ?? null,
        });
      }
    } catch (cause) {
      setChannelState({
        provider: channelsProvider,
        channels: [],
        snapshot: null,
        error: cause instanceof Error ? cause.message : "Could not refresh available integrations.",
      });
    } finally {
      setRefreshing(false);
    }
  }, [channelsProvider, gatewaySession.connectorsProvider, onRefreshChannels]);

  const channels = React.useMemo(() => {
    if (reportedChannelsReady) return reportedChannels;
    const providerChannels = channelState.provider === channelsProvider ? channelState.channels : [];
    return providerChannels.length > 0 ? providerChannels : reportedChannels;
  }, [channelState.channels, channelState.provider, channelsProvider, reportedChannels, reportedChannelsReady]);
  const channelSnapshot = reportedChannelsReady
    ? reportedChannelSnapshot
    : channelState.provider === channelsProvider ? channelState.snapshot : reportedChannelSnapshot;
  const loadError = channels.length === 0 && channelState.provider === channelsProvider ? channelState.error : null;
  const loadingChannels = Boolean(
    connected &&
    channelsProvider &&
    channels.length === 0 &&
    !reportedChannelsReady &&
    channelState.provider !== channelsProvider,
  );
  const githubConnector = connectorState.provider === gatewaySession.connectorsProvider ? connectorState.github : null;
  const tiles = React.useMemo(() => buildTiles(channels, githubConnector, channelSnapshot, config), [channelSnapshot, channels, config, githubConnector]);
  const [integrationFilter, setIntegrationFilter] = React.useState<IntegrationFilter>(initialCategory === "channels" ? "messaging" : "all");
  const selectedTile = React.useMemo(() => {
    if (!selectedChannelId) return null;
    const existing = tiles.find((tile) => tile.id === selectedChannelId);
    if (existing) return existing;
    if (!isRuntimeConnectorId(selectedChannelId)) return null;
    const plugin = PLUGIN_REGISTRY.find((candidate) => candidate.id === selectedChannelId);
    const brand = INTEGRATION_BRAND_LOGOS[selectedChannelId];
    return {
      id: selectedChannelId,
      displayName: plugin?.displayName ?? displayNameFromId(selectedChannelId),
      subtitle: "Not available for this agent",
      icon: brand?.icon ?? plugin?.icon ?? MessageSquare,
      iconColor: themedBrandColor(brand?.color),
      plugin,
      channels: [],
      supported: false,
      runtimeReported: false,
    } satisfies IntegrationTile;
  }, [selectedChannelId, tiles]);
  const selectedIsSlackRelaySetup = selectedChannelId === "slack" && Boolean(SLACK_RELAY_BASE_URL);

  const prepareSlackSupport = React.useCallback(async () => {
    const operation = gatewaySession.ensureSlackSupport;
    await Promise.resolve();
    setSlackPreparationState({ operation, status: "preparing", error: null });
    try {
      await operation();
      await refreshIntegrations();
      setSlackPreparationState({ operation, status: "ready", error: null });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not update Slack support.";
      setSlackPreparationState({
        operation,
        status: "error",
        error: message,
      });
      throw new Error(message);
    }
  }, [gatewaySession.ensureSlackSupport, refreshIntegrations]);

  const refreshSlackInstallStatus = React.useCallback(async (): Promise<SlackInstallStatus | null> => {
    const operationId = slackRelayOperationRef.current + 1;
    slackRelayOperationRef.current = operationId;
    dispatchSlackRelay({ type: "check-start" });
    if (!SLACK_RELAY_BASE_URL) {
      dispatchSlackRelay({ type: "check-error", error: "Slack relay is not configured for this environment." });
      return null;
    }
    if (!isAuthenticated) {
      dispatchSlackRelay({ type: "check-error", error: "Sign in before connecting Slack." });
      return null;
    }
    try {
      const token = await getToken();
      const status = await getSlackInstallStatus({ relayBaseUrl: SLACK_RELAY_BASE_URL, token });
      if (slackRelayOperationRef.current !== operationId) return null;
      dispatchSlackRelay({ type: "check-success", installStatus: status });
      return status;
    } catch (cause) {
      if (slackRelayOperationRef.current !== operationId) return null;
      dispatchSlackRelay({ type: "check-error", error: cause instanceof Error ? cause.message : "Could not check Slack installation." });
      return null;
    }
  }, [getToken, isAuthenticated]);

  React.useEffect(() => {
    if (requestedChannelId !== "slack" || !slackOAuthResult) return;
    const key = `${agentId ?? ""}:${slackOAuthResult}:${slackOAuthError ?? ""}`;
    if (appliedSlackOAuthResultRef.current === key) return;
    appliedSlackOAuthResultRef.current = key;
    dispatchSlackRelay({ type: "choose-hosted" });
    if (slackOAuthResult === "success") {
      void refreshSlackInstallStatus();
      return;
    }
    dispatchSlackRelay({
      type: "check-error",
      error: slackOAuthError || "Slack OAuth did not complete.",
    });
  }, [agentId, refreshSlackInstallStatus, requestedChannelId, slackOAuthError, slackOAuthResult]);

  React.useEffect(() => {
    if (!selectedIsSlackRelaySetup || slackOAuthResult) return;
    if (slackRelayState.mode !== "prompt") return;
    if (slackRelayState.phase === "checking" || slackRelayState.installStatus || slackRelayState.error) return;
    void refreshSlackInstallStatus();
  }, [refreshSlackInstallStatus, selectedIsSlackRelaySetup, slackOAuthResult, slackRelayState]);

  const configureHostedSlack = React.useCallback(async () => {
    if (!agentId) {
      dispatchSlackRelay({ type: "configure-error", error: "Agent identity is unavailable." });
      return;
    }
    const operationId = slackRelayOperationRef.current + 1;
    slackRelayOperationRef.current = operationId;
    dispatchSlackRelay({ type: "configure-start" });
    try {
      const result = await attachSlackRelayAgent({
        relayBaseUrl: SLACK_RELAY_BASE_URL,
        token: await getToken(),
        agentId,
      });
      if (slackRelayOperationRef.current !== operationId) return;
      dispatchSlackRelay({
        type: "configure-success",
        installStatus: {
          connected: result.connected,
          teamId: result.teamId ?? null,
          teamName: result.teamName ?? null,
          botUserId: result.botUserId ?? null,
          updatedAt: new Date().toISOString(),
        },
      });
      if (onRefreshChannels) await onRefreshChannels(true);
      else await refreshIntegrations();
    } catch (cause) {
      if (slackRelayOperationRef.current !== operationId) return;
      dispatchSlackRelay({ type: "configure-error", error: cause instanceof Error ? cause.message : "Could not configure hosted Slack relay." });
    }
  }, [
    agentId,
    getToken,
    onRefreshChannels,
    refreshIntegrations,
  ]);

  const handleDetailBack = React.useCallback(() => {
    selectChannel(null);
    onDetailBack?.();
  }, [onDetailBack, selectChannel]);
  const filteredTiles = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const selectedTiles = integrationFilter === "messaging"
      ? tiles.filter((tile) => CHANNEL_SETUP_CANDIDATE_IDS.includes(tile.id as (typeof CHANNEL_SETUP_CANDIDATE_IDS)[number]))
      : tiles;
    if (!query) return selectedTiles;
    return selectedTiles.filter((tile) => (
      tile.displayName.toLowerCase().includes(query) ||
      tile.subtitle.toLowerCase().includes(query) ||
      tile.id.toLowerCase().includes(query)
    ));
  }, [integrationFilter, searchQuery, tiles]);

  if (!connected && !selectedIsSlackRelaySetup) {
    const bootStatus = getAgentGatewayPanelBootStatus({
      connected,
      loadingTitle: "Loading integrations",
      loadingDetail: `Reading available capabilities for ${scopeLabel}.`,
      connectingDetail: "Opening the integrations workspace.",
      waitingDetail: "Start the agent gateway to manage integrations.",
    });
    return (
      <div className="h-full min-h-0 bg-background">
        <AgentLoadingState bootStatus={bootStatus ?? undefined} />
      </div>
    );
  }

  if (!channelsProvider && !gatewaySession.connectorsProvider && !selectedIsSlackRelaySetup) {
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-background px-5 py-7 text-foreground">
        <div className="mx-auto w-full max-w-6xl rounded-[12px] border border-border bg-surface-low px-5 py-10 text-center">
          <h2 className="text-base font-semibold">No integrations reported</h2>
          <p className="mt-2 text-sm text-text-muted">This workspace does not publish integration capabilities.</p>
        </div>
      </div>
    );
  }

  if (
    selectedTile &&
    isConfiguredChannelId(selectedTile.id) &&
    gatewaySession.backend !== "openclaw"
  ) {
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-background px-5 py-5">
        <div className="mx-auto w-full max-w-6xl">
          <button type="button" onClick={handleDetailBack} className="mb-5 rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground">
            {detailBackLabel}
          </button>
          <section className="max-w-2xl overflow-hidden rounded-2xl border border-warning/25 bg-surface-low">
            <div className="flex items-start gap-3 border-b border-warning/20 bg-warning/10 p-5">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div>
                <h2 className="text-lg font-semibold text-foreground">{selectedTile.displayName} is not available</h2>
                <p className="mt-1 text-sm leading-6 text-text-secondary">
                  {selectedTile.displayName} controls are not available for this agent yet.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (selectedTile && isRuntimeConnectorId(selectedTile.id)) {
    const needsWhatsAppPairing = selectedTile.id === "whatsapp" && !tileIsOnline(selectedTile);
    const selectedSlackPreparation = selectedTile.id === "slack"
      ? slackPreparationState?.operation === gatewaySession.ensureSlackSupport ? slackPreparationState : null
      : null;
    if (
      isConfiguredChannelId(selectedTile.id) &&
      tileIsConfigured(selectedTile) &&
      !needsWhatsAppPairing &&
      !selectedIsSlackRelaySetup &&
      selectedTile.supported &&
      channelsProvider &&
      gatewaySession.backend === "openclaw"
    ) {
      const groupedChannel = selectedTile.channel ?? {
        channelId: selectedTile.id,
        label: selectedTile.displayName,
        defaultAccountId: selectedTile.defaultAccountId,
        rawChannelStatus: {},
        accounts: selectedTile.channels.map((summary) => ({
          accountId: summary.accountId,
          accountDisplayName: summary.accountDisplayName,
          enabled: summary.enabled,
          configured: summary.configured,
          running: summary.running,
          authenticated: summary.authenticated,
          healthState: summary.healthState,
          lastError: summary.lastError,
          lastProbeAt: summary.lastProbeAt,
          rawRuntimeStatus: {},
        })),
      } satisfies AgentChannel;
      const runtimeStatusDetail = loadingChannels
        ? `Checking the live ${selectedTile.displayName} connection. Saved settings remain available while status loads.`
        : reportedChannelsError || loadError
          ? `Live status could not be refreshed. Saved settings remain available. ${reportedChannelsError || loadError}`
          : channelSnapshot?.partial
            ? `The agent returned an incomplete integration snapshot. Saved settings remain available while status is refreshed.`
            : `A saved configuration exists, but the agent is not currently publishing live ${selectedTile.displayName} status. You can safely review settings or refresh status.`;
      return (
        <div className="h-full min-h-0 overflow-y-auto bg-background px-5 py-5">
          <div className="mx-auto w-full max-w-6xl">
            <button type="button" onClick={handleDetailBack} className="mb-5 rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground">
              {detailBackLabel}
            </button>
            {!selectedTile.runtimeReported ? (
              <RuntimeStatusNotice
                displayName={selectedTile.displayName}
                detail={runtimeStatusDetail}
                refreshing={refreshing}
                onRefresh={() => void refreshIntegrations()}
                slackPreparation={selectedTile.id === "slack" ? selectedSlackPreparation : undefined}
                onRetrySlack={() => void prepareSlackSupport().catch(() => undefined)}
              />
            ) : null}
            <OpenClawChannelSettingsPanel
              channelId={selectedTile.id}
              channel={groupedChannel}
              provider={channelsProvider}
              connectorsProvider={gatewaySession.connectorsProvider}
              runtime={gatewaySession.connectorsProvider?.runtime ?? gatewaySession.connectorRuntime}
              connected={connected}
              onRefresh={async () => {
                if (onRefreshChannels) await onRefreshChannels(true);
                else await refreshIntegrations();
              }}
              onOpenPairing={selectedTile.id === "whatsapp" ? onOpenShell : undefined}
              slackPublicBaseUrl={selectedTile.id === "slack" ? agentPublicUrl ?? undefined : undefined}
            />
          </div>
        </div>
      );
    }
    const action = { version: 1, type: "integration.connect", integrationId: selectedTile.id } as const;
    const slackInstallStatus = slackRelayState.mode === "self-hosted" ? null : slackRelayState.installStatus;
    const slackRelaySetup = selectedTile.id === "slack" ? {
      mode: slackRelayState.mode,
      handle: SLACK_APP_HANDLE,
      hostedAvailable: Boolean(SLACK_RELAY_BASE_URL),
      connected: slackInstallStatus?.connected ?? null,
      workspace: slackInstallStatus?.teamName || slackInstallStatus?.teamId || null,
      attached: slackRelayState.mode === "hosted" ? slackRelayState.attached : false,
      checking: (slackRelayState.mode !== "self-hosted" && slackRelayState.phase === "checking") || authLoading,
      configuring: slackRelayState.mode === "hosted" && slackRelayState.phase === "configuring",
      error: slackRelayState.mode === "hosted" ? slackRelayState.error : null,
      connectHref: slackStartHref(),
      onChooseHosted: () => {
        dispatchSlackRelay({ type: "choose-hosted" });
        void refreshSlackInstallStatus();
      },
      onChooseSelfHosted: () => {
        slackRelayOperationRef.current += 1;
        dispatchSlackRelay({ type: "choose-self-hosted" });
        void prepareSlackSupport().catch(() => undefined);
      },
      onBackToChoice: () => {
        slackRelayOperationRef.current += 1;
        dispatchSlackRelay({ type: "reset" });
      },
      onRefreshHosted: () => void refreshSlackInstallStatus(),
      onConfigureHosted: () => void configureHostedSlack(),
    } : undefined;
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-background px-5 py-5">
        <div className="mx-auto w-full max-w-6xl">
          <button type="button" onClick={handleDetailBack} className="mb-5 rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground">
            {detailBackLabel}
          </button>
          {selectedTile.id === "slack" ? (
            <SlackPreparationBanner state={selectedSlackPreparation} onRetry={() => void prepareSlackSupport().catch(() => undefined)} />
          ) : null}
          <IntegrationChatCardHost
            action={action}
            chat={gatewaySession}
            agentName={agentName}
            directSetup
            slackRelaySetup={slackRelaySetup}
            onOpenFullSetup={selectedTile.id === "whatsapp" ? () => onOpenShell() : undefined}
          />
        </div>
      </div>
    );
  }

  if (selectedTile?.plugin) {
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-background px-5 py-5">
        <div className="mx-auto w-full max-w-6xl">
          <button type="button" onClick={handleDetailBack} className="mb-5 rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground">
            {detailBackLabel}
          </button>
          <DirectoryDetail
            pluginId={selectedTile.plugin.id}
            config={config}
            connected={connected}
            onSaveConfig={onSaveConfig}
            onChannelProbe={onChannelProbe}
            onOpenShell={onOpenShell}
            onBack={handleDetailBack}
            onCloseModal={handleDetailBack}
          />
        </div>
      </div>
    );
  }

  if (selectedTile) {
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-background px-5 py-5">
        <div className="mx-auto w-full max-w-6xl">
          <button type="button" onClick={handleDetailBack} className="mb-5 rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground">
            {detailBackLabel}
          </button>
          <div className="max-w-2xl rounded-xl border border-border bg-surface-low p-5">
            <h2 className="text-xl font-semibold">{selectedTile.displayName}</h2>
            <p className="mt-2 text-sm text-text-secondary">This integration is available in this workspace, but guided setup is not available yet.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl">
        <div className="border-b border-border px-5 py-5">
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="shrink-0 text-[22px] font-semibold leading-none">{integrationFilter === "all" ? "All integrations" : "Messaging integrations"}</h2>
              <label className="relative min-w-0 flex-1 lg:max-w-[560px]">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search integrations..." className="h-12 w-full rounded-2xl border border-border bg-input-background pl-12 pr-12 text-base text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-border-strong focus:ring-2 focus:ring-ring" />
                <button type="button" onClick={() => void refreshIntegrations()} disabled={refreshing} aria-label="Refresh integrations" className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground disabled:opacity-50">
                  <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                </button>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2.5" aria-label="Integration type">
              <button type="button" aria-pressed={integrationFilter === "all"} onClick={() => setIntegrationFilter("all")} className={`h-10 rounded-full border px-5 text-sm font-semibold transition-colors ${integrationFilter === "all" ? "border-foreground bg-foreground text-background" : "border-border bg-surface-low text-text-secondary hover:border-border-strong hover:text-foreground"}`}>All</button>
              <button type="button" aria-pressed={integrationFilter === "messaging"} onClick={() => setIntegrationFilter("messaging")} className={`h-10 rounded-full border px-5 text-sm font-semibold transition-colors ${integrationFilter === "messaging" ? "border-foreground bg-foreground text-background" : "border-border bg-surface-low text-text-secondary hover:border-border-strong hover:text-foreground"}`}>Messaging</button>
            </div>
          </div>
        </div>

        <div className="px-5 py-7">
          {channelSnapshot?.partial ? (
            <div role="status" className="mb-4 flex items-start gap-2 rounded-[10px] border border-warning/25 bg-warning/10 px-3.5 py-3 text-xs leading-5 text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Some integration status checks did not complete{channelSnapshot.warnings?.length ? ` (${channelSnapshot.warnings.length})` : ""}. Saved settings remain available; refresh before relying on live health.
            </div>
          ) : null}
          {loadingChannels ? (
            <div className="flex items-center justify-center gap-3 py-14 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading available integrations...
            </div>
          ) : loadError ? (
            <div className="rounded-[12px] border border-destructive/30 bg-destructive/10 px-5 py-10 text-center">
              <p className="text-sm text-destructive">This workspace could not report its integrations.</p>
              <button type="button" onClick={() => void refreshIntegrations()} className="mt-4 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-destructive/10">Try again</button>
            </div>
          ) : filteredTiles.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {filteredTiles.map((tile) => (
                <IntegrationCard key={tile.id} tile={tile} onOpen={() => selectChannel(tile.id)} />
              ))}
            </div>
          ) : (
            <div className="rounded-[12px] border border-border bg-surface-low px-5 py-10 text-center text-sm text-text-muted">
              {tiles.length === 0 ? "This workspace reports no integrations." : "No integrations match this search."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
