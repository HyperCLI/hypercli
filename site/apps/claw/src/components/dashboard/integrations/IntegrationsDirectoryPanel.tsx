"use client";

import React from "react";
import Markdown from "react-markdown";
import { AlertTriangle, ArrowRight, Box, CheckCircle2, Code2, ExternalLink, FileText, Loader2, Mail, Plus, RefreshCw, Search, X } from "lucide-react";

import { DirectoryDetail } from "../directory/DirectoryDetail";
import { SkillsLoadingState } from "../directory/SkillsLoadingState";
import { isPluginAvailableInSchema, isPluginConnected, schemaPathExists, type DirectoryCategory } from "../directory/directory-utils";
import { loadSystemSkills, type AgentFileSource, type WorkspaceSkill } from "../directory/workspace-skills";
import { PLUGIN_REGISTRY, type PluginMeta } from "./plugin-registry";
import { INTEGRATION_BRAND_LOGOS, type IntegrationBrandIcon } from "./integration-brand-icons";
import { AgentLoadingState } from "../agents/page-helpers";
import { getAgentGatewayPanelBootStatus } from "../agents/chat-boot-stage";
import type { FileEntry } from "../files/types";
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

type IntegrationFilter = "all" | "web" | "channels" | "tools" | "media" | "skills";
type IntegrationIcon = IntegrationBrandIcon;
type SkillStatus = "active" | "needs-setup" | "disabled";
type SkillStatusFilter = "all" | SkillStatus;
type CatalogIntegrationStatus = "planned" | "oauth-required";
type IntegrationStatusTone = "accent" | "warning" | "neutral";
type ServiceConnectorId = "github";

interface SkillListRow {
  skill: WorkspaceSkill;
  status: SkillStatus;
  requirement: string | null;
}

interface SkillFrontmatterRow {
  key: string;
  value: string;
}

interface SkillConfigEntry {
  enabled?: boolean;
  env?: Record<string, string>;
}

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
  onLoadSkills?: () => Promise<WorkspaceSkill[]>;
  onListFiles?: (path?: string, source?: AgentFileSource) => Promise<FileEntry[]>;
  onReadFile?: (path: string, source?: AgentFileSource) => Promise<string>;
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
  skill?: WorkspaceSkill;
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

const SKILL_STATUS_FILTERS: Array<{ id: SkillStatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "needs-setup", label: "Needs setup" },
  { id: "disabled", label: "Disabled" },
];

const SKILL_MARKDOWN_COMPONENTS: Parameters<typeof Markdown>[0]["components"] = {
  h1: ({ children }) => <h1 className="mb-3 text-[17px] font-semibold leading-tight text-[#f5f5f5]">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-5 text-[14px] font-semibold leading-tight text-[#f5f5f5] first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-[12px] font-semibold leading-tight text-[#f5f5f5] first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-3 text-[12px] leading-relaxed text-[#d0d0d4] last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-[#d0d0d4]">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-[#d0d0d4]">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-[#f5f5f5]">{children}</strong>,
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre className="my-3 overflow-x-auto rounded-[8px] border border-[#303036] bg-[#09090b] p-3 text-[11px] leading-relaxed text-[#d0d0d4]">
          <code>{children}</code>
        </pre>
      );
    }
    return (
      <code className="rounded-[5px] border border-[#303036] bg-[#09090b] px-1.5 py-0.5 font-mono text-[10px] text-[#f5f5f5]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-[#56565c] pl-3 text-[12px] text-[#a7a7ad]">{children}</blockquote>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--selection-accent)] hover:underline">
      {children}
    </a>
  ),
};

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

const CATALOG_SKILL_IDS = new Set(CATALOG_SERVICE_INTEGRATIONS.flatMap((item) => item.skillIds ?? []));

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
  if (category === "web" || category === "channels" || category === "tools" || category === "media" || category === "skills") {
    return category;
  }
  return "all";
}

function catalogSkillForItem(item: CatalogServiceIntegration, skills: WorkspaceSkill[]): WorkspaceSkill | undefined {
  if (!item.skillIds) return undefined;
  return item.skillIds
    .map((skillId) => skills.find((skill) => skill.id === skillId))
    .find((skill): skill is WorkspaceSkill => Boolean(skill));
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

function catalogStatusLabel(item: CatalogServiceIntegration, skill?: WorkspaceSkill): string {
  if (skill) return "Available as skill";
  if (item.status === "oauth-required") return "Needs OAuth";
  return "Planned";
}

function catalogStatusTone(item: CatalogServiceIntegration, skill?: WorkspaceSkill): IntegrationStatusTone {
  if (skill) return "accent";
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
  workspaceSkills: WorkspaceSkill[],
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
      const skill = catalogSkillForItem(item, workspaceSkills);
      return {
        ...item,
        icon: INTEGRATION_BRAND_LOGOS[item.id]?.icon ?? item.icon,
        iconColor: INTEGRATION_BRAND_LOGOS[item.id]?.color,
        service: item,
        skill,
        connectorAvailable,
        available: connectorAvailable || connected || Boolean(skill),
        active: connected,
        activeLabel: connected ? "Connected" : undefined,
        statusLabel: connectorAvailable ? undefined : catalogStatusLabel(item, skill),
        statusTone: connectorAvailable ? undefined : catalogStatusTone(item, skill),
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
  const clickable = tile.available || Boolean(tile.skill);

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

function formatSkillRequirement(skill: WorkspaceSkill, entry?: SkillConfigEntry): string | null {
  const requirements: string[] = [];
  const missingEnv = entry
    ? skill.requiresEnv.filter((key) => !hasEnvValue(entry.env?.[key]))
    : skill.requiresEnv;
  if (missingEnv.length > 0) requirements.push(missingEnv.join(", "));
  if (skill.requiresBins.length > 0) requirements.push(`${skill.requiresBins.join(", ")} on PATH`);
  if (skill.os.length > 0) requirements.push(`${skill.os.join(", ")} only`);
  if (requirements.length > 0) return `Requires ${requirements.join("; ")}`;
  if (skill.installHints.length > 0) return "Setup instructions available";
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function envFromConfigEntry(entry: Record<string, unknown> | null): Record<string, string> {
  const env = asRecord(entry?.env);
  if (!env) return {};
  return Object.fromEntries(
    Object.entries(env)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, value as string]),
  );
}

function getSkillConfigEntry(
  config: Record<string, unknown> | null,
  skillId: string,
  overrides: Record<string, SkillConfigEntry> = {},
): SkillConfigEntry {
  const skills = asRecord(config?.skills);
  const entries = asRecord(skills?.entries);
  const entry = asRecord(entries?.[skillId]);
  const override = overrides[skillId];
  return {
    enabled: override?.enabled ?? (typeof entry?.enabled === "boolean" ? entry.enabled : undefined),
    env: {
      ...envFromConfigEntry(entry),
      ...(override?.env ?? {}),
    },
  };
}

function hasEnvValue(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasConfiguredRequiredEnv(skill: WorkspaceSkill, entry: SkillConfigEntry): boolean {
  if (skill.requiresEnv.length === 0) return true;
  const env = entry.env ?? {};
  return skill.requiresEnv.every((key) => hasEnvValue(env[key]));
}

function statusForSkill(
  skill: WorkspaceSkill,
  config: Record<string, unknown> | null,
  overrides: Record<string, SkillConfigEntry> = {},
): SkillStatus {
  const entry = getSkillConfigEntry(config, skill.id, overrides);
  if (skill.disabled || entry.enabled === false) return "disabled";
  if (!hasConfiguredRequiredEnv(skill, entry)) return "needs-setup";
  if (skill.requiresBins.length > 0 || skill.os.length > 0 || skill.installHints.length > 0) return "needs-setup";
  return "active";
}

function frontmatterScalarValue(frontmatter: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = frontmatter.match(new RegExp(`^\\s*["']?${escaped}["']?\\s*:\\s*(.+?)\\s*$`, "mi"));
  const value = match?.[1]?.trim();
  if (!value || value === "|" || value === ">") return null;
  return value.replace(/,\s*$/, "").replace(/^["']|["']$/g, "");
}

function firstInlineFrontmatterRows(frontmatter: string): SkillFrontmatterRow[] {
  return frontmatter
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*["']?([a-zA-Z0-9_.-]+)["']?\s*:\s*(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match?.[1] && match?.[2]))
    .filter((match) => match[2] !== "|" && match[2] !== ">")
    .slice(0, 6)
    .map((match) => ({
      key: match[1],
      value: match[2].replace(/,\s*$/, "").replace(/^["']|["']$/g, ""),
    }));
}

function skillFrontmatterRows(skill: WorkspaceSkill): SkillFrontmatterRow[] {
  const rows: SkillFrontmatterRow[] = [];
  const seen = new Set<string>();
  const add = (key: string, value: string | null | undefined) => {
    if (!value || seen.has(key)) return;
    seen.add(key);
    rows.push({ key, value });
  };

  add("requires.env", skill.requiresEnv.join(", "));
  add("requires.bins", skill.requiresBins.join(", "));
  add("os", skill.os.join(", "));
  add("primaryEnv", frontmatterScalarValue(skill.frontmatter, "primaryEnv"));
  add("user-invocable", frontmatterScalarValue(skill.frontmatter, "user-invocable"));
  add("model-invocable", frontmatterScalarValue(skill.frontmatter, "model-invocable"));
  add("homepage", skill.homepage);

  if (rows.length > 0) return rows.slice(0, 8);

  return firstInlineFrontmatterRows(skill.frontmatter);
}

function SkillSetupInstruction({ skill }: { skill: WorkspaceSkill }) {
  if (skill.requiresEnv.length > 0) {
    return (
      <>
        Set <code className="rounded-[5px] border border-[#554017] bg-[#09090b] px-1.5 py-0.5 font-mono text-[10px] text-[#f5f5f5]">{skill.requiresEnv.join(", ")}</code>{" "}
        in your shell or in <code className="rounded-[5px] border border-[#554017] bg-[#09090b] px-1.5 py-0.5 font-mono text-[10px] text-[#f5f5f5]">skills.entries.{skill.id}.env</code>.
      </>
    );
  }
  if (skill.requiresBins.length > 0) {
    return (
      <>
        Install <code className="rounded-[5px] border border-[#554017] bg-[#09090b] px-1.5 py-0.5 font-mono text-[10px] text-[#f5f5f5]">{skill.requiresBins.join(", ")}</code> and make it available on PATH.
      </>
    );
  }
  if (skill.os.length > 0) return <>This skill is limited to {skill.os.join(", ")} hosts.</>;
  return <>Review the setup notes in this skill before enabling it.</>;
}

function buildSkillConfigPatch(skill: WorkspaceSkill, env: Record<string, string>): Record<string, unknown> {
  const cleanEnv = Object.fromEntries(
    Object.entries(env)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value.length > 0),
  );
  const entry: Record<string, unknown> = { enabled: true };
  if (Object.keys(cleanEnv).length > 0) entry.env = cleanEnv;
  return { skills: { entries: { [skill.id]: entry } } };
}

function SkillRow({ row, selected, onOpen }: { row: SkillListRow; selected: boolean; onOpen: () => void }) {
  const { skill, status, requirement } = row;
  const statusLabel = status === "needs-setup" ? "Needs setup" : status === "disabled" ? "Disabled" : "Active";
  const statusClasses = {
    active: "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]",
    "needs-setup": "border-[#765415] bg-[#2f2209] text-[#f5c45e]",
    disabled: "border-[#333333] bg-[#151515] text-[#858585]",
  }[status];
  const dotClasses = {
    active: "bg-[var(--button-primary)]",
    "needs-setup": "bg-[#f5c45e]",
    disabled: "bg-[#626266]",
  }[status];
  const toggleClasses = {
    active: "border-[var(--selection-accent)] bg-[var(--button-primary)]",
    "needs-setup": "border-[#c99631] bg-[#f5c45e]",
    disabled: "border-[#343438] bg-[#242426]",
  }[status];
  const toggleKnobClasses = status === "disabled" ? "translate-x-0 bg-[#9a9a9a]" : "translate-x-[18px] bg-white";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`grid w-full grid-cols-1 gap-3 border-t border-[#29292c] px-3.5 py-3.5 text-left transition-colors first:border-t-0 hover:bg-[#121214] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.5)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4 ${selected ? "bg-[#121214]" : ""} ${status === "disabled" ? "opacity-60" : ""}`}
    >
      <div className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-[#303036] bg-[#151519] text-[#f3f3f3]">
          {skill.emoji ? (
            <span className="text-[14px] leading-none" aria-hidden="true">{skill.emoji}</span>
          ) : (
            <FileText className="h-3.5 w-3.5 text-[#8d8d96]" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold leading-tight text-[#f5f5f5]">{skill.name}</h3>
            <span className="max-w-[46%] shrink-0 truncate rounded-[5px] border border-[#323238] bg-[#151519] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[#9a9aa2]">
              /{skill.id}
            </span>
          </div>
          <p className="mt-1 line-clamp-1 break-words text-[12px] leading-snug text-[#a7a7ad]">{skill.description}</p>
          {requirement && (
            <p className="mt-1.5 flex min-w-0 items-center gap-1.5 font-mono text-[10px] font-semibold leading-tight text-[#f5c45e]">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{requirement}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2 pl-10 sm:justify-end sm:pl-0">
        <span className={`inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold leading-none ${statusClasses}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${dotClasses}`} aria-hidden="true" />
          <span className="truncate">{statusLabel}</span>
        </span>
        <span
          aria-hidden="true"
          className={`relative h-5 w-10 shrink-0 rounded-full border ${toggleClasses}`}
        >
          <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full shadow-sm transition-transform ${toggleKnobClasses}`} />
        </span>
      </div>
    </button>
  );
}

function SkillDrawer({
  skill,
  row,
  configEntry,
  onClose,
  onSaveConfig,
  onConfigured,
}: {
  skill: WorkspaceSkill;
  row: SkillListRow;
  configEntry: SkillConfigEntry;
  onClose: () => void;
  onSaveConfig: (patch: Record<string, unknown>) => Promise<void>;
  onConfigured: (skillId: string, entry: SkillConfigEntry) => void;
}) {
  const frontmatterRows = skillFrontmatterRows(skill);
  const needsSetup = row.status === "needs-setup";
  const statusLabel = row.status === "needs-setup" ? "Needs setup" : row.status === "disabled" ? "Disabled" : "Active";
  const statusClass = row.status === "needs-setup"
    ? "border-[#765415] bg-[#2f2209] text-[#f5c45e]"
    : row.status === "disabled"
      ? "border-[#333333] bg-[#151515] text-[#858585]"
      : "border-[var(--selection-accent-border)] bg-[var(--selection-accent-soft)] text-[var(--selection-accent)]";
  const StatusIcon = row.status === "active" ? CheckCircle2 : AlertTriangle;
  const configEntryEnvSignature = JSON.stringify(configEntry.env ?? {});
  const [envDraft, setEnvDraft] = React.useState<Record<string, string>>(() => configEntry.env ?? {});
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = React.useState<string | null>(null);
  const requiredEnvMissing = skill.requiresEnv.some((key) => !hasEnvValue(envDraft[key]));
  const canSaveSetup = !saving && row.status !== "disabled" && !requiredEnvMissing;

  React.useEffect(() => {
    setEnvDraft(configEntry.env ?? {});
  }, [configEntryEnvSignature, skill.path]);

  React.useEffect(() => {
    setSaveError(null);
    setSaveSuccess(null);
  }, [skill.path]);

  const handleSaveSetup = async () => {
    if (!canSaveSetup) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const patch = buildSkillConfigPatch(skill, envDraft);
      await onSaveConfig(patch);
      const cleanEnv = Object.fromEntries(
        Object.entries(envDraft)
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value.length > 0),
      );
      onConfigured(skill.id, { enabled: true, env: cleanEnv });
      setSaveSuccess("Saved skill config.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save skill config.");
    } finally {
      setSaving(false);
    }
  };

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close skill details"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[3px]"
      />
      <aside className="relative flex h-full w-full max-w-[432px] flex-col border-l border-[#303036] bg-[#070708] text-[#f5f5f5] shadow-[-20px_0_60px_rgba(0,0,0,0.45)]">
        <header className="flex shrink-0 items-start gap-3 border-b border-[#222226] px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-[#303036] bg-[#151519]">
            {skill.emoji ? (
              <span className="text-[16px] leading-none" aria-hidden="true">{skill.emoji}</span>
            ) : (
              <FileText className="h-4 w-4 text-[#8d8d96]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate font-mono text-[14px] font-semibold leading-tight">{skill.name}</h2>
              <span className="max-w-[42%] shrink-0 truncate font-mono text-[10px] font-semibold text-[#a7a7ad]">/{skill.id}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-[#a7a7ad]">{skill.description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[#a7a7ad] transition-colors hover:bg-[#151519] hover:text-[#f5f5f5]"
            aria-label="Close skill details"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className={`rounded-[8px] border px-3.5 py-3 ${needsSetup ? "border-[#765415] bg-[#1c1507]" : "border-[#303036] bg-[#111113]"}`}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border ${statusClass}`}>
                <StatusIcon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold leading-tight text-[#f5f5f5]">{statusLabel}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-[#c0c0c5]">
                  {needsSetup ? <SkillSetupInstruction skill={skill} /> : row.status === "disabled" ? "This skill is present but disabled by its metadata." : "This skill is bundled and ready for this agent."}
                </p>
                {skill.requiresEnv.length > 0 && row.status !== "disabled" && (
                  <div className="mt-3 space-y-2">
                    {skill.requiresEnv.map((envKey) => (
                      <label key={envKey} className="block">
                        <span className="mb-1 block font-mono text-[10px] font-semibold text-[#f5c45e]">{envKey}</span>
                        <input
                          type="password"
                          value={envDraft[envKey] ?? ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            setEnvDraft((prev) => ({ ...prev, [envKey]: value }));
                            setSaveError(null);
                            setSaveSuccess(null);
                          }}
                          placeholder={`Enter ${envKey}`}
                          className="h-8 w-full rounded-[7px] border border-[#554017] bg-[#09090b] px-2.5 font-mono text-[11px] text-[#f5f5f5] outline-none placeholder:text-[#626266] focus:border-[#f5c45e]"
                        />
                      </label>
                    ))}
                  </div>
                )}
                {saveError && <p className="mt-3 text-[11px] leading-relaxed text-[#ff6b6b]">{saveError}</p>}
                {saveSuccess && <p className="mt-3 text-[11px] leading-relaxed text-[var(--selection-accent)]">{saveSuccess}</p>}
              </div>
            </div>
          </div>

          {frontmatterRows.length > 0 && (
            <section className="mt-5">
              <h3 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#85858e]">Frontmatter</h3>
              <dl className="space-y-2">
                {frontmatterRows.map((item) => (
                  <div key={item.key} className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
                    <dt className="truncate font-mono text-[10px] leading-6 text-[#85858e]">{item.key}</dt>
                    <dd className="min-w-0">
                      <code className="inline-block max-w-full truncate rounded-[5px] border border-[#303036] bg-[#111113] px-1.5 py-1 font-mono text-[10px] leading-none text-[#f5f5f5]">
                        {item.value}
                      </code>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section className="mt-6">
            <h3 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#85858e]">SKILL.md</h3>
            <div className="rounded-[8px] border border-[#303036] bg-[#151519] px-3.5 py-3.5">
              <Markdown components={SKILL_MARKDOWN_COMPONENTS}>{skill.body || skill.content}</Markdown>
            </div>
          </section>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#222226] px-4 py-3">
          <p className="min-w-0 truncate font-mono text-[10px] text-[#85858e]">skills/{skill.id}/SKILL.md · bundled</p>
          {needsSetup ? (
            <button
              type="button"
              onClick={handleSaveSetup}
              disabled={!canSaveSetup}
              title={requiredEnvMissing ? "Enter the required environment values first." : "Save this skill config."}
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-[7px] bg-[var(--button-primary)] px-3 text-[12px] font-semibold leading-none text-[var(--button-primary-foreground)] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving ? "Saving..." : "Set up & enable"}
            </button>
          ) : row.status === "disabled" ? (
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold leading-none ${statusClass}`}>
              Disabled
            </span>
          ) : (
            <button
              type="button"
              onClick={handleSaveSetup}
              disabled={!canSaveSetup}
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-[7px] bg-[var(--button-primary)] px-3 text-[12px] font-semibold leading-none text-[var(--button-primary-foreground)] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving ? "Saving..." : configEntry.enabled === true ? "Save config" : "Enable skill"}
            </button>
          )}
        </footer>
      </aside>
    </div>
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
  onLoadSkills,
  onListFiles,
  onReadFile,
  onIntegrationAuthStart,
  onIntegrationAuthStatus,
  onIntegrationStatus,
  onIntegrationDisconnect,
}: IntegrationsDirectoryPanelProps) {
  const [activeFilter, setActiveFilter] = React.useState<IntegrationFilter>(() => filterFromInitialCategory(initialCategory));
  const [searchQuery, setSearchQuery] = React.useState("");
  const [skillStatusFilter, setSkillStatusFilter] = React.useState<SkillStatusFilter>("all");
  const [selectedPluginId, setSelectedPluginId] = React.useState<string | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = React.useState<ServiceConnectorId | null>(null);
  const [selectedSkillPath, setSelectedSkillPath] = React.useState<string | null>(null);
  const [skillConfigOverrides, setSkillConfigOverrides] = React.useState<Record<string, SkillConfigEntry>>({});
  const [workspaceSkills, setWorkspaceSkills] = React.useState<WorkspaceSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = React.useState(false);
  const [skillsError, setSkillsError] = React.useState<string | null>(null);
  const [integrationStatuses, setIntegrationStatuses] = React.useState<Record<string, GatewayIntegrationStatusEntry>>({});
  const scopeLabel = agentName?.trim() || "this agent";
  const canLoadWorkspaceSkills = Boolean(onListFiles && onReadFile);
  const connectorActionsAvailable = Boolean(onIntegrationAuthStart && onIntegrationAuthStatus && onIntegrationStatus);

  React.useEffect(() => {
    setSelectedPluginId(initialPluginId ?? null);
    setSelectedConnectorId(null);
    setSelectedSkillPath(null);
    setSkillConfigOverrides({});
    setActiveFilter(filterFromInitialCategory(initialCategory));
    setSkillStatusFilter("all");
    setSearchQuery("");
  }, [initialCategory, initialPluginId]);

  const tiles = React.useMemo(() => {
    if (!configSchema) return [];
    return buildTiles(
      configSchema,
      config,
      workspaceSkills,
      connectorActionsAvailable,
      integrationStatuses,
    );
  }, [config, configSchema, connectorActionsAvailable, integrationStatuses, workspaceSkills]);

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
    if (activeFilter === "skills") return [];
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

  React.useEffect(() => {
    if (!connected || (activeFilter !== "skills" && CATALOG_SKILL_IDS.size === 0)) return;
    const loadSkills = onLoadSkills ?? (onListFiles && onReadFile ? () => loadSystemSkills(onListFiles, onReadFile) : null);
    if (!loadSkills) return;

    let cancelled = false;
    void Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setSkillsLoading(true);
        setSkillsError(null);
        return loadSkills();
      })
      .then((skills) => {
        if (!cancelled && skills) setWorkspaceSkills(skills);
      })
      .catch((error) => {
        if (!cancelled) {
          setWorkspaceSkills([]);
          setSkillsError(error instanceof Error ? error.message : "Failed to load app skills.");
        }
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeFilter, connected, onListFiles, onLoadSkills, onReadFile]);

  const skillRows = React.useMemo<SkillListRow[]>(() => (
    workspaceSkills.map((skill) => {
      const entry = getSkillConfigEntry(config, skill.id, skillConfigOverrides);
      return {
        skill,
        requirement: formatSkillRequirement(skill, entry),
        status: statusForSkill(skill, config, skillConfigOverrides),
      };
    })
  ), [config, skillConfigOverrides, workspaceSkills]);

  const skillCounts = React.useMemo(() => {
    return skillRows.reduce(
      (counts, row) => {
        counts[row.status] += 1;
        return counts;
      },
      { active: 0, "needs-setup": 0, disabled: 0 } as Record<SkillStatus, number>,
    );
  }, [skillRows]);

  const filteredSkillRows = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return skillRows.filter((row) => {
      const { skill } = row;
      if (skillStatusFilter !== "all" && row.status !== skillStatusFilter) return false;
      if (!query) return true;
      return (
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.id.toLowerCase().includes(query) ||
        skill.category.toLowerCase().includes(query) ||
        skill.requiresEnv.some((env) => env.toLowerCase().includes(query)) ||
        skill.requiresBins.some((bin) => bin.toLowerCase().includes(query)) ||
        skill.os.some((os) => os.toLowerCase().includes(query))
      );
    });
  }, [searchQuery, skillRows, skillStatusFilter]);

  const showingSkills = activeFilter === "skills";
  const selectedSkillRow = selectedSkillPath ? skillRows.find((row) => row.skill.path === selectedSkillPath) ?? null : null;
  const selectedSkillConfigEntry: SkillConfigEntry = selectedSkillRow
    ? getSkillConfigEntry(config, selectedSkillRow.skill.id, skillConfigOverrides)
    : { env: {} };
  const skillsSummary = skillsLoading
    ? "Loading app skills"
    : `${workspaceSkills.length} bundled · ${skillCounts.active} active`;
  const effectiveSkillsError = showingSkills && !onLoadSkills && !canLoadWorkspaceSkills
    ? "Workspace file access is unavailable for this agent."
    : skillsError;

  React.useEffect(() => {
    if (activeFilter !== "skills") setSelectedSkillPath(null);
  }, [activeFilter]);

  React.useEffect(() => {
    if (selectedSkillPath && !skillRows.some((row) => row.skill.path === selectedSkillPath)) {
      setSelectedSkillPath(null);
    }
  }, [selectedSkillPath, skillRows]);

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
    <div className="h-full min-h-0 overflow-y-auto bg-[#030303] text-[#f5f5f5]">
      {showingSkills ? (
        <div className="border-b border-[#222222] px-5 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold leading-tight">Skills</h2>
              <p className="mt-3 max-w-3xl text-[12px] leading-relaxed text-[#a7a7ad]">
                Skills are AgentSkills-compatible folders shipped with OpenClaw. Each is a directory with a{" "}
                <code className="rounded-[5px] border border-[#303036] bg-[#101014] px-1.5 py-0.5 font-mono text-[10px] text-[#f5f5f5]">SKILL.md</code>{" "}
                describing what the agent can do and what it needs to run.
              </p>
            </div>
            <p className="shrink-0 text-[11px] leading-tight text-[#9a9aa2] sm:text-right">{skillsSummary}</p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {SKILL_STATUS_FILTERS.map((filter) => {
              const count = filter.id === "all" ? workspaceSkills.length : skillCounts[filter.id];
              const active = skillStatusFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => {
                    setSkillStatusFilter(filter.id);
                    setSearchQuery("");
                  }}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors ${
                    active
                      ? "border-[#f5f5f5] bg-[#f5f5f5] text-[#111111]"
                      : "border-[#333337] bg-[#111113] text-[#f5f5f5] hover:border-[#56565c]"
                  }`}
                >
                  <span>{filter.label}</span>
                  <span className={active ? "text-[#4a4a4d]" : "text-[#8d8d96]"}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="border-b border-[#222222] px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-[19px] font-semibold leading-none">All integrations</h2>
            <label className="relative w-full lg:w-[360px]">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#858585]" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search integrations..."
                className="h-10 w-full rounded-[11px] border border-[#3a3a3d] bg-[#101010] pl-10 pr-3 text-[14px] text-[#f5f5f5] outline-none placeholder:text-[#858585] focus:border-[#5a5a5e]"
              />
            </label>
          </div>

          <div className="mt-8 flex flex-wrap gap-2.5">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => {
                  setActiveFilter(filter.id);
                  setSkillStatusFilter("all");
                  setSearchQuery("");
                }}
                className={`h-9 rounded-full border px-3.5 text-[14px] font-medium transition-colors ${
                  activeFilter === filter.id
                    ? "border-[#f5f5f5] bg-[#f5f5f5] text-[#111111]"
                    : "border-[#3d3d40] bg-[#151515] text-[#f5f5f5] hover:border-[#626266]"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-5 py-7">
        {showingSkills ? (
          skillsLoading ? (
            <SkillsLoadingState className="rounded-[12px] border border-[#333333] bg-[#181818]" />
          ) : effectiveSkillsError ? (
            <div className="rounded-[12px] border border-[#333333] bg-[#181818] px-5 py-10 text-center text-sm text-[#858585]">
              {effectiveSkillsError}
            </div>
          ) : filteredSkillRows.length > 0 ? (
            <div className="overflow-hidden rounded-[10px] border border-[#333337] bg-[#0b0b0c]">
              {filteredSkillRows.map((row) => (
                <SkillRow
                  key={row.skill.path}
                  row={row}
                  selected={selectedSkillPath === row.skill.path}
                  onOpen={() => setSelectedSkillPath(row.skill.path)}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-[12px] border border-[#333333] bg-[#181818] px-5 py-10 text-center text-sm text-[#858585]">
              <Box className="mx-auto mb-3 h-5 w-5 text-[#696969]" />
              No app skills found.
            </div>
          )
        ) : filteredTiles.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {filteredTiles.map((tile) => (
              <IntegrationCard
                key={tile.id}
                tile={tile}
                onOpen={() => {
                  if (tile.plugin) setSelectedPluginId(tile.plugin.id);
                  else if (tile.service?.connectorId && tile.connectorAvailable && onIntegrationAuthStart && onIntegrationAuthStatus && onIntegrationStatus) setSelectedConnectorId(tile.service.connectorId);
                  else if (tile.skill) setSelectedSkillPath(tile.skill.path);
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
      {selectedSkillRow && (
        <SkillDrawer
          skill={selectedSkillRow.skill}
          row={selectedSkillRow}
          configEntry={selectedSkillConfigEntry}
          onClose={() => setSelectedSkillPath(null)}
          onSaveConfig={onSaveConfig}
          onConfigured={(skillId, entry) => {
            setSkillConfigOverrides((prev) => ({
              ...prev,
              [skillId]: {
                ...prev[skillId],
                ...entry,
                env: {
                  ...(prev[skillId]?.env ?? {}),
                  ...(entry.env ?? {}),
                },
              },
            }));
          }}
        />
      )}
    </div>
  );
}
