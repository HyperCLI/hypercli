"use client";

import React from "react";
import Markdown from "react-markdown";
import { AlertTriangle, Box, CheckCircle2, Code2, FileText, Loader2, Mail, Plus, Search, X } from "lucide-react";
import type { IconType } from "react-icons";
import {
  SiAnthropic,
  SiAsana,
  SiBrave,
  SiCloudflare,
  SiDeepgram,
  SiDiscord,
  SiDuckduckgo,
  SiElevenlabs,
  SiGithub,
  SiGithubcopilot,
  SiGitlab,
  SiGmail,
  SiGoogle,
  SiGooglecalendar,
  SiGooglechat,
  SiGoogledrive,
  SiHuggingface,
  SiImessage,
  SiJira,
  SiLine,
  SiLinear,
  SiMatrix,
  SiMattermost,
  SiMistralai,
  SiNextcloud,
  SiNotion,
  SiNvidia,
  SiOllama,
  SiOpenai,
  SiPerplexity,
  SiSignal,
  SiSlack,
  SiTelegram,
  SiTrello,
  SiTwitch,
  SiVercel,
  SiWhatsapp,
  SiX,
  SiXiaomi,
  SiZalo,
} from "react-icons/si";

import { DirectoryDetail } from "../directory/DirectoryDetail";
import { isPluginConnected, type DirectoryCategory } from "../directory/directory-utils";
import { loadSystemSkills, type AgentFileSource, type WorkspaceSkill } from "../directory/workspace-skills";
import { PLUGIN_REGISTRY, type PluginMeta } from "./plugin-registry";
import { AgentLoadingState } from "../agents/page-helpers";
import { TeamsIcon } from "../BrandIcons";
import type { FileEntry } from "../files/types";
import type { OpenClawConfigSchemaResponse } from "@hypercli.com/sdk/openclaw/gateway";

type IntegrationFilter = "all" | "web" | "channels" | "tools" | "media" | "skills";
type IntegrationIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
type SkillStatus = "active" | "needs-setup" | "disabled";
type SkillStatusFilter = "all" | SkillStatus;

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
}

interface ComingSoonIntegration {
  id: string;
  displayName: string;
  subtitle: string;
  description: string;
  category: IntegrationFilter;
  icon: IntegrationIcon;
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
  available: boolean;
  active: boolean;
}

const WEB_PLUGIN_IDS = new Set(["brave", "duckduckgo", "exa", "tavily", "firecrawl"]);
const MEDIA_PLUGIN_IDS = new Set(["elevenlabs", "deepgram", "fal", "voice-call", "talk-voice", "phone-control"]);

const FILTERS: Array<{ id: IntegrationFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "web", label: "Web" },
  { id: "channels", label: "Channels" },
  { id: "tools", label: "Tools" },
  { id: "media", label: "Media" },
  { id: "skills", label: "Skills" },
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
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#38d39f] hover:underline">
      {children}
    </a>
  ),
};

const COMING_SOON_INTEGRATIONS: ComingSoonIntegration[] = [
  { id: "notion", displayName: "Notion", subtitle: "Docs & wiki", description: "Read pages, query databases", category: "tools", icon: SiNotion },
  { id: "google-drive", displayName: "Google Drive", subtitle: "File storage", description: "Read docs, sheets, slides", category: "tools", icon: SiGoogledrive },
  { id: "google-calendar", displayName: "Google Calendar", subtitle: "Scheduling", description: "Create events, find availability", category: "tools", icon: SiGooglecalendar },
  { id: "asana", displayName: "Asana", subtitle: "Task management", description: "Create tasks, track projects", category: "tools", icon: SiAsana },
  { id: "github", displayName: "GitHub", subtitle: "Repos & issues", description: "Read repos, manage PRs, track issues", category: "tools", icon: SiGithub },
  { id: "jira", displayName: "Jira", subtitle: "Issue tracking", description: "Create tickets, query sprints", category: "tools", icon: SiJira },
  { id: "vscode", displayName: "VS Code", subtitle: "IDE", description: "Edit files and run local workflows", category: "tools", icon: Code2 },
  { id: "gmail", displayName: "Gmail", subtitle: "Email", description: "Send, search, draft messages", category: "channels", icon: SiGmail },
  { id: "outlook", displayName: "Outlook", subtitle: "Email & calendar", description: "Microsoft mail and scheduling", category: "channels", icon: Mail },
  { id: "trello", displayName: "Trello", subtitle: "Boards", description: "Manage cards, lists, boards", category: "tools", icon: SiTrello },
  { id: "gitlab", displayName: "GitLab", subtitle: "Repos & CI", description: "Manage projects, pipelines, MRs", category: "tools", icon: SiGitlab },
  { id: "linear", displayName: "Linear", subtitle: "Project tracking", description: "Sync issues, cycles, projects", category: "tools", icon: SiLinear },
  { id: "vercel", displayName: "Vercel", subtitle: "Deployment", description: "Deploy apps and inspect builds", category: "web", icon: SiVercel },
];

const BRAND_LOGOS: Record<string, { icon: IconType | IntegrationIcon; color: string }> = {
  anthropic: { icon: SiAnthropic, color: "#d4c5b4" },
  asana: { icon: SiAsana, color: "#f06a6a" },
  brave: { icon: SiBrave, color: "#fb542b" },
  "cloudflare-ai-gateway": { icon: SiCloudflare, color: "#f38020" },
  "copilot-proxy": { icon: SiGithubcopilot, color: "#ffffff" },
  deepgram: { icon: SiDeepgram, color: "#13ef93" },
  discord: { icon: SiDiscord, color: "#5865f2" },
  duckduckgo: { icon: SiDuckduckgo, color: "#de5833" },
  elevenlabs: { icon: SiElevenlabs, color: "#ffffff" },
  gitlab: { icon: SiGitlab, color: "#fc6d26" },
  gmail: { icon: SiGmail, color: "#ea4335" },
  google: { icon: SiGoogle, color: "#4285f4" },
  googlechat: { icon: SiGooglechat, color: "#34a853" },
  "google-calendar": { icon: SiGooglecalendar, color: "#4285f4" },
  "google-drive": { icon: SiGoogledrive, color: "#34a853" },
  "github": { icon: SiGithub, color: "#ffffff" },
  "github-copilot": { icon: SiGithubcopilot, color: "#ffffff" },
  huggingface: { icon: SiHuggingface, color: "#ffd21e" },
  imessage: { icon: SiImessage, color: "#34c759" },
  jira: { icon: SiJira, color: "#0c66e4" },
  line: { icon: SiLine, color: "#06c755" },
  linear: { icon: SiLinear, color: "#ffffff" },
  matrix: { icon: SiMatrix, color: "#ffffff" },
  mattermost: { icon: SiMattermost, color: "#1e325c" },
  mistral: { icon: SiMistralai, color: "#ff7000" },
  msteams: { icon: TeamsIcon, color: "#6264a7" },
  nextcloud: { icon: SiNextcloud, color: "#0082c9" },
  notion: { icon: SiNotion, color: "#ffffff" },
  nvidia: { icon: SiNvidia, color: "#76b900" },
  ollama: { icon: SiOllama, color: "#ffffff" },
  openai: { icon: SiOpenai, color: "#ffffff" },
  perplexity: { icon: SiPerplexity, color: "#1fb8cd" },
  signal: { icon: SiSignal, color: "#3a76f0" },
  slack: { icon: SiSlack, color: "#e01e5a" },
  telegram: { icon: SiTelegram, color: "#26a5e4" },
  trello: { icon: SiTrello, color: "#0052cc" },
  twitch: { icon: SiTwitch, color: "#9146ff" },
  vercel: { icon: SiVercel, color: "#ffffff" },
  whatsapp: { icon: SiWhatsapp, color: "#25d366" },
  xai: { icon: SiX, color: "#ffffff" },
  xiaomi: { icon: SiXiaomi, color: "#ff6900" },
  zalo: { icon: SiZalo, color: "#0068ff" },
};

function schemaPathExists(schema: Record<string, unknown> | null | undefined, path: string): boolean {
  if (!schema) return false;
  let node: Record<string, unknown> | undefined = schema;
  for (const part of path.split(".")) {
    const properties = node?.properties as Record<string, unknown> | undefined;
    if (!properties || typeof properties !== "object" || !(part in properties)) {
      return false;
    }
    node = properties[part] as Record<string, unknown>;
  }
  return true;
}

function isPluginAvailableInSchema(plugin: PluginMeta, configSchema: OpenClawConfigSchemaResponse | null): boolean {
  if (!configSchema) return false;
  return (
    schemaPathExists(configSchema.schema, plugin.configPath) ||
    Boolean(configSchema.uiHints?.[plugin.configPath] || configSchema.uiHints?.[`${plugin.configPath}.enabled`])
  );
}

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

function buildTiles(configSchema: OpenClawConfigSchemaResponse, config: Record<string, unknown> | null): IntegrationTile[] {
  const pluginTiles = PLUGIN_REGISTRY.map((plugin) => {
    const category = categoryForPlugin(plugin);
    const available = isPluginAvailableInSchema(plugin, configSchema);
    const brand = BRAND_LOGOS[plugin.id];
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
  const comingSoonTiles = COMING_SOON_INTEGRATIONS
    .filter((item) => !pluginIds.has(item.id))
    .map((item) => ({
      ...item,
      icon: BRAND_LOGOS[item.id]?.icon ?? item.icon,
      iconColor: BRAND_LOGOS[item.id]?.color,
      available: false,
      active: false,
    }));

  return [...pluginTiles, ...comingSoonTiles].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

function IntegrationCard({ tile, onOpen }: { tile: IntegrationTile; onOpen: () => void }) {
  const Icon = tile.icon;
  const clickable = tile.available;

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
              Active
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
    active: "border-[#0d5d42] bg-[#063a2a] text-[#38d39f]",
    "needs-setup": "border-[#765415] bg-[#2f2209] text-[#f5c45e]",
    disabled: "border-[#333333] bg-[#151515] text-[#858585]",
  }[status];
  const dotClasses = {
    active: "bg-[#38d39f]",
    "needs-setup": "bg-[#f5c45e]",
    disabled: "bg-[#626266]",
  }[status];
  const toggleClasses = {
    active: "border-[#12a775] bg-[#38d39f]",
    "needs-setup": "border-[#c99631] bg-[#f5c45e]",
    disabled: "border-[#343438] bg-[#242426]",
  }[status];
  const toggleKnobClasses = status === "disabled" ? "translate-x-0 bg-[#9a9a9a]" : "translate-x-[18px] bg-white";

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`grid w-full grid-cols-1 gap-3 border-t border-[#29292c] px-3.5 py-3.5 text-left transition-colors first:border-t-0 hover:bg-[#121214] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#38d39f]/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-4 ${selected ? "bg-[#121214]" : ""} ${status === "disabled" ? "opacity-60" : ""}`}
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
      : "border-[#0d5d42] bg-[#063a2a] text-[#38d39f]";
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
                {saveSuccess && <p className="mt-3 text-[11px] leading-relaxed text-[#38d39f]">{saveSuccess}</p>}
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
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-[7px] bg-[#38d39f] px-3 text-[12px] font-semibold leading-none text-[#03110c] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
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
              className="inline-flex h-8 shrink-0 items-center justify-center rounded-[7px] bg-[#38d39f] px-3 text-[12px] font-semibold leading-none text-[#03110c] transition-opacity disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving ? "Saving..." : configEntry.enabled === true ? "Save config" : "Enable skill"}
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}

export function IntegrationsDirectoryPanel({
  initialCategory,
  initialPluginId,
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
}: IntegrationsDirectoryPanelProps) {
  const [activeFilter, setActiveFilter] = React.useState<IntegrationFilter>(() => filterFromInitialCategory(initialCategory));
  const [searchQuery, setSearchQuery] = React.useState("");
  const [skillStatusFilter, setSkillStatusFilter] = React.useState<SkillStatusFilter>("all");
  const [selectedPluginId, setSelectedPluginId] = React.useState<string | null>(null);
  const [selectedSkillPath, setSelectedSkillPath] = React.useState<string | null>(null);
  const [skillConfigOverrides, setSkillConfigOverrides] = React.useState<Record<string, SkillConfigEntry>>({});
  const [workspaceSkills, setWorkspaceSkills] = React.useState<WorkspaceSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = React.useState(false);
  const [skillsError, setSkillsError] = React.useState<string | null>(null);
  const scopeLabel = agentName?.trim() || "this agent";
  const canLoadWorkspaceSkills = Boolean(onListFiles && onReadFile);

  React.useEffect(() => {
    setSelectedPluginId(initialPluginId ?? null);
    setSelectedSkillPath(null);
    setSkillConfigOverrides({});
    setActiveFilter(filterFromInitialCategory(initialCategory));
    setSkillStatusFilter("all");
    setSearchQuery("");
  }, [initialCategory, initialPluginId]);

  const tiles = React.useMemo(() => {
    if (!configSchema) return [];
    return buildTiles(configSchema, config);
  }, [config, configSchema]);

  const selectedTile = selectedPluginId
    ? tiles.find((tile) => tile.id === selectedPluginId && tile.available && tile.plugin)
    : null;

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
        tile.id.toLowerCase().includes(query)
      );
    });
  }, [activeFilter, searchQuery, tiles]);

  React.useEffect(() => {
    if (!connected || activeFilter !== "skills") return;
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
    ? "Loading bundled skills"
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
    return (
      <div className="h-full min-h-0 bg-[#030303]">
        <AgentLoadingState
          title={connected ? "Loading integrations" : "Waiting for gateway"}
          detail={connected ? `Reading available capabilities for ${scopeLabel}.` : "Start the agent gateway to manage integrations."}
          tone={connected ? "loading" : "connecting"}
          stage="gateway"
        />
      </div>
    );
  }

  if (selectedTile?.plugin) {
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-[#030303] px-5 py-5">
        <button
          type="button"
          onClick={() => setSelectedPluginId(null)}
          className="mb-5 rounded-full border border-[#333333] px-3 py-1.5 text-xs text-[#d8d8d8] transition-colors hover:bg-[#1b1b1b] hover:text-[#f5f5f5]"
        >
          Back to integrations
        </button>
        <DirectoryDetail
          pluginId={selectedTile.plugin.id}
          config={config}
          connected={connected}
          onSaveConfig={onSaveConfig}
          onChannelProbe={onChannelProbe}
          onOpenShell={onOpenShell}
          onBack={() => setSelectedPluginId(null)}
          onCloseModal={() => setSelectedPluginId(null)}
        />
      </div>
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
            <div className="flex min-h-[260px] items-center justify-center rounded-[12px] border border-[#333333] bg-[#181818]">
              <div className="flex items-center gap-3 text-sm text-[#a7a7a7]">
                <Loader2 className="h-4 w-4 animate-spin text-[#29d76f]" />
                Loading app skills...
              </div>
            </div>
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
