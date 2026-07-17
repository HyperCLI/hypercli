"use client";

import React from "react";
import { AlertTriangle, Loader2, MessageSquare, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
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
import { AgentLoadingState } from "../agents/page-helpers";
import { getAgentGatewayPanelBootStatus } from "../agents/chat-boot-stage";

type IntegrationIcon = IntegrationBrandIcon;
type StatusTone = "success" | "warning" | "neutral";

interface IntegrationsDirectoryPanelProps {
  initialCategory?: DirectoryCategory | null;
  initialPluginId?: string | null;
  detailBackLabel?: string;
  onDetailBack?: () => void;
  agentName?: string | null;
  gatewaySession: AgentGatewaySession;
  channelsProvider: AgentChannelsProvider | null;
  reportedChannels?: AgentChannelSummary[];
  reportedChannelSnapshot?: AgentChannelsSnapshot | null;
  reportedChannelsReady?: boolean;
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
  staleConfiguration?: boolean;
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
          : "Channel";
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
      };
    });
  const configuredChannels = asRecord(config?.channels);
  CHANNEL_SETUP_CANDIDATE_IDS.forEach((id) => {
    if (grouped.has(id) || !asRecord(configuredChannels?.[id])) return;
    const plugin = PLUGIN_REGISTRY.find((candidate) => candidate.id === id && candidate.category === "chat");
    const brand = INTEGRATION_BRAND_LOGOS[id];
    tiles.push({
      id,
      displayName: plugin?.displayName ?? displayNameFromId(id),
      subtitle: "Saved configuration is not reported by this runtime",
      icon: brand?.icon ?? plugin?.icon ?? MessageSquare,
      iconColor: themedBrandColor(brand?.color),
      plugin,
      channels: [{ channelId: id, configured: true, healthState: "unknown" }],
      supported: false,
      staleConfiguration: true,
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
  if (tile.channels.some((channel) => channel.healthState === "unhealthy" || Boolean(channel.lastError))) {
    return { label: "Needs attention", tone: "warning", setupRequired: false };
  }
  if (tileIsOnline(tile)) {
    return { label: "Online", tone: "success", setupRequired: false };
  }
  if (tileIsConfigured(tile)) {
    return { label: "Configured", tone: "neutral", setupRequired: false };
  }
  return { label: "Setup required", tone: "neutral", setupRequired: true };
}

function statusClass(tone: StatusTone): string {
  if (tone === "success") return "border border-selection-accent/30 bg-selection-accent/10 text-selection-accent";
  if (tone === "warning") return "border border-warning/30 bg-warning/10 text-warning";
  return "border border-border bg-surface-high text-text-secondary";
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

export function IntegrationsDirectoryPanel({
  initialPluginId,
  detailBackLabel = "Back to integrations",
  onDetailBack,
  agentName,
  gatewaySession,
  channelsProvider,
  reportedChannels = [],
  reportedChannelSnapshot = null,
  reportedChannelsReady = false,
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
  const [confirmingStaleRemoval, setConfirmingStaleRemoval] = React.useState(false);
  const [removingStaleConfiguration, setRemovingStaleConfiguration] = React.useState(false);
  const scopeLabel = agentName?.trim() || "this agent";
  const selectedChannelId = selection.requestedId === requestedChannelId
    ? selection.selectedId
    : requestedChannelId;
  const selectChannel = React.useCallback((channelId: string | null) => {
    setSelection({ requestedId: requestedChannelId, selectedId: channelId });
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
            error: cause instanceof Error ? cause.message : "Could not read available channels.",
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

  const refreshIntegrations = async () => {
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
        error: cause instanceof Error ? cause.message : "Could not refresh available channels.",
      });
    } finally {
      setRefreshing(false);
    }
  };

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
      subtitle: "Not available in this runtime",
      icon: brand?.icon ?? plugin?.icon ?? MessageSquare,
      iconColor: themedBrandColor(brand?.color),
      plugin,
      channels: [],
      supported: false,
    } satisfies IntegrationTile;
  }, [selectedChannelId, tiles]);
  const handleDetailBack = React.useCallback(() => {
    setConfirmingStaleRemoval(false);
    selectChannel(null);
    onDetailBack?.();
  }, [onDetailBack, selectChannel]);
  const filteredTiles = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return tiles;
    return tiles.filter((tile) => (
      tile.displayName.toLowerCase().includes(query) ||
      tile.subtitle.toLowerCase().includes(query) ||
      tile.id.toLowerCase().includes(query)
    ));
  }, [searchQuery, tiles]);

  if (!connected) {
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

  if (!channelsProvider && !gatewaySession.connectorsProvider) {
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-background px-5 py-7 text-foreground">
        <div className="mx-auto w-full max-w-6xl rounded-[12px] border border-border bg-surface-low px-5 py-10 text-center">
          <h2 className="text-base font-semibold">No integrations reported</h2>
          <p className="mt-2 text-sm text-text-muted">This workspace does not publish communication channel capabilities.</p>
        </div>
      </div>
    );
  }

  if (
    selectedTile &&
    isConfiguredChannelId(selectedTile.id) &&
    (!selectedTile.supported || gatewaySession.backend !== "openclaw")
  ) {
    const runtime = gatewaySession.connectorsProvider?.runtime;
    const runtimeName = runtime?.provider === "openclaw" ? "OpenClaw" : runtime?.provider || gatewaySession.backend;
    const adapterUnavailable = selectedTile.supported && gatewaySession.backend !== "openclaw";
    const removeStaleConfiguration = async () => {
      if (!channelsProvider?.removeConfig) return;
      setRemovingStaleConfiguration(true);
      try {
        await channelsProvider.removeConfig(selectedTile.id);
        await onRefreshChannels?.(true);
        selectChannel(null);
      } finally {
        setRemovingStaleConfiguration(false);
      }
    };
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
                  {selectedTile.staleConfiguration
                    ? `A saved configuration exists, but the ${runtimeName} runtime does not currently report this channel.`
                    : adapterUnavailable
                      ? `${selectedTile.displayName} controls are not available for the ${runtimeName} runtime yet.`
                    : `This ${runtimeName} runtime does not report support for ${selectedTile.displayName}.`}
                </p>
                {runtime ? <p className="mt-2 font-mono text-[11px] text-text-muted">{runtimeName} runtime{runtime.version ? ` · v${runtime.version.replace(/^v/i, "")}` : ""}</p> : null}
              </div>
            </div>
            {selectedTile.staleConfiguration ? (
              <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <p className="max-w-md text-xs leading-5 text-text-muted">Settings cannot be edited safely until runtime support returns. You can remove the saved configuration now.</p>
                {!confirmingStaleRemoval ? (
                  <button type="button" onClick={() => setConfirmingStaleRemoval(true)} disabled={!channelsProvider?.removeConfig} className="inline-flex h-9 items-center gap-2 rounded-lg border border-destructive/35 bg-destructive/10 px-3 text-xs font-semibold text-destructive disabled:opacity-45">
                    <Trash2 className="h-3.5 w-3.5" /> Remove configuration
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => void removeStaleConfiguration()} disabled={removingStaleConfiguration} className="inline-flex h-9 items-center gap-2 rounded-lg border border-destructive/35 bg-destructive/10 px-3 text-xs font-semibold text-destructive disabled:opacity-45">
                      {removingStaleConfiguration ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Confirm remove
                    </button>
                    <button type="button" onClick={() => setConfirmingStaleRemoval(false)} disabled={removingStaleConfiguration} className="h-9 rounded-lg border border-border px-3 text-xs text-text-secondary transition-colors hover:bg-surface-high hover:text-foreground disabled:opacity-45">Cancel</button>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    );
  }

  if (selectedTile && isRuntimeConnectorId(selectedTile.id)) {
    if (
      isConfiguredChannelId(selectedTile.id) &&
      tileIsConfigured(selectedTile) &&
      selectedTile.supported &&
      channelsProvider &&
      gatewaySession.backend === "openclaw"
    ) {
      const groupedChannel = selectedTile.channel ?? {
        channelId: selectedTile.id,
        label: selectedTile.displayName,
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
      return (
        <div className="h-full min-h-0 overflow-y-auto bg-background px-5 py-5">
          <div className="mx-auto w-full max-w-6xl">
            <button type="button" onClick={handleDetailBack} className="mb-5 rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground">
              {detailBackLabel}
            </button>
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
            />
          </div>
        </div>
      );
    }
    const action = { version: 1, type: "integration.connect", integrationId: selectedTile.id } as const;
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-background px-5 py-5">
        <div className="mx-auto w-full max-w-6xl">
          <button type="button" onClick={handleDetailBack} className="mb-5 rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-low hover:text-foreground">
            {detailBackLabel}
          </button>
          <IntegrationChatCardHost
            action={action}
            chat={gatewaySession}
            agentName={agentName}
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
            <p className="mt-2 text-sm text-text-secondary">This channel is available in this workspace, but guided setup is not available yet.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl">
        <div className="border-b border-border px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-[19px] font-semibold leading-none">Channels</h2>
              <p className="mt-2 text-xs text-text-muted">Communication channels reported by this workspace.</p>
            </div>
            <div className="flex w-full gap-2 lg:w-auto">
              <label className="relative min-w-0 flex-1 lg:w-[360px]">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search channels..." className="h-10 w-full rounded-[11px] border border-border bg-input-background pl-10 pr-3 text-[14px] text-foreground outline-none placeholder:text-text-muted focus:border-border-strong focus:ring-2 focus:ring-ring" />
              </label>
              <button type="button" onClick={() => void refreshIntegrations()} disabled={refreshing} aria-label="Refresh channels" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-border bg-surface-low text-text-secondary transition-colors hover:border-border-strong hover:bg-surface-high hover:text-foreground disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-7">
          {channelSnapshot?.partial ? (
            <div role="status" className="mb-4 flex items-start gap-2 rounded-[10px] border border-warning/25 bg-warning/10 px-3.5 py-3 text-xs leading-5 text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Some channel status checks did not complete{channelSnapshot.warnings?.length ? ` (${channelSnapshot.warnings.length})` : ""}. Saved settings remain available; refresh before relying on live health.
            </div>
          ) : null}
          {loadingChannels ? (
            <div className="flex items-center justify-center gap-3 py-14 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading available channels...
            </div>
          ) : loadError ? (
            <div className="rounded-[12px] border border-destructive/30 bg-destructive/10 px-5 py-10 text-center">
              <p className="text-sm text-destructive">This workspace could not report its communication channels.</p>
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
              {tiles.length === 0 ? "This workspace reports no communication channels." : "No channels match this search."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
