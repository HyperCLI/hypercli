"use client";

import React, { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CalendarClock,
  Check,
  CreditCard,
  FileText,
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
  Square,
  Trash2,
  Unplug,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { ConfirmDialog } from "@/components/dashboard/ConfirmDialog";
import type { useOpenClawSession } from "@/hooks/useOpenClawSession";
import { buildOpenClawDefaultModelPatch, normalizeOpenClawModelOptions } from "@/lib/openclaw-models";

type ChatSession = ReturnType<typeof useOpenClawSession>;
type SlashCommandMode = "ui" | "prompt" | "confirm";
type SlashCommandCategory = "Chat" | "Agent" | "Workspace" | "Tools" | "Connections" | "Schedule" | "Diagnostics" | "Account";

export interface AgentSlashCommandActions {
  onOpenFiles?: (path?: string) => void;
  onOpenConfig?: () => void;
  onOpenIntegrations?: () => void;
  onOpenScheduled?: () => void;
  onOpenLogs?: () => void;
  onOpenShell?: () => void;
  onOpenPlans?: () => void | Promise<void>;
  onOpenBilling?: () => void;
  onOpenActivity?: () => void;
  onStartAgent?: () => void | Promise<void>;
  onStopAgent?: () => void | Promise<void>;
  onNewAgent?: () => void;
  onRenameAgent?: (name: string) => void | Promise<void>;
  onOpenAgentSettings?: () => void;
  onTriggerFilePicker?: () => void;
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
  summary: "Summarize this conversation so far with decisions, open tasks, and next actions.",
  retry: "Retry your last answer. Keep the same goal, but correct any errors.",
  fix: "Inspect the current issue, identify the likely cause, and propose the smallest safe fix.",
  test: "Run the relevant checks for this workspace and summarize the results.",
  ship: "Prepare a handoff: what changed, checks run, risks, and next steps.",
  explain: "Explain the current workspace or selected file in plain language.",
  todo: "Extract open tasks from this conversation and group them by priority.",
  handoff: "Create a concise handoff for another operator continuing this work.",
  diff: "Review workspace changes and summarize the diff.",
};
const SCHEDULE_COMMANDS_DISABLED_REASON = "Scheduled work is coming soon.";

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

function sendPrompt(prompt: string | ((args: string) => string)): SlashCommand["run"] {
  return async ({ args, chat, close, showFeedback }) => {
    const message = typeof prompt === "function" ? prompt(args) : promptWithContext(prompt, args);
    chat.setInput("");
    if (chat.sending) {
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
      title: "New conversation",
      description: "Start a fresh main conversation when session reset is exposed.",
      category: "Chat",
      mode: "confirm",
      Icon: MessageSquarePlus,
      run: ({ setStatus }) => setStatus("New conversations need the gateway session reset helper exposed first."),
    },
    {
      id: "abort",
      aliases: ["abort", "cancel"],
      title: "Stop reply",
      description: "Abort the current assistant reply when gateway abort is exposed.",
      category: "Chat",
      mode: "ui",
      Icon: Square,
      run: ({ setStatus }) => setStatus("Stopping replies needs the gateway abort helper exposed first."),
    },
    {
      id: "summary",
      aliases: ["summary", "summarize"],
      title: "Summarize chat",
      description: "Ask for a conversation summary.",
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
      id: "connect",
      aliases: ["connect"],
      title: "Connect integration",
      description: "Open integrations.",
      category: "Connections",
      mode: "ui",
      Icon: Unplug,
      run: runAction(undefined, "Integrations are unavailable here."),
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
      isEnabled: () => SCHEDULE_COMMANDS_DISABLED_REASON,
      run: ({ actions, args, chat, setStatus, close }) => {
        if (args) {
          chat.setInput(`Create a scheduled task for this agent: ${args}. Ask me to confirm the schedule before saving it.`);
          close();
          return;
        }
        if (!actions.onOpenScheduled) {
          setStatus("Scheduled work is unavailable here.");
          return;
        }
        actions.onOpenScheduled();
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
      isEnabled: () => SCHEDULE_COMMANDS_DISABLED_REASON,
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
      isEnabled: () => SCHEDULE_COMMANDS_DISABLED_REASON,
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
        await chat.refreshSessions();
        setStatus(`${chat.sessions.length} session${chat.sessions.length === 1 ? "" : "s"} loaded.`);
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
        chat.retry();
        await Promise.allSettled([chat.refreshSessions(), chat.refreshCron()]);
        setStatus("Refresh requested.");
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
    "new-agent": actions.onNewAgent,
    files: actions.onOpenFiles,
    upload: actions.onTriggerFilePicker,
    config: actions.onOpenConfig,
    tools: actions.onOpenConfig,
    connect: actions.onOpenIntegrations,
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
    const isVisible = Boolean(activeInput);

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
    }, [token]);

    const selectedCommandId = matchingCommands[selectedIndex]?.id;
    React.useEffect(() => {
      if (!isVisible || !selectedCommandId) return;
      const selectedOption = optionRefs.current.get(selectedCommandId);
      if (typeof selectedOption?.scrollIntoView !== "function") return;
      selectedOption.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }, [isVisible, selectedCommandId]);

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
        const parts = commandParts(currentInput);
        const exact = allCommands.find((command) => command.aliases.includes(parts.token));
        return execute(exact ?? selectedCommand ?? allCommands[0], parts.args);
      },
      moveSelection: (delta: number) => {
        if (matchingCommands.length === 0) return;
        setSelectedIndex((current) => (current + delta + matchingCommands.length) % matchingCommands.length);
      },
      selectFirst: () => setSelectedIndex(0),
      selectLast: () => setSelectedIndex(Math.max(0, matchingCommands.length - 1)),
      completeSelection: () => {
        if (!selectedCommand) return false;
        chat.setInput(`/${selectedCommand.aliases[0]} `);
        setStatus("");
        return true;
      },
      close,
    }), [allCommands, chat, close, execute, input, matchingCommands.length, selectedCommand]);

    if (!isVisible && !pendingConfirmation) return null;

    return (
      <>
        {isVisible ? (
          <div
            className="absolute bottom-full left-0 right-0 z-40 mb-2 max-h-[min(22rem,calc(100vh-10rem))] overflow-hidden rounded-lg border border-border bg-background/98 shadow-2xl backdrop-blur"
            role="listbox"
            aria-label="Slash command menu"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-text-muted">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-xs">
                {token ? `/${token}` : "Commands"}
              </span>
              {busyCommandId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            </div>

            <div className="max-h-[min(18rem,calc(100vh-14rem))] overflow-y-auto p-1.5">
              {matchingCommands.map((command, index) => {
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
                      selected ? "bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-foreground" : "text-text-secondary hover:bg-white/[0.04]"
                    } ${reason ? "opacity-50" : ""}`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${command.danger ? "text-[#d05f5f]" : "text-[var(--selection-accent)]"}`} />
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
