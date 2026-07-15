"use client";

import React from "react";
import { ArrowRight, CheckCircle2, Code2, ExternalLink, Loader2, Mail, Plus, RefreshCw, Search } from "lucide-react";

import { DirectoryDetail } from "../directory/DirectoryDetail";
import { isPluginAvailableInSchema, isPluginConnected, schemaPathExists, type DirectoryCategory } from "../directory/directory-utils";
import { PLUGIN_REGISTRY, type PluginMeta } from "./plugin-registry";
import { INTEGRATION_BRAND_LOGOS, type IntegrationBrandIcon } from "./integration-brand-icons";
import { AgentLoadingState } from "../agents/page-helpers";
import { getAgentGatewayPanelBootStatus } from "../agents/chat-boot-stage";
import type {
  GatewayIntegrationAuthStartParams,
  GatewayIntegrationAuthStartResult,
  GatewayIntegrationAuthStatusParams,
  GatewayIntegrationAuthStatusResult,
  GatewayIntegrationDisconnectParams,
  GatewayIntegrationDisconnectResult,
  GatewayIntegrationStatusEntry,
  GatewayIntegrationStatusParams,
  GatewayIntegrationStatusResult,
  OpenClawConfigSchemaResponse,
} from "@hypercli.com/sdk/openclaw/gateway";

type IntegrationFilter = "all" | "web" | "channels" | "tools" | "media";
type IntegrationIcon = IntegrationBrandIcon;
type CatalogIntegrationStatus = "planned" | "oauth-required";
type IntegrationStatusTone = "accent" | "warning" | "neutral";
type ServiceConnectorId = "github";

interface IntegrationsDirectoryPanelProps {
  initialCategory?: DirectoryCategory | null;
  initialPluginId?: string | null;
  detailBackLabel?: string;
  onDetailBack?: () => void;
  agentName?: string | null;
  config: Record<string, unknown> | null;
  configSchema: OpenClawConfigSchemaResponse | null;
  connected: boolean;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  onChannelProbe: () => Promise<Record<string, unknown>>;
  onOpenShell: () => void;
  availableSkillIds: ReadonlySet<string>;
  onOpenSkill: (skillId: string) => void;
  onIntegrationAuthStart?: (params: GatewayIntegrationAuthStartParams) => Promise<GatewayIntegrationAuthStartResult>;
  onIntegrationAuthStatus?: (params: GatewayIntegrationAuthStatusParams) => Promise<GatewayIntegrationAuthStatusResult>;
  onIntegrationStatus?: (params?: GatewayIntegrationStatusParams) => Promise<GatewayIntegrationStatusResult>;
  onIntegrationDisconnect?: (params: GatewayIntegrationDisconnectParams) => Promise<GatewayIntegrationDisconnectResult>;
}

interface CatalogServiceIntegration {
  id: string;
  displayName: string;
  subtitle: string;
  description: string;
  category: IntegrationFilter;
  icon: IntegrationIcon;
  status: CatalogIntegrationStatus;
  skillIds?: string[];
  connectorId?: ServiceConnectorId;
  connectorScopes?: string[];
}

interface IntegrationTile {
  id: string;
  displayName: string;
  subtitle: string;
  description: string;
  category: IntegrationFilter;
  icon: IntegrationIcon;
  iconColor?: string;
  plugin?: PluginMeta;
  skillId?: string;
  service?: CatalogServiceIntegration;
  connectorAvailable?: boolean;
  available: boolean;
  active: boolean;
  activeLabel?: string;
  statusLabel?: string;
  statusTone?: IntegrationStatusTone;
}

const WEB_PLUGIN_IDS = new Set(["brave", "duckduckgo", "exa", "tavily", "firecrawl"]);
const MEDIA_PLUGIN_IDS = new Set(["elevenlabs", "deepgram", "fal", "voice-call", "talk-voice", "phone-control"]);

const FILTERS: Array<{ id: IntegrationFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "web", label: "Web" },
  { id: "channels", label: "Channels" },
  { id: "tools", label: "Tools" },
  { id: "media", label: "Media" },
];

const CATALOG_SERVICE_INTEGRATIONS: CatalogServiceIntegration[] = [
  { id: "notion", displayName: "Notion", subtitle: "Docs & wiki", description: "Open and configure the Notion workspace skill when it is installed.", category: "tools", icon: INTEGRATION_BRAND_LOGOS.notion.icon, status: "planned", skillIds: ["notion"] },
  { id: "google-drive", displayName: "Google Drive", subtitle: "File storage", description: "Requires first-party Google Workspace OAuth before files can be connected safely.", category: "tools", icon: INTEGRATION_BRAND_LOGOS["google-drive"].icon, status: "oauth-required" },
  { id: "google-calendar", displayName: "Google Calendar", subtitle: "Scheduling", description: "Requires first-party Google Workspace OAuth before calendars can be connected safely.", category: "tools", icon: INTEGRATION_BRAND_LOGOS["google-calendar"].icon, status: "oauth-required" },
  { id: "asana", displayName: "Asana", subtitle: "Task management", description: "Planned service connector; no in-app setup flow is available yet.", category: "tools", icon: INTEGRATION_BRAND_LOGOS.asana.icon, status: "planned" },
  { id: "github", displayName: "GitHub", subtitle: "Repos & issues", description: "Connect repositories and issues with GitHub's device authorization flow.", category: "tools", icon: INTEGRATION_BRAND_LOGOS.github.icon, status: "planned", skillIds: ["github", "gh-issues"], connectorId: "github", connectorScopes: ["repo", "read:org", "gist"] },
  { id: "hubspot", displayName: "HubSpot", subtitle: "CRM", description: "Planned CRM connector; secure account setup is not available in this UI yet.", category: "tools", icon: INTEGRATION_BRAND_LOGOS.hubspot.icon, status: "planned" },
  { id: "jira", displayName: "Jira", subtitle: "Issue tracking", description: "Planned connector; needs packaged Atlassian setup before it can be enabled here.", category: "tools", icon: INTEGRATION_BRAND_LOGOS.jira.icon, status: "planned" },
  { id: "vscode", displayName: "VS Code", subtitle: "IDE", description: "Planned local workflow connector; setup is not available in this UI yet.", category: "tools", icon: Code2, status: "planned" },
  { id: "gmail", displayName: "Gmail", subtitle: "Email", description: "Requires first-party Google Workspace OAuth before mail can be connected safely.", category: "channels", icon: INTEGRATION_BRAND_LOGOS.gmail.icon, status: "oauth-required" },
  { id: "outlook", displayName: "Outlook", subtitle: "Email & calendar", description: "Requires first-party Microsoft OAuth before mail and calendar can be connected safely.", category: "channels", icon: Mail, status: "oauth-required" },
  { id: "trello", displayName: "Trello", subtitle: "Boards", description: "Planned service connector; no in-app setup flow is available yet.", category: "tools", icon: INTEGRATION_BRAND_LOGOS.trello.icon, status: "planned" },
  { id: "gitlab", displayName: "GitLab", subtitle: "Repos & CI", description: "Planned service connector; no in-app setup flow is available yet.", category: "tools", icon: INTEGRATION_BRAND_LOGOS.gitlab.icon, status: "planned" },
  { id: "linear", displayName: "Linear", subtitle: "Project tracking", description: "Planned service connector; no safe in-app connection is available yet.", category: "tools", icon: INTEGRATION_BRAND_LOGOS.linear.icon, status: "planned" },
  { id: "vercel", displayName: "Vercel", subtitle: "Deployment", description: "Planned deployment connector; no in-app setup flow is available yet.", category: "web", icon: INTEGRATION_BRAND_LOGOS.vercel.icon, status: "planned" },
];

function categoryForPlugin(plugin: PluginMeta): IntegrationFilter {
  if (plugin.category === "chat") return "channels";
  if (plugin.category === "built-in" || MEDIA_PLUGIN_IDS.has(plugin.id)) return "media";
  if (WEB_PLUGIN_IDS.has(plugin.id)) return "web";
  return "tools";
}

function subtitleForPlugin(plugin: PluginMeta, category: IntegrationFilter): string {
  if (plugin.category === "ai-providers") return "AI provider";
  if (plugin.category === "built-in") return "Built in";
  if (category === "channels") return "Channel";
  if (category === "web") return "Web";
  if (category === "media") return "Media";
  return "Tool";
}

function filterFromInitialCategory(category?: DirectoryCategory | null): IntegrationFilter {
  if (category === "web" || category === "channels" || category === "tools" || category === "media") {
    return category;
  }
  return "all";
}

function catalogSkillForItem(item: CatalogServiceIntegration, availableSkillIds: ReadonlySet<string>): string | undefined {
  if (!item.skillIds) return undefined;
  return item.skillIds.find((skillId) => availableSkillIds.has(skillId));
}

function catalogConnectorAvailable(item: CatalogServiceIntegration, configSchema: OpenClawConfigSchemaResponse): boolean {
  if (!item.connectorId) return false;
  const connectorId = item.connectorId;
  const hintKeys = [
    `integrations.${connectorId}`,
    `integrations.${connectorId}.auth`,
    `integrations.${connectorId}.connect`,
    `services.${connectorId}`,
    `services.${connectorId}.auth`,
    `services.${connectorId}.connect`,
  ];
  return (
    schemaPathExists(configSchema.schema, `integrations.${connectorId}`) ||
    schemaPathExists(configSchema.schema, `services.${connectorId}`) ||
    hintKeys.some((key) => Boolean(configSchema.uiHints?.[key]))
  );
}

function catalogStatusLabel(item: CatalogServiceIntegration, skillId?: string): string {
  if (skillId) return "Available as skill";
  if (item.status === "oauth-required") return "Needs OAuth";
  return "Planned";
}

function catalogStatusTone(item: CatalogServiceIntegration, skillId?: string): IntegrationStatusTone {
  if (skillId) return "accent";
  if (item.status === "oauth-required") return "warning";
  return "neutral";
}

function statusBadgeClass(tone?: IntegrationStatusTone): string {
  if (tone === "accent") return "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]";
  if (tone === "warning") return "border-[#765415] bg-[#2f2209] text-[#f5c45e]";
  return "border-[#3a3a3d] bg-[#222222] text-[#858585]";
}

function buildTiles(
  configSchema: OpenClawConfigSchemaResponse,
  config: Record<string, unknown> | null,
  availableSkillIds: ReadonlySet<string>,
  connectorActionsAvailable: boolean,
  integrationStatuses: Record<string, GatewayIntegrationStatusEntry> = {},
): IntegrationTile[] {
  const pluginTiles = PLUGIN_REGISTRY.map((plugin) => {
    const category = categoryForPlugin(plugin);
    const available = isPluginAvailableInSchema(plugin, configSchema);
    const brand = INTEGRATION_BRAND_LOGOS[plugin.id];
    return {
      id: plugin.id,
      displayName: plugin.displayName,
      subtitle: subtitleForPlugin(plugin, category),
      description: plugin.description,
      category,
      icon: brand?.icon ?? plugin.icon,
      iconColor: brand?.color,
      plugin,
      available,
      active: available && (plugin.category === "built-in" || isPluginConnected(plugin.id, config)),
    };
  });

  const pluginIds = new Set(pluginTiles.map((tile) => tile.id));
  const catalogTiles = CATALOG_SERVICE_INTEGRATIONS
    .filter((item) => !pluginIds.has(item.id))
    .map((item) => {
      const statusEntry = item.connectorId ? integrationStatuses[item.connectorId] ?? null : null;
      const connected = connectorActionsAvailable && isIntegrationUsable(statusEntry);
      const connectorAvailable = connected || (connectorActionsAvailable && catalogConnectorAvailable(item, configSchema));
      const skillId = catalogSkillForItem(item, availableSkillIds);
      return {
        ...item,
        icon: INTEGRATION_BRAND_LOGOS[item.id]?.icon ?? item.icon,
        iconColor: INTEGRATION_BRAND_LOGOS[item.id]?.color,
        service: item,
        skillId,
        connectorAvailable,
        available: connectorAvailable || connected || Boolean(skillId),
        active: connected,
        activeLabel: connected ? "Connected" : undefined,
        statusLabel: connectorAvailable ? undefined : catalogStatusLabel(item, skillId),
        statusTone: connectorAvailable ? undefined : catalogStatusTone(item, skillId),
      };
    });

  return [...pluginTiles, ...catalogTiles].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

function IntegrationCard({ tile, onOpen }: { tile: IntegrationTile; onOpen: () => void }) {
  const Icon = tile.icon;
  const clickable = tile.available || Boolean(tile.skillId);

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={clickable ? onOpen : undefined}
      className={`group flex min-h-[92px] w-full items-start gap-3 rounded-[10px] border bg-[#181818] p-4 text-left transition-colors ${
        clickable
          ? "border-[#333333] hover:border-[#4a4a4d] hover:bg-[#1e1e1e]"
          : "cursor-default border-[#292929] opacity-70"
      }`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[#343434] bg-[#151515] text-[#f3f3f3]">
        <Icon className="h-5 w-5" style={{ color: tile.iconColor }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold leading-tight text-[#f5f5f5]">{tile.displayName}</h3>
            <p className="mt-1 text-[13px] leading-tight text-[#858585]">{tile.subtitle}</p>
          </div>
          {tile.active ? (
            <span className="shrink-0 rounded-full bg-[#073f21] px-2.5 py-1 text-[12px] font-medium leading-none text-[#29d76f]">
              {tile.activeLabel ?? "Active"}
            </span>
          ) : tile.statusLabel ? (
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-medium leading-none ${statusBadgeClass(tile.statusTone)}`}>
              {tile.statusLabel}
            </span>
          ) : tile.available ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[#2a2b2f] text-[#f5f5f5] transition-colors group-hover:bg-[#32343a]">
              <Plus className="h-5 w-5" />
            </span>
          ) : (
            <span className="shrink-0 rounded-full border border-[#3a3a3d] bg-[#222222] px-2.5 py-1 text-[10px] font-medium text-[#858585]">
              Coming soon
            </span>
          )}
        </div>
        <p className="mt-4 line-clamp-1 text-[13px] leading-tight text-[#858585]">{tile.description}</p>
      </div>
    </button>
  );
}

type ConnectorStep = "checking" | "idle" | "starting" | "pending" | "connected" | "failed";

function asIntegrationStatusEntry(value: unknown): GatewayIntegrationStatusEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as GatewayIntegrationStatusEntry;
  if (
    entry.configured !== undefined ||
    entry.authenticated !== undefined ||
    entry.usable !== undefined ||
    entry.connectionId !== undefined ||
    entry.accountDisplayName !== undefined
  ) {
    return entry;
  }
  return null;
}

function integrationStatusMap(result: GatewayIntegrationStatusResult | null | undefined): Record<string, GatewayIntegrationStatusEntry> {
  const entries: Record<string, GatewayIntegrationStatusEntry> = {};
  if (!result) return entries;

  for (const [integrationId, entry] of Object.entries(result.integrations ?? {})) {
    const normalized = asIntegrationStatusEntry(entry);
    if (normalized) entries[integrationId] = normalized;
  }

  const singleEntry = asIntegrationStatusEntry(result.integration);
  if (singleEntry) {
    const integrationId = typeof singleEntry.integrationId === "string"
      ? singleEntry.integrationId
      : typeof singleEntry.id === "string"
        ? singleEntry.id
        : null;
    if (integrationId) entries[integrationId] = singleEntry;
  }

  for (const item of CATALOG_SERVICE_INTEGRATIONS) {
    const connectorId = item.connectorId;
    if (!connectorId || entries[connectorId]) continue;
    const entry = asIntegrationStatusEntry((result as Record<string, unknown>)[connectorId]);
    if (entry) entries[connectorId] = entry;
  }

  return entries;
}

function integrationStatusEntry(result: GatewayIntegrationStatusResult | null | undefined, integrationId: string): GatewayIntegrationStatusEntry | null {
  if (!result) return null;
  return integrationStatusMap(result)[integrationId] ?? asIntegrationStatusEntry(result);
}

function isIntegrationUsable(entry: GatewayIntegrationStatusEntry | null): boolean {
  if (!entry) return false;
  if (entry.usable === true) return true;
  return entry.configured === true && entry.authenticated === true && entry.usable !== false;
}

function authStatusDone(result: GatewayIntegrationAuthStatusResult): boolean {
  const status = String(result.status ?? "").toLowerCase();
  return Boolean(result.connectionId) || ["authorized", "connected", "complete", "completed", "success"].includes(status);
}

function authStatusFailed(result: GatewayIntegrationAuthStatusResult): boolean {
  const status = String(result.status ?? "").toLowerCase();
  return ["failed", "error", "expired", "denied", "cancelled", "canceled"].includes(status);
}

function GitHubConnectorPanel({
  service,
  onBack,
  onAuthStart,
  onAuthStatus,
  onIntegrationStatus,
  onStatusChange,
  onDisconnect,
}: {
  service: CatalogServiceIntegration;
  onBack: () => void;
  onAuthStart: (params: GatewayIntegrationAuthStartParams) => Promise<GatewayIntegrationAuthStartResult>;
  onAuthStatus: (params: GatewayIntegrationAuthStatusParams) => Promise<GatewayIntegrationAuthStatusResult>;
  onIntegrationStatus: (params?: GatewayIntegrationStatusParams) => Promise<GatewayIntegrationStatusResult>;
  onStatusChange?: (integrationId: string, entry: GatewayIntegrationStatusEntry | null) => void;
  onDisconnect?: (params: GatewayIntegrationDisconnectParams) => Promise<GatewayIntegrationDisconnectResult>;
}) {
  const integrationId = service.connectorId ?? service.id;
  const scopes = service.connectorScopes ?? [];
  const [step, setStep] = React.useState<ConnectorStep>("checking");
  const [authStart, setAuthStart] = React.useState<GatewayIntegrationAuthStartResult | null>(null);
  const [statusEntry, setStatusEntry] = React.useState<GatewayIntegrationStatusEntry | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const Icon = INTEGRATION_BRAND_LOGOS.github.icon ?? service.icon;
  const iconColor = INTEGRATION_BRAND_LOGOS.github.color;
  const authId = typeof authStart?.authId === "string" ? authStart.authId : "";
  const verificationHref = typeof authStart?.verificationUri === "string"
    ? authStart.verificationUri
    : typeof authStart?.url === "string"
      ? authStart.url
      : "https://github.com/login/device";
  const userCode = typeof authStart?.userCode === "string" ? authStart.userCode : "";
  const accountDisplayName = statusEntry?.accountDisplayName ?? authStart?.accountDisplayName;

  const refreshStatus = React.useCallback(async (probe = false) => {
    const result = await onIntegrationStatus({ integrationId, probe });
    const entry = integrationStatusEntry(result, integrationId);
    setStatusEntry(entry);
    onStatusChange?.(integrationId, entry);
    setStep(isIntegrationUsable(entry) ? "connected" : "idle");
  }, [integrationId, onIntegrationStatus, onStatusChange]);

  React.useEffect(() => {
    let cancelled = false;
    void refreshStatus(false).catch((cause) => {
      if (cancelled) return;
      setStep("idle");
      setError(cause instanceof Error ? cause.message : "Could not read GitHub connection status.");
    });
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  React.useEffect(() => {
    if (step !== "pending" || !authId) return;
    let cancelled = false;
    const intervalMs = typeof authStart?.intervalMs === "number" ? Math.max(authStart.intervalMs, 1500) : 3000;
    const poll = async () => {
      try {
        const result = await onAuthStatus({ authId, integrationId });
        if (cancelled) return;
        if (authStatusDone(result)) {
          setAuthStart((prev) => ({ ...(prev ?? {}), ...result }));
          const statusResult = await onIntegrationStatus({ integrationId, connectionId: result.connectionId, probe: true });
          if (cancelled) return;
          const entry = integrationStatusEntry(statusResult, integrationId) ?? {
            configured: true,
            authenticated: true,
            usable: true,
            connectionId: result.connectionId,
            accountDisplayName: result.accountDisplayName,
            scopes: result.scopes,
          };
          setStatusEntry(entry);
          onStatusChange?.(integrationId, entry);
          setStep("connected");
          return;
        }
        if (authStatusFailed(result)) {
          setError(result.error || "GitHub authorization did not complete.");
          setStep("failed");
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not check GitHub authorization status.");
          setStep("failed");
        }
      }
    };
    const timer = window.setInterval(() => void poll(), intervalMs);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authId, authStart?.intervalMs, integrationId, onAuthStatus, onIntegrationStatus, onStatusChange, step]);

  const handleStart = async () => {
    setStep("starting");
    setError(null);
    try {
      const result = await onAuthStart({ integrationId, scopes });
      setAuthStart(result);
      setStep(result.authId ? "pending" : "connected");
      if (!result.authId) await refreshStatus(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start GitHub authorization.");
      setStep("failed");
    }
  };

  const handleDisconnect = async () => {
    if (!onDisconnect) return;
    setDisconnecting(true);
    setError(null);
    try {
      await onDisconnect({ integrationId, connectionId: statusEntry?.connectionId, revoke: true });
      setStatusEntry(null);
      onStatusChange?.(integrationId, null);
      setAuthStart(null);
      setStep("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect GitHub.");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-[#030303] px-5 py-5">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 rounded-full border border-[#333333] px-3 py-1.5 text-xs text-[#d8d8d8] transition-colors hover:bg-[#1b1b1b] hover:text-[#f5f5f5]"
      >
        Back to integrations
      </button>

      <div className="max-w-2xl">
        <div className="mb-6 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#333333] bg-[#151515]">
            <Icon className="h-6 w-6" style={{ color: iconColor }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-xl font-semibold text-[#f5f5f5]">Connect GitHub</h3>
            <p className="mt-1 text-sm text-[#a7a7ad]">Use GitHub device authorization to connect repositories and issues without pasting a token into chat.</p>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-[#333333] bg-[#111113] p-4">
          <p className="text-sm font-medium text-[#f5f5f5]">Requested access</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {scopes.map((scope) => (
              <code key={scope} className="rounded-[6px] border border-[#303036] bg-[#09090b] px-2 py-1 font-mono text-[11px] text-[#f5f5f5]">{scope}</code>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[#a7a7ad]">
            GitHub&apos;s <code className="rounded bg-[#09090b] px-1 py-0.5 font-mono text-[10px] text-[#f5f5f5]">repo</code> scope can include private repositories. Choose a dedicated GitHub account or narrow permissions when backend support adds scope choices.
          </p>
        </div>

        {step === "checking" && (
          <div className="flex items-center gap-3 rounded-xl border border-[#333333] bg-[#111113] p-4 text-sm text-[#d0d0d4]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--selection-accent)]" />
            Checking GitHub connection status...
          </div>
        )}

        {(step === "idle" || step === "failed") && (
          <div className="space-y-4">
            {error && (
              <div className="rounded-xl border border-[#6d2b2b] bg-[#241010] p-4 text-sm text-[#ff8a8a]">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={handleStart}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--button-primary)] px-4 py-2 text-sm font-semibold text-[var(--button-primary-foreground)]"
            >
              Connect GitHub
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {step === "starting" && (
          <div className="flex items-center gap-3 rounded-xl border border-[#333333] bg-[#111113] p-4 text-sm text-[#d0d0d4]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--selection-accent)]" />
            Starting GitHub authorization...
          </div>
        )}

        {step === "pending" && (
          <div className="space-y-4 rounded-xl border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] p-4">
            <div>
              <p className="text-sm font-semibold text-[#f5f5f5]">Authorize in GitHub</p>
              <p className="mt-1 text-xs leading-relaxed text-[#cfd0d4]">Open GitHub&apos;s device page, enter the code, then keep this panel open while the agent confirms the connection.</p>
            </div>
            {userCode && (
              <div className="rounded-[10px] border border-[#303036] bg-[#09090b] p-4 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#85858e]">Device code</p>
                <p className="mt-2 font-mono text-2xl font-semibold tracking-[0.12em] text-[#f5f5f5]">{userCode}</p>
              </div>
            )}
            <a
              href={verificationHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--button-primary)] px-4 py-2 text-sm font-semibold text-[var(--button-primary-foreground)]"
            >
              Open GitHub
              <ExternalLink className="h-4 w-4" />
            </a>
            <div className="flex items-center gap-2 text-xs text-[#cfd0d4]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Waiting for authorization and gateway restart...
            </div>
          </div>
        )}

        {step === "connected" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-[var(--selection-accent)]" />
                <div>
                  <p className="text-sm font-semibold text-[var(--selection-accent)]">GitHub connected</p>
                  <p className="mt-0.5 text-xs text-[#cfd0d4]">{accountDisplayName ? String(accountDisplayName) : "The agent can use the connected GitHub account."}</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void refreshStatus(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-[#333333] px-3 py-2 text-xs font-medium text-[#d8d8d8] transition-colors hover:bg-[#1b1b1b]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Test connection
              </button>
              {onDisconnect && (
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="inline-flex items-center gap-2 rounded-lg border border-[#6d2b2b] px-3 py-2 text-xs font-medium text-[#ff8a8a] transition-colors hover:bg-[#241010] disabled:opacity-50"
                >
                  {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Disconnect GitHub
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function IntegrationsDirectoryPanel({
  initialCategory,
  initialPluginId,
  detailBackLabel = "Back to integrations",
  onDetailBack,
  agentName,
  config,
  configSchema,
  connected,
  onSaveConfig,
  onChannelProbe,
  onOpenShell,
  availableSkillIds,
  onOpenSkill,
  onIntegrationAuthStart,
  onIntegrationAuthStatus,
  onIntegrationStatus,
  onIntegrationDisconnect,
}: IntegrationsDirectoryPanelProps) {
  const [activeFilter, setActiveFilter] = React.useState<IntegrationFilter>(() => filterFromInitialCategory(initialCategory));
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedPluginId, setSelectedPluginId] = React.useState<string | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = React.useState<ServiceConnectorId | null>(null);
  const [integrationStatuses, setIntegrationStatuses] = React.useState<Record<string, GatewayIntegrationStatusEntry>>({});
  const scopeLabel = agentName?.trim() || "this agent";
  const connectorActionsAvailable = Boolean(onIntegrationAuthStart && onIntegrationAuthStatus && onIntegrationStatus);

  React.useEffect(() => {
    setSelectedPluginId(initialPluginId ?? null);
    setSelectedConnectorId(null);
    setActiveFilter(filterFromInitialCategory(initialCategory));
    setSearchQuery("");
  }, [initialCategory, initialPluginId]);

  const tiles = React.useMemo(() => {
    if (!configSchema) return [];
    return buildTiles(
      configSchema,
      config,
      availableSkillIds,
      connectorActionsAvailable,
      integrationStatuses,
    );
  }, [availableSkillIds, config, configSchema, connectorActionsAvailable, integrationStatuses]);

  React.useEffect(() => {
    if (!connected || !configSchema || !onIntegrationStatus) {
      return;
    }

    let cancelled = false;
    void onIntegrationStatus({ probe: false })
      .then((result) => {
        if (!cancelled) setIntegrationStatuses(integrationStatusMap(result));
      })
      .catch(() => {
        if (!cancelled) setIntegrationStatuses({});
      });

    return () => {
      cancelled = true;
    };
  }, [connected, configSchema, onIntegrationStatus]);

  const handleIntegrationStatusChange = React.useCallback((integrationId: string, entry: GatewayIntegrationStatusEntry | null) => {
    setIntegrationStatuses((prev) => {
      if (!entry) {
        if (!Object.prototype.hasOwnProperty.call(prev, integrationId)) return prev;
        const next = { ...prev };
        delete next[integrationId];
        return next;
      }
      return { ...prev, [integrationId]: entry };
    });
  }, []);

  const selectedTile = selectedPluginId
    ? tiles.find((tile) => tile.id === selectedPluginId && tile.available && tile.plugin)
    : null;
  const selectedConnectorTile = selectedConnectorId
    ? tiles.find((tile) => tile.service?.connectorId === selectedConnectorId && tile.connectorAvailable && tile.service)
    : null;
  const handleDetailBack = React.useCallback(() => {
    setSelectedPluginId(null);
    setSelectedConnectorId(null);
    onDetailBack?.();
  }, [onDetailBack]);

  const filteredTiles = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return tiles.filter((tile) => {
      if (activeFilter !== "all" && tile.category !== activeFilter) return false;
      if (!query) return true;
      return (
        tile.displayName.toLowerCase().includes(query) ||
        tile.subtitle.toLowerCase().includes(query) ||
        tile.description.toLowerCase().includes(query) ||
        tile.activeLabel?.toLowerCase().includes(query) ||
        tile.statusLabel?.toLowerCase().includes(query) ||
        tile.id.toLowerCase().includes(query)
      );
    });
  }, [activeFilter, searchQuery, tiles]);

  if (!connected || !configSchema) {
    const bootStatus = getAgentGatewayPanelBootStatus({
      connected,
      loading: connected && !configSchema,
      loadingTitle: "Loading integrations",
      loadingDetail: `Reading available capabilities for ${scopeLabel}.`,
      connectingDetail: "Opening the integrations workspace.",
      waitingDetail: "Start the agent gateway to manage integrations.",
    });

    return (
      <div className="h-full min-h-0 bg-[#030303]">
        <AgentLoadingState
          bootStatus={bootStatus ?? undefined}
        />
      </div>
    );
  }

  if (selectedTile?.plugin) {
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-[#030303] px-5 py-5">
        <button
          type="button"
          onClick={handleDetailBack}
          className="mb-5 rounded-full border border-[#333333] px-3 py-1.5 text-xs text-[#d8d8d8] transition-colors hover:bg-[#1b1b1b] hover:text-[#f5f5f5]"
        >
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
    );
  }

  if (
    selectedConnectorTile?.service?.connectorId === "github" &&
    onIntegrationAuthStart &&
    onIntegrationAuthStatus &&
    onIntegrationStatus
  ) {
    return (
      <GitHubConnectorPanel
        service={selectedConnectorTile.service}
        onBack={handleDetailBack}
        onAuthStart={onIntegrationAuthStart}
        onAuthStatus={onIntegrationAuthStatus}
        onIntegrationStatus={onIntegrationStatus}
        onStatusChange={handleIntegrationStatusChange}
        onDisconnect={onIntegrationDisconnect}
      />
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background text-foreground">
      <div className="border-b border-[#222222] px-5 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-[19px] font-semibold leading-none">All integrations</h2>
          <label className="relative w-full lg:w-[360px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#858585]" />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search integrations..." className="h-10 w-full rounded-[11px] border border-[#3a3a3d] bg-[#101010] pl-10 pr-3 text-[14px] text-[#f5f5f5] outline-none placeholder:text-[#858585] focus:border-[#5a5a5e]" />
          </label>
        </div>

        <div className="mt-8 flex flex-wrap gap-2.5">
          {FILTERS.map((filter) => (
            <button key={filter.id} type="button" onClick={() => { setActiveFilter(filter.id); setSearchQuery(""); }} className={`h-9 rounded-full border px-3.5 text-[14px] font-medium transition-colors ${activeFilter === filter.id ? "border-[#f5f5f5] bg-[#f5f5f5] text-[#111111]" : "border-[#3d3d40] bg-[#151515] text-[#f5f5f5] hover:border-[#626266]"}`}>
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-7">
        {filteredTiles.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {filteredTiles.map((tile) => (
              <IntegrationCard
                key={tile.id}
                tile={tile}
                onOpen={() => {
                  if (tile.plugin) setSelectedPluginId(tile.plugin.id);
                  else if (tile.service?.connectorId && tile.connectorAvailable && onIntegrationAuthStart && onIntegrationAuthStatus && onIntegrationStatus) setSelectedConnectorId(tile.service.connectorId);
                  else if (tile.skillId) onOpenSkill(tile.skillId);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-[12px] border border-[#333333] bg-[#181818] px-5 py-10 text-center text-sm text-[#858585]">
            No integrations match this search.
          </div>
        )}
      </div>
    </div>
  );
}
