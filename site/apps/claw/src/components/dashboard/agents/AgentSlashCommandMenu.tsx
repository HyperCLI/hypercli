"use client";

import React, { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import type { AgentSkillSearchItem, AgentSkillSummary } from "@hypercli.com/sdk/skills";
import {
  Activity,
  Bot,
  CalendarClock,
  Check,
  CreditCard,
  FileText,
  FolderPlus,
  FolderOpen,
  HelpCircle,
  ListTree,
  Loader2,
  MessageSquarePlus,
  PanelRightOpen,
  Play,
  RefreshCw,
  Search,
  Settings,
  Shell,
  Sparkles,
  Square,
  Trash2,
  Unplug,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import type { AgentGatewaySession } from "@/components/dashboard/agents/AgentGatewayProvider";
import { getConnectCommandSuggestions, type ChatConnectionSuggestion } from "@/components/dashboard/agents/AgentChatConnectionSuggestions";
import { buildOpenClawDefaultModelPatch, normalizeOpenClawModelOptions } from "@/lib/openclaw-models";

type ChatSession = AgentGatewaySession;
type ChatConnectorId = NonNullable<ChatConnectionSuggestion["connectorId"]>;
type SlashCommandMode = "ui" | "prompt" | "confirm";
type SlashCommandCategory = "Chat" | "Agent" | "Workspace" | "Tools" | "Skills" | "Connections" | "Schedule" | "Diagnostics" | "Account";

export interface AgentSlashCommandActions {
  onOpenFiles?: (path?: string) => void;
  onOpenConfig?: () => void;
  onOpenIntegrations?: () => void;
  onOpenConnectionSuggestion?: (suggestion: ChatConnectionSuggestion) => void | Promise<void>;
  onOpenIntegrationChatCard?: (integrationId: ChatConnectorId) => void;
  onOpenSkills?: () => void;
  onOpenScheduled?: (draft?: string) => void;
  onOpenLogs?: () => void;
  onOpenShell?: () => void;
  onOpenPlans?: () => void | Promise<void>;
  onOpenBilling?: () => void;
  onOpenActivity?: () => void;
  onStartAgent?: () => void | Promise<void>;
  onStopAgent?: () => void | Promise<void>;
  onNewConversation?: () => void | Promise<void>;
  onNewAgent?: () => void;
  onRenameAgent?: (name: string) => void | Promise<void>;
  onOpenAgentSettings?: () => void;
  onTriggerFilePicker?: () => void;
  onCreateDirectory?: (name: string) => void | Promise<void>;
}

export interface AgentSlashCommandMenuHandle {
  canHandleInput: () => boolean;
  executeCurrentInput: () => Promise<boolean>;
  moveSelection: (delta: number) => void;
  selectFirst: () => void;
  selectLast: () => void;
  completeSelection: () => boolean;
  close: () => void;
}

interface AgentSlashCommandMenuProps {
  chat: ChatSession;
  input: string;
  selectedAgentName: string;
  isSelectedRunning: boolean;
  actions?: AgentSlashCommandActions;
  onFeedback?: (message: string) => void;
}

interface SlashCommandContext {
  chat: ChatSession;
  args: string;
  actions: AgentSlashCommandActions;
  selectedAgentName: string;
  isSelectedRunning: boolean;
  setStatus: (message: string) => void;
  showFeedback: (message: string) => void;
  close: () => void;
}

interface SlashCommandConfirmation {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface SlashCommand {
  id: string;
  aliases: string[];
  title: string;
  description: string;
  category: SlashCommandCategory;
  mode: SlashCommandMode;
  Icon: LucideIcon;
  danger?: boolean;
  requiresRunningAgent?: boolean;
  isEnabled?: (ctx: SlashCommandContext) => string | true;
  confirm?: (ctx: SlashCommandContext) => SlashCommandConfirmation | null;
  run: (ctx: SlashCommandContext) => Promise<void> | void;
}

const PROMPTS = {
  summary: "Summarize this session so far with decisions, open tasks, and next actions.",
  retry: "Retry your last answer. Keep the same goal, but correct any errors.",
  fix: "Inspect the current issue, identify the likely cause, and propose the smallest safe fix.",
  test: "Run the relevant checks for this workspace and summarize the results.",
  ship: "Prepare a handoff: what changed, checks run, risks, and next steps.",
  explain: "Explain the current workspace or selected file in plain language.",
  todo: "Extract open tasks from this session and group them by priority.",
  handoff: "Create a concise handoff for another operator continuing this work.",
  diff: "Review workspace changes and summarize the diff.",
};
function slashInput(input: string): string | null {
  const trimmedStart = input.trimStart();
  if (!trimmedStart.startsWith("/") || trimmedStart.startsWith("//")) return null;
  return trimmedStart;
}

function commandParts(input: string): { token: string; args: string } {
  const normalized = input.slice(1);
  const [token = "", ...rest] = normalized.split(/\s+/);
  return {
    token: token.toLowerCase(),
    args: rest.join(" ").trim(),
  };
}

function connectSuggestionQuery(input: string | null): string | null {
  if (!input) return null;
  const match = input.match(/^\/connect\s+(.*)$/i);
  return match ? match[1] ?? "" : null;
}

async function openConnectionSuggestion(ctx: SlashCommandContext, suggestion: ChatConnectionSuggestion): Promise<void> {
  if (ctx.actions.onOpenConnectionSuggestion) {
    await ctx.actions.onOpenConnectionSuggestion(suggestion);
  } else if (suggestion.connectorId && ctx.actions.onOpenIntegrationChatCard) {
    ctx.actions.onOpenIntegrationChatCard(suggestion.connectorId);
  } else if (ctx.actions.onOpenIntegrations) {
    await ctx.actions.onOpenIntegrations();
  } else {
    ctx.setStatus("Integrations are unavailable here.");
    return;
  }
  ctx.chat.setInput("");
  ctx.showFeedback(`${suggestion.displayName} connection opened.`);
  ctx.close();
}

function runAction(action: (() => void | Promise<void>) | undefined, disabledMessage: string, feedbackMessage?: string) {
  return async (ctx: SlashCommandContext) => {
    if (!action) {
      ctx.setStatus(disabledMessage);
      return;
    }
    await action();
    ctx.chat.setInput("");
    if (feedbackMessage) ctx.showFeedback(feedbackMessage);
    ctx.close();
  };
}

function promptWithContext(prompt: string, args: string): string {
  const context = args.trim();
  return context ? `${prompt}\n\nAdditional context: ${context}` : prompt;
}

function validateSingleFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Pass a folder name, for example /mkdir reports.";
  if (trimmed === "." || trimmed === "..") return "Use a real folder name.";
  if (/[\\/]/.test(trimmed)) return "Create one folder at a time.";
  return null;
}

function compactStatusText(value: string | undefined, maxLength = 96): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}...`;
}

function parseSkillCommandArgs(args: string): { action: "open" | "search" | "install" | "status"; value: string } {
  const trimmed = args.trim();
  if (!trimmed) return { action: "open", value: "" };

  const [rawAction = "", ...rest] = trimmed.split(/\s+/);
  const action = rawAction.toLowerCase();
  const value = rest.join(" ").trim();
  if (action === "search" || action === "install" || action === "status") {
    return { action, value };
  }
  return { action: "search", value: trimmed };
}

function formatSkillSearchStatus(results: AgentSkillSearchItem[]): string {
  if (results.length === 0) return "No catalog skills found.";
  return results
    .slice(0, 5)
    .map((skill) => {
      const summary = compactStatusText(skill.description, 72);
      return summary ? `${skill.id}: ${summary}` : skill.id;
    })
    .join(" | ");
}

function formatSkillsStatus(skills: AgentSkillSummary[]): string {
  const installed = skills.length;
  const active = skills.filter((skill) => skill.availability === "active").length;
  return `${installed} skill${installed === 1 ? "" : "s"} installed, ${active} active.`;
}

function formatSessionCount(count: number): string {
  return `${count} session${count === 1 ? "" : "s"}`;
}

function refreshedSessionCount(refreshedSessions: Awaited<ReturnType<ChatSession["refreshSessions"]>>, fallbackSessions: ChatSession["sessions"]): number {
  return Array.isArray(refreshedSessions) ? refreshedSessions.length : fallbackSessions.length;
}

function sendPrompt(prompt: string | ((args: string) => string)): SlashCommand["run"] {
  return async ({ args, chat, close, showFeedback }) => {
    const message = typeof prompt === "function" ? prompt(args) : promptWithContext(prompt, args);
    chat.setInput("");
    if (chat.activeSessionSending) {
      chat.addPendingMessage(message);
      showFeedback("Prompt queued.");
    } else {
      await chat.sendMessage(message);
      showFeedback("Prompt sent.");
    }
    close();
  };
}

function optionValue(model: Record<string, unknown>): string {
  const value = model.value ?? model.id ?? model.modelId ?? model.model_id ?? model.name;
  return typeof value === "string" ? value : "";
}

function resolveRequestedModel(chat: ChatSession, args: string): { modelValue?: string; status?: string } {
  const requested = args.trim();
  const models = normalizeOpenClawModelOptions(chat.config, chat.models, requested);
  if (!requested) {
    return {
      status: models.length > 0 ? `Pass a model id. First option: ${models[0].value}` : "No model options are loaded yet.",
    };
  }

  const match = models.find((model) => model.value === requested || model.label.toLowerCase() === requested.toLowerCase());
  if (!match) {
    const fallback = chat.models.find((model) => optionValue(model) === requested);
    if (!fallback) {
      return { status: `Model "${requested}" is not in the loaded model list.` };
    }
  }

  return { modelValue: match?.value ?? requested };
}

function buildSlashCommands(): SlashCommand[] {
  return [
    {
      id: "menu",
      aliases: ["menu", "help", "?"],
      title: "Command menu",
      description: "Show available chat commands.",
      category: "Chat",
      mode: "ui",
      Icon: HelpCircle,
      run: ({ setStatus }) => setStatus("Choose a command or keep typing to filter."),
    },
    {
      id: "new",
      aliases: ["new"],
      title: "New Session",
      description: "Start a fresh session.",
      category: "Chat",
      mode: "ui",
      Icon: MessageSquarePlus,
      run: runAction(undefined, "New Session is unavailable here."),
    },
    {
      id: "abort",
      aliases: ["abort", "cancel"],
      title: "Stop reply",
      description: "Stop the current assistant reply.",
      category: "Chat",
      mode: "ui",
      Icon: Square,
      run: async ({ chat, setStatus, close, showFeedback }) => {
        if (!chat.sending) {
          setStatus("No reply is currently running.");
          return;
        }
        await chat.abortMessage();
        close();
        showFeedback("Stop requested.");
      },
    },
    {
      id: "summary",
      aliases: ["summary", "summarize"],
      title: "Summarize chat",
      description: "Ask for a session summary.",
      category: "Chat",
      mode: "prompt",
      Icon: ListTree,
      run: sendPrompt(PROMPTS.summary),
    },
    {
      id: "retry",
      aliases: ["retry"],
      title: "Retry answer",
      description: "Ask for a corrected retry.",
      category: "Chat",
      mode: "prompt",
      Icon: RefreshCw,
      run: sendPrompt(PROMPTS.retry),
    },
    {
      id: "clear",
      aliases: ["clear"],
      title: "Clear draft",
      description: "Clear the composer draft and pending local input.",
      category: "Chat",
      mode: "confirm",
      Icon: Trash2,
      confirm: () => ({
        title: "Clear draft",
        message: "Clear the current draft? Persisted chat history will not be deleted.",
        confirmLabel: "Clear",
      }),
      run: ({ chat, close, showFeedback }) => {
        chat.setInput("");
        showFeedback("Draft cleared.");
        close();
      },
    },
    {
      id: "start",
      aliases: ["start"],
      title: "Start agent",
      description: "Start the selected agent.",
      category: "Agent",
      mode: "confirm",
      Icon: Play,
      isEnabled: ({ isSelectedRunning, actions }) => (
        isSelectedRunning ? "Agent is already running." : actions.onStartAgent ? true : "Start action is unavailable here."
      ),
      confirm: ({ selectedAgentName }) => ({
        title: "Start agent",
        message: `Start ${selectedAgentName}?`,
        confirmLabel: "Start",
      }),
      run: async (ctx) => {
        await ctx.actions.onStartAgent?.();
        ctx.chat.setInput("");
        ctx.showFeedback("Start requested.");
        ctx.close();
      },
    },
    {
      id: "stop",
      aliases: ["stop"],
      title: "Stop agent",
      description: "Stop the selected running agent.",
      category: "Agent",
      mode: "confirm",
      Icon: Square,
      danger: true,
      isEnabled: ({ isSelectedRunning, actions }) => (
        !isSelectedRunning ? "Agent is not running." : actions.onStopAgent ? true : "Stop action is unavailable here."
      ),
      confirm: ({ selectedAgentName }) => ({
        title: "Stop agent",
        message: `Stop ${selectedAgentName}?`,
        confirmLabel: "Stop",
        danger: true,
      }),
      run: async (ctx) => {
        await ctx.actions.onStopAgent?.();
        ctx.chat.setInput("");
        ctx.showFeedback("Stop requested.");
        ctx.close();
      },
    },
    {
      id: "new-agent",
      aliases: ["new-agent", "agent"],
      title: "New agent",
      description: "Open the agent creation flow.",
      category: "Agent",
      mode: "ui",
      Icon: Bot,
      run: runAction(undefined, "Agent creation is unavailable here."),
    },
    {
      id: "status",
      aliases: ["status"],
      title: "Status",
      description: "Show runtime, gateway, session, file, and schedule counts.",
      category: "Agent",
      mode: "ui",
      Icon: Activity,
      run: ({ chat, selectedAgentName, isSelectedRunning, setStatus }) => {
        setStatus(
          `${selectedAgentName}: ${isSelectedRunning ? "running" : "stopped"} · gateway ${chat.connected ? "ready" : chat.connecting ? "connecting" : "offline"} · ${chat.sessions.length} sessions · ${chat.files.length} files · ${chat.cronJobs.length} scheduled`,
        );
      },
    },
    {
      id: "rename",
      aliases: ["rename"],
      title: "Rename agent",
      description: "Rename a stopped agent.",
      category: "Agent",
      mode: "confirm",
      Icon: Settings,
      isEnabled: ({ isSelectedRunning, actions }) => (
        isSelectedRunning ? "Stop the agent before renaming it." : actions.onRenameAgent ? true : "Rename action is unavailable here."
      ),
      confirm: (ctx) => ctx.args ? ({
        title: "Rename agent",
        message: `Rename ${ctx.selectedAgentName} to "${ctx.args}"?`,
        confirmLabel: "Rename",
      }) : null,
      run: async (ctx) => {
        if (!ctx.args) {
          ctx.actions.onOpenAgentSettings?.();
          ctx.setStatus("Open settings or pass a name, for example /rename Research agent.");
          return;
        }
        await ctx.actions.onRenameAgent?.(ctx.args);
        ctx.chat.setInput("");
        ctx.showFeedback("Agent renamed.");
        ctx.close();
      },
    },
    {
      id: "files",
      aliases: ["files"],
      title: "Files",
      description: "Open the workspace files panel.",
      category: "Workspace",
      mode: "ui",
      Icon: FolderOpen,
      run: runAction(undefined, "Files panel is unavailable here."),
    },
    {
      id: "open",
      aliases: ["open"],
      title: "Open file",
      description: "Open files panel, optionally with a path.",
      category: "Workspace",
      mode: "ui",
      Icon: FileText,
      run: async ({ actions, args, chat, setStatus, close, showFeedback }) => {
        if (!actions.onOpenFiles) {
          setStatus("Files panel is unavailable here.");
          return;
        }
        actions.onOpenFiles(args || undefined);
        chat.setInput("");
        showFeedback(args ? `Opening ${args}.` : "Files opened.");
        close();
      },
    },
    {
      id: "upload",
      aliases: ["upload", "attach"],
      title: "Upload file",
      description: "Open the file picker.",
      category: "Workspace",
      mode: "ui",
      Icon: PanelRightOpen,
      run: runAction(undefined, "File picker is unavailable here."),
    },
    {
      id: "mkdir",
      aliases: ["mkdir", "folder"],
      title: "New folder",
      description: "Create one folder in the workspace root.",
      category: "Workspace",
      mode: "confirm",
      Icon: FolderPlus,
      requiresRunningAgent: true,
      isEnabled: ({ actions, args }) => {
        if (!actions.onCreateDirectory) return "Folder creation is unavailable here.";
        return validateSingleFolderName(args) ?? true;
      },
      confirm: ({ args }) => {
        const name = args.trim();
        return validateSingleFolderName(name) ? null : {
          title: "Create folder",
          message: `Create folder "${name}" in the workspace root?`,
          confirmLabel: "Create folder",
        };
      },
      run: async ({ actions, args, chat, setStatus, close, showFeedback }) => {
        const name = args.trim();
        const error = validateSingleFolderName(name);
        if (error) {
          setStatus(error);
          return;
        }
        await actions.onCreateDirectory?.(name);
        actions.onOpenFiles?.();
        chat.setInput("");
        showFeedback(`Folder "${name}" created.`);
        close();
      },
    },
    {
      id: "write",
      aliases: ["write"],
      title: "Draft file change",
      description: "Ask for a file update draft.",
      category: "Workspace",
      mode: "prompt",
      Icon: FileText,
      run: sendPrompt((args) => args ? `Draft an update for ${args}. Explain the change before writing it.` : "Draft a workspace file change. Explain the target file and the change before writing it."),
    },
    {
      id: "diff",
      aliases: ["diff"],
      title: "Review diff",
      description: "Ask for a workspace diff review.",
      category: "Workspace",
      mode: "prompt",
      Icon: Wrench,
      run: sendPrompt(PROMPTS.diff),
    },
    {
      id: "config",
      aliases: ["config", "settings"],
      title: "Agent settings",
      description: "Open OpenClaw settings.",
      category: "Tools",
      mode: "ui",
      Icon: Settings,
      run: runAction(undefined, "Settings panel is unavailable here."),
    },
    {
      id: "tools",
      aliases: ["tools"],
      title: "Tools",
      description: "Open settings for tools and capabilities.",
      category: "Tools",
      mode: "ui",
      Icon: Wrench,
      run: runAction(undefined, "Tool settings are unavailable here."),
    },
    {
      id: "models",
      aliases: ["models"],
      title: "Models",
      description: "Show available model options.",
      category: "Tools",
      mode: "ui",
      Icon: Zap,
      run: ({ chat, setStatus }) => {
        const modelOptions = normalizeOpenClawModelOptions(chat.config, chat.models);
        setStatus(modelOptions.length > 0 ? `${modelOptions.length} models available. Use /model <id> to switch.` : "No model options are loaded yet.");
      },
    },
    {
      id: "model",
      aliases: ["model"],
      title: "Set model",
      description: "Switch the default model.",
      category: "Tools",
      mode: "confirm",
      Icon: Zap,
      requiresRunningAgent: true,
      isEnabled: ({ chat }) => chat.connected ? true : "Connect the gateway before changing models.",
      confirm: ({ args, chat }) => {
        const resolved = resolveRequestedModel(chat, args);
        return resolved.modelValue ? {
          title: "Set default model",
          message: `Set default model to ${resolved.modelValue}?`,
          confirmLabel: "Set model",
        } : null;
      },
      run: async ({ args, chat, setStatus, close, showFeedback }) => {
        const resolved = resolveRequestedModel(chat, args);
        if (!resolved.modelValue) {
          setStatus(resolved.status ?? "Model is unavailable.");
          return;
        }
        const modelValue = resolved.modelValue;
        await chat.saveConfig(buildOpenClawDefaultModelPatch(modelValue));
        chat.setInput("");
        setStatus(`Default model set to ${modelValue}.`);
        showFeedback(`Default model set to ${modelValue}.`);
        close();
      },
    },
    {
      id: "skills",
      aliases: ["skills"],
      title: "Skills",
      description: "Open the skill browser.",
      category: "Skills",
      mode: "ui",
      Icon: Sparkles,
      run: runAction(undefined, "Skills browser is unavailable here."),
    },
    {
      id: "skill",
      aliases: ["skill"],
      title: "Skill command",
      description: "Search, inspect, or install a catalog skill.",
      category: "Skills",
      mode: "confirm",
      Icon: Sparkles,
      isEnabled: ({ actions, args, chat }) => {
        const parsed = parseSkillCommandArgs(args);
        if (parsed.action === "open") return actions.onOpenSkills ? true : "Skills browser is unavailable here.";
        if (!chat.connected) return "Connect the gateway before managing skills.";
        if (!chat.skillsProvider) return "Skills are unavailable for this agent.";
        if (parsed.action === "search" && !parsed.value) return "Pass a search query, for example /skill search code review.";
        if (parsed.action === "search" && !chat.skillsProvider.capabilities.searchRegistry) return "Skill catalog search is unavailable for this agent.";
        if (parsed.action === "install" && !parsed.value) return "Pass a catalog skill ID, for example /skill install code-review.";
        if (parsed.action === "install" && !chat.skillsProvider.capabilities.installRegistry) return "Catalog installation is unavailable for this agent.";
        return true;
      },
      confirm: ({ args }) => {
        const parsed = parseSkillCommandArgs(args);
        if (parsed.action !== "install" || !parsed.value) return null;
        return {
          title: "Install skill",
          message: `Install ${parsed.value} from the skill catalog? This can add files and tools to the agent.`,
          confirmLabel: "Install",
        };
      },
      run: async ({ actions, args, chat, setStatus, close, showFeedback }) => {
        const parsed = parseSkillCommandArgs(args);
        if (parsed.action === "open") {
          actions.onOpenSkills?.();
          chat.setInput("");
          showFeedback("Skills opened.");
          close();
          return;
        }

        if (parsed.action === "status") {
          const skills = await chat.skillsProvider.list();
          setStatus(formatSkillsStatus(skills));
          showFeedback("Skill status loaded.");
          return;
        }

        if (parsed.action === "search") {
          if (!chat.skillsProvider.search) throw new Error("Skill catalog search is unavailable for this agent.");
          const results = await chat.skillsProvider.search(parsed.value, 5);
          setStatus(formatSkillSearchStatus(results));
          showFeedback(`${results.length} skill${results.length === 1 ? "" : "s"} found.`);
          return;
        }

        if (!chat.skillsProvider.install) throw new Error("Skill installation is unavailable for this agent.");
        const result = await chat.skillsProvider.install({ source: "registry", id: parsed.value });
        if (!result.ok) throw new Error(result.message || `Could not install ${parsed.value}.`);
        await chat.skillsProvider.list().catch(() => undefined);
        chat.setInput("");
        showFeedback(result.message || `Installed ${result.skillId ?? parsed.value}.`);
        close();
      },
    },
    {
      id: "connect",
      aliases: ["connect"],
      title: "Connect integration",
      description: "Open integrations or connect supported services in chat.",
      category: "Connections",
      mode: "ui",
      Icon: Unplug,
      run: async (ctx) => {
        const { args, actions, chat, setStatus, showFeedback, close } = ctx;
        const requested = args.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const suggestion = requested
          ? getConnectCommandSuggestions(requested, chat.reportedChannels, 1)[0]
          : undefined;
        if (suggestion) {
          await openConnectionSuggestion(ctx, suggestion);
          return;
        }
        if (requested) {
          setStatus(`No in-chat connector is available for ${args.trim()}. Open integrations to check setup options.`);
          return;
        }
        if (!actions.onOpenIntegrations) {
          setStatus("Integrations are unavailable here.");
          return;
        }
        await actions.onOpenIntegrations();
        chat.setInput("");
        showFeedback("Integrations opened.");
        close();
      },
    },
    {
      id: "connections",
      aliases: ["connections"],
      title: "Connections",
      description: "Check integration connection status.",
      category: "Connections",
      mode: "ui",
      Icon: Unplug,
      requiresRunningAgent: true,
      isEnabled: ({ chat }) => chat.connected ? true : "Connect the gateway before checking connections.",
      run: async ({ chat, setStatus }) => {
        const data = await chat.channelsStatus(false);
        const channels = data.channels && typeof data.channels === "object" ? Object.keys(data.channels).length : 0;
        setStatus(`${channels} connection${channels === 1 ? "" : "s"} reported.`);
      },
    },
    {
      id: "probe",
      aliases: ["probe"],
      title: "Test connections",
      description: "Probe configured integrations.",
      category: "Connections",
      mode: "confirm",
      Icon: Check,
      requiresRunningAgent: true,
      isEnabled: ({ chat }) => chat.connected ? true : "Connect the gateway before probing connections.",
      confirm: () => ({
        title: "Test connections",
        message: "Test configured connections now?",
        confirmLabel: "Test",
      }),
      run: async ({ chat, setStatus, showFeedback }) => {
        const data = await chat.channelsStatus(true);
        const channels = data.channels && typeof data.channels === "object" ? Object.keys(data.channels).length : 0;
        setStatus(`Connection probe completed for ${channels} connection${channels === 1 ? "" : "s"}.`);
        showFeedback("Connection test completed.");
      },
    },
    {
      id: "schedule",
      aliases: ["schedule", "cron"],
      title: "Scheduled work",
      description: "Open scheduled work or draft a schedule prompt.",
      category: "Schedule",
      mode: "ui",
      Icon: CalendarClock,
      isEnabled: ({ actions }) => actions.onOpenScheduled ? true : "Scheduled work is unavailable here.",
      run: ({ actions, args, chat, setStatus, close, showFeedback }) => {
        if (!actions.onOpenScheduled) {
          setStatus("Scheduled work is unavailable here.");
          return;
        }
        const draft = args.trim();
        showFeedback(draft ? "Scheduled draft opened." : "Scheduled opened.");
        actions.onOpenScheduled(draft || undefined);
        chat.setInput("");
        close();
      },
    },
    {
      id: "run",
      aliases: ["run"],
      title: "Run scheduled job",
      description: "Run an existing scheduled job by id.",
      category: "Schedule",
      mode: "confirm",
      Icon: Play,
      requiresRunningAgent: true,
      isEnabled: ({ chat }) => chat.connected ? true : "Connect the gateway before running scheduled jobs.",
      confirm: ({ args }) => {
        const jobId = args.trim();
        return jobId ? {
          title: "Run scheduled job",
          message: `Run scheduled job ${jobId}?`,
          confirmLabel: "Run",
        } : null;
      },
      run: async ({ args, chat, setStatus, close, showFeedback }) => {
        const jobId = args.trim();
        if (!jobId) {
          setStatus("Pass a scheduled job id, for example /run job-1.");
          return;
        }
        await chat.runCron(jobId);
        await chat.refreshCron();
        chat.setInput("");
        showFeedback("Scheduled job run requested.");
        close();
      },
    },
    {
      id: "unschedule",
      aliases: ["unschedule"],
      title: "Remove scheduled job",
      description: "Remove an existing scheduled job by id.",
      category: "Schedule",
      mode: "confirm",
      Icon: Trash2,
      danger: true,
      requiresRunningAgent: true,
      isEnabled: ({ chat }) => chat.connected ? true : "Connect the gateway before removing scheduled jobs.",
      confirm: ({ args }) => {
        const jobId = args.trim();
        return jobId ? {
          title: "Remove scheduled job",
          message: `Remove scheduled job ${jobId}?`,
          confirmLabel: "Remove",
          danger: true,
        } : null;
      },
      run: async ({ args, chat, setStatus, close, showFeedback }) => {
        const jobId = args.trim();
        if (!jobId) {
          setStatus("Pass a scheduled job id, for example /unschedule job-1.");
          return;
        }
        await chat.removeCron(jobId);
        chat.setInput("");
        showFeedback("Scheduled job removed.");
        close();
      },
    },
    {
      id: "activity",
      aliases: ["activity"],
      title: "Activity",
      description: "Open recent activity when available.",
      category: "Diagnostics",
      mode: "ui",
      Icon: Activity,
      run: runAction(undefined, "Activity panel is unavailable here."),
    },
    {
      id: "sessions",
      aliases: ["sessions"],
      title: "Sessions",
      description: "Refresh sessions and show the count.",
      category: "Diagnostics",
      mode: "ui",
      Icon: ListTree,
      requiresRunningAgent: true,
      isEnabled: ({ chat }) => chat.connected ? true : "Connect the gateway before refreshing sessions.",
      run: async ({ chat, setStatus }) => {
        const sessions = await chat.refreshSessions().catch(() => undefined);
        setStatus(`${formatSessionCount(refreshedSessionCount(sessions, chat.sessions))} loaded.`);
      },
    },
    {
      id: "logs",
      aliases: ["logs"],
      title: "Logs",
      description: "Open runtime logs.",
      category: "Diagnostics",
      mode: "ui",
      Icon: FileText,
      run: runAction(undefined, "Logs panel is unavailable here."),
    },
    {
      id: "shell",
      aliases: ["shell", "terminal"],
      title: "Shell",
      description: "Open the shell panel.",
      category: "Diagnostics",
      mode: "ui",
      Icon: Shell,
      run: runAction(undefined, "Shell panel is unavailable here."),
    },
    {
      id: "refresh",
      aliases: ["refresh"],
      title: "Refresh",
      description: "Retry gateway and refresh session data.",
      category: "Diagnostics",
      mode: "ui",
      Icon: RefreshCw,
      run: async ({ chat, setStatus }) => {
        let sessions: Awaited<ReturnType<ChatSession["refreshSessions"]>> | undefined;
        if (typeof chat.retryAndRefreshSessions === "function") {
          sessions = await chat.retryAndRefreshSessions().catch(() => undefined);
        } else {
          chat.retry();
          const [refreshedSessions] = await Promise.all([
            chat.refreshSessions().catch(() => undefined),
            chat.refreshCron().catch(() => undefined),
          ] as const);
          sessions = refreshedSessions;
        }
        setStatus(`Refresh complete. ${formatSessionCount(refreshedSessionCount(sessions, chat.sessions))} loaded.`);
      },
    },
    {
      id: "plan",
      aliases: ["plan"],
      title: "Current plan",
      description: "Open the plan catalog.",
      category: "Account",
      mode: "ui",
      Icon: CreditCard,
      run: runAction(undefined, "Plan catalog is unavailable here."),
    },
    {
      id: "plans",
      aliases: ["plans"],
      title: "Plans",
      description: "Open the plan catalog.",
      category: "Account",
      mode: "ui",
      Icon: CreditCard,
      run: runAction(undefined, "Plan catalog is unavailable here."),
    },
    {
      id: "billing",
      aliases: ["billing"],
      title: "Billing",
      description: "Open billing.",
      category: "Account",
      mode: "ui",
      Icon: CreditCard,
      run: runAction(undefined, "Billing is unavailable here."),
    },
    ...([
      ["fix", "Fix issue", PROMPTS.fix, Wrench],
      ["test", "Run checks", PROMPTS.test, Check],
      ["ship", "Prepare handoff", PROMPTS.ship, Zap],
      ["explain", "Explain", PROMPTS.explain, HelpCircle],
      ["todo", "Extract tasks", PROMPTS.todo, ListTree],
      ["handoff", "Handoff", PROMPTS.handoff, FileText],
    ] as const).map(([id, title, prompt, Icon]) => ({
      id,
      aliases: [id],
      title,
      description: "Send this helper prompt.",
      category: "Chat" as const,
      mode: "prompt" as const,
      Icon,
      run: sendPrompt(prompt),
    })),
  ];
}

function bindAction(command: SlashCommand, actions: AgentSlashCommandActions): SlashCommand {
  const actionByCommand: Partial<Record<string, (() => void | Promise<void>) | undefined>> = {
    new: actions.onNewConversation,
    "new-agent": actions.onNewAgent,
    files: actions.onOpenFiles,
    upload: actions.onTriggerFilePicker,
    config: actions.onOpenConfig,
    tools: actions.onOpenConfig,
    skills: actions.onOpenSkills,
    activity: actions.onOpenActivity,
    logs: actions.onOpenLogs,
    shell: actions.onOpenShell,
    plan: actions.onOpenPlans,
    plans: actions.onOpenPlans,
    billing: actions.onOpenBilling,
  };

  const action = actionByCommand[command.id];
  if (!Object.prototype.hasOwnProperty.call(actionByCommand, command.id)) return command;
  return {
    ...command,
    isEnabled: command.isEnabled ?? (() => action ? true : `${command.title} is unavailable here.`),
    run: runAction(action, `${command.title} is unavailable here.`, `${command.title} opened.`),
  };
}

function modeLabel(mode: SlashCommandMode): string {
  if (mode === "confirm") return "Confirm";
  if (mode === "prompt") return "Send";
  return "Open";
}

export const AgentSlashCommandMenu = forwardRef<AgentSlashCommandMenuHandle, AgentSlashCommandMenuProps>(
  function AgentSlashCommandMenu({
    chat,
    input,
    selectedAgentName,
    isSelectedRunning,
    actions = {},
    onFeedback,
  }, ref) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [status, setStatus] = useState("");
    const [busyCommandId, setBusyCommandId] = useState<string | null>(null);
    const [pendingConfirmation, setPendingConfirmation] = useState<{
      command: SlashCommand;
      args: string;
      copy: SlashCommandConfirmation;
    } | null>(null);
    const [confirmLoading, setConfirmLoading] = useState(false);
    const optionRefs = React.useRef(new Map<string, HTMLButtonElement>());
    const showFeedback = React.useCallback((message: string) => {
      onFeedback?.(message);
    }, [onFeedback]);

    const allCommands = useMemo(
      () => buildSlashCommands().map((command) => bindAction(command, actions)),
      [actions],
    );
    const activeInput = slashInput(input);
    const { token, args } = activeInput ? commandParts(activeInput) : { token: "", args: "" };
    const connectQuery = connectSuggestionQuery(activeInput);
    const connectSuggestionMode = connectQuery !== null;
    const isVisible = Boolean(activeInput);
    const connectSuggestions = useMemo(() => (
      connectSuggestionMode
        ? getConnectCommandSuggestions(connectQuery ?? "", chat.reportedChannels)
        : []
    ), [chat.reportedChannels, connectQuery, connectSuggestionMode]);

    const matchingCommands = useMemo(() => {
      if (!isVisible) return [];
      const query = token.trim();
      const filtered = allCommands.filter((command) => {
        if (!query) return true;
        return (
          command.aliases.some((alias) => alias.includes(query)) ||
          command.title.toLowerCase().includes(query) ||
          command.category.toLowerCase().includes(query)
        );
      });
      return filtered.length > 0 ? filtered : allCommands.filter((command) => command.id === "menu");
    }, [allCommands, isVisible, token]);

    React.useEffect(() => {
      setSelectedIndex(0);
      setStatus("");
    }, [connectQuery, token]);

    const selectedCommandId = matchingCommands[selectedIndex]?.id;
    const selectedConnectIndex = Math.min(selectedIndex, Math.max(0, connectSuggestions.length - 1));
    const selectedConnectSuggestion = connectSuggestions[selectedConnectIndex];
    React.useEffect(() => {
      if (!isVisible) return;
      const selectedOption = optionRefs.current.get(
        connectSuggestionMode && selectedConnectSuggestion
          ? `connect:${selectedConnectSuggestion.id}`
          : selectedCommandId ?? "",
      );
      if (typeof selectedOption?.scrollIntoView !== "function") return;
      selectedOption.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }, [connectSuggestionMode, isVisible, selectedCommandId, selectedConnectSuggestion]);

    const close = React.useCallback(() => {
      setSelectedIndex(0);
      setStatus("");
      setPendingConfirmation(null);
    }, []);

    const contextFor = React.useCallback((commandArgs: string): SlashCommandContext => ({
      chat,
      args: commandArgs,
      actions,
      selectedAgentName,
      isSelectedRunning,
      setStatus,
      showFeedback,
      close,
    }), [actions, chat, close, isSelectedRunning, selectedAgentName, showFeedback]);

    const disabledReason = React.useCallback((command: SlashCommand): string | null => {
      if (command.requiresRunningAgent && !isSelectedRunning) return "Start the agent first.";
      const enabled = command.isEnabled?.(contextFor(args)) ?? true;
      return enabled === true ? null : enabled;
    }, [args, contextFor, isSelectedRunning]);

    const runCommand = React.useCallback(async (command: SlashCommand, commandArgs: string) => {
      setBusyCommandId(command.id);
      try {
        await command.run(contextFor(commandArgs));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Command failed.");
      } finally {
        setBusyCommandId(null);
      }
      return true;
    }, [contextFor]);

    const executeConnectSuggestion = React.useCallback(async (suggestion: ChatConnectionSuggestion | undefined) => {
      if (busyCommandId) return false;
      if (!suggestion) {
        setStatus(connectQuery?.trim() ? `No available integrations match "${connectQuery.trim()}".` : "No integrations are available here.");
        return false;
      }
      setBusyCommandId(`connect:${suggestion.id}`);
      try {
        await openConnectionSuggestion(contextFor(connectQuery ?? ""), suggestion);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Connection failed.");
      } finally {
        setBusyCommandId(null);
      }
      return true;
    }, [busyCommandId, connectQuery, contextFor]);

    const execute = React.useCallback(async (command: SlashCommand, commandArgs: string) => {
      if (busyCommandId) return false;
      const reason = disabledReason(command);
      if (reason) {
        setStatus(reason);
        return false;
      }

      const confirmation = command.confirm?.(contextFor(commandArgs)) ?? null;
      if (confirmation) {
        setPendingConfirmation({ command, args: commandArgs, copy: confirmation });
        return true;
      }

      return runCommand(command, commandArgs);
    }, [busyCommandId, contextFor, disabledReason, runCommand]);

    const selectedCommand = matchingCommands[Math.min(selectedIndex, Math.max(0, matchingCommands.length - 1))];

    const confirmPendingCommand = React.useCallback(async () => {
      if (!pendingConfirmation || confirmLoading) return;
      setConfirmLoading(true);
      try {
        await runCommand(pendingConfirmation.command, pendingConfirmation.args);
        setPendingConfirmation(null);
      } finally {
        setConfirmLoading(false);
      }
    }, [confirmLoading, pendingConfirmation, runCommand]);

    useImperativeHandle(ref, () => ({
      canHandleInput: () => Boolean(slashInput(input)),
      executeCurrentInput: async () => {
        const currentInput = slashInput(input);
        if (!currentInput) return false;
        if (connectSuggestionMode) {
          return executeConnectSuggestion(selectedConnectSuggestion);
        }
        const parts = commandParts(currentInput);
        const exact = allCommands.find((command) => command.aliases.includes(parts.token));
        return execute(exact ?? selectedCommand ?? allCommands[0], parts.args);
      },
      moveSelection: (delta: number) => {
        if (connectSuggestionMode) {
          if (connectSuggestions.length === 0) return;
          setSelectedIndex((current) => (current + delta + connectSuggestions.length) % connectSuggestions.length);
          return;
        }
        if (matchingCommands.length === 0) return;
        setSelectedIndex((current) => (current + delta + matchingCommands.length) % matchingCommands.length);
      },
      selectFirst: () => setSelectedIndex(0),
      selectLast: () => setSelectedIndex(Math.max(0, (connectSuggestionMode ? connectSuggestions.length : matchingCommands.length) - 1)),
      completeSelection: () => {
        if (connectSuggestionMode) {
          void executeConnectSuggestion(selectedConnectSuggestion);
          return Boolean(selectedConnectSuggestion);
        }
        if (!selectedCommand) return false;
        chat.setInput(`/${selectedCommand.aliases[0]} `);
        setStatus("");
        return true;
      },
      close,
    }), [allCommands, chat, close, connectSuggestionMode, connectSuggestions.length, execute, executeConnectSuggestion, input, matchingCommands.length, selectedCommand, selectedConnectSuggestion]);

    if (!isVisible && !pendingConfirmation) return null;

    return (
      <>
        {isVisible ? (
          <div
            className="absolute bottom-full left-0 right-0 z-40 mb-2 max-h-[min(22rem,calc(100vh-10rem))] overflow-hidden rounded-lg border border-border bg-background/98 shadow-2xl backdrop-blur"
            role="listbox"
            aria-label={connectSuggestionMode ? "Connect integration suggestions" : "Slash command menu"}
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-text-muted">
              {connectSuggestionMode ? <Unplug className="h-3.5 w-3.5 shrink-0" /> : <Search className="h-3.5 w-3.5 shrink-0" />}
              <span className="min-w-0 flex-1 truncate text-xs">
                {connectSuggestionMode ? (connectQuery?.trim() ? `/connect ${connectQuery}` : "Connect integration") : token ? `/${token}` : "Commands"}
              </span>
              {busyCommandId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            </div>

            <div className="max-h-[min(18rem,calc(100vh-14rem))] overflow-y-auto p-1.5">
              {connectSuggestionMode ? (
                connectSuggestions.length > 0 ? connectSuggestions.map((suggestion, index) => {
                  const Icon = suggestion.Icon;
                  const selected = index === selectedConnectIndex;
                  return (
                    <button
                      key={suggestion.id}
                      ref={(node) => {
                        const key = `connect:${suggestion.id}`;
                        if (node) {
                          optionRefs.current.set(key, node);
                        } else {
                          optionRefs.current.delete(key);
                        }
                      }}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={Boolean(busyCommandId)}
                      title={suggestion.description}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => {
                        void executeConnectSuggestion(suggestion);
                      }}
                      className={`flex w-full min-w-0 items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                        selected ? "bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-foreground" : "text-text-secondary hover:bg-surface-high"
                      }`}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--selection-accent)]" style={suggestion.iconColor ? { color: suggestion.iconColor } : undefined} />
                      <span className="min-w-0 flex-1 space-y-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 text-xs font-medium leading-4 text-foreground">{suggestion.displayName}</span>
                          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
                            Connect
                          </span>
                        </span>
                        <span className="block text-[11px] leading-4 text-text-muted">
                          {suggestion.description}
                        </span>
                      </span>
                      <span className="hidden shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[10px] leading-4 text-text-muted md:inline-flex">{suggestion.category}</span>
                    </button>
                  );
                }) : (
                  <div className="px-3 py-3 text-xs leading-4 text-text-muted">
                    {connectQuery?.trim() ? `No available integrations match "${connectQuery.trim()}".` : "No integrations are available here."}
                  </div>
                )
              ) : matchingCommands.map((command, index) => {
                const Icon = command.Icon;
                const reason = disabledReason(command);
                const selected = index === selectedIndex;
                return (
                  <button
                    key={command.id}
                    ref={(node) => {
                      if (node) {
                        optionRefs.current.set(command.id, node);
                      } else {
                        optionRefs.current.delete(command.id);
                      }
                    }}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-disabled={Boolean(reason) || undefined}
                    disabled={Boolean(busyCommandId)}
                    title={reason || command.description}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => {
                      void execute(command, args);
                    }}
                    className={`flex w-full min-w-0 items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                      selected ? "bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-foreground" : "text-text-secondary hover:bg-surface-high"
                    } ${reason ? "opacity-50" : ""}`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${command.danger ? "text-destructive" : "text-[var(--selection-accent)]"}`} />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-[12px] font-semibold leading-4">/{command.aliases[0]}</span>
                        <span className="min-w-0 text-xs font-medium leading-4 text-foreground">{command.title}</span>
                        <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-text-muted">
                          {modeLabel(command.mode)}
                        </span>
                      </span>
                      <span className="block text-[11px] leading-4 text-text-muted">
                        {reason || command.description}
                      </span>
                    </span>
                    <span className="hidden shrink-0 rounded border border-border/70 px-1.5 py-0.5 text-[10px] leading-4 text-text-muted md:inline-flex">{command.category}</span>
                  </button>
                );
              })}
            </div>

            {status ? (
              <div className="break-words border-t border-border px-3 py-2 text-xs leading-4 text-text-secondary">
                {status}
              </div>
            ) : null}
          </div>
        ) : null}
        <ConfirmDialog
          open={Boolean(pendingConfirmation)}
          title={pendingConfirmation?.copy.title ?? ""}
          message={pendingConfirmation?.copy.message ?? ""}
          confirmLabel={pendingConfirmation?.copy.confirmLabel}
          danger={pendingConfirmation?.copy.danger}
          loading={confirmLoading}
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={() => {
            void confirmPendingCommand();
          }}
        />
      </>
    );
  },
);
