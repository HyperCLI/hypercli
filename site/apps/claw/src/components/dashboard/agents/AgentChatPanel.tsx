"use client";

import React from "react";
import { ArrowRight, FileText, Loader2, Mic, Paperclip, Pause, Play, Send, Sparkles, Square, X } from "lucide-react";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { extractVoicePathFromMessage, OPENCLAW_WORKSPACE_DIR } from "@/lib/openclaw-config";
import type { ChatPendingFile } from "@/lib/openclaw-chat";
import { extractGitHubAgentSetupStatus, GITHUB_AGENT_SETUP_PROMPT, GITHUB_AGENT_VERIFY_PROMPT, shouldHideGitHubAgentSetupMessage } from "@/lib/github-cli-workspace";
import { shouldHideTelegramAgentConfigMessage } from "@/lib/telegram-config-workspace";
import { ChatMessageBubble, ChatThinkingIndicator } from "@/components/dashboard/ChatMessage";
import type { Agent } from "@/app/dashboard/agents/types";
import type { useOpenClawSession } from "@/hooks/useOpenClawSession";
import { AgentLoadingState } from "@/components/dashboard/agents/page-helpers";
import { AgentEmptyHistory } from "@/components/dashboard/agents/AgentEmptyHistory";
import { JourneyIntroPanel, type JourneyIntroPanelProps } from "@/components/dashboard/journey/JourneyIntroPanel";
import { JourneyMissionChatCard, type JourneyMissionChatCardProps } from "@/components/dashboard/journey/JourneyMissionChatCard";
import { getChatConnectorSuggestion, getConnectionSuggestions, type ChatConnectionSuggestion } from "@/components/dashboard/agents/AgentChatConnectionSuggestions";
import { IntegrationChatCardHost } from "@/components/dashboard/chat-integrations/IntegrationChatCardHost";
import { parseClawUiActionBlocks, type ClawIntegrationConnectAction, type ClawUiAction } from "@/components/dashboard/chat-integrations/claw-ui-actions";
import {
  AgentSlashCommandMenu,
  type AgentSlashCommandActions,
  type AgentSlashCommandMenuHandle,
} from "@/components/dashboard/agents/AgentSlashCommandMenu";
import { ResourceImage } from "@/components/ResourceImage";
import {
  getAgentChatBootStatus,
  stabilizeAgentChatBootStatus,
  type AgentChatBootStatus,
} from "@/components/dashboard/agents/chat-boot-stage";

export type { ChatConnectionSuggestion } from "@/components/dashboard/agents/AgentChatConnectionSuggestions";

type ChatSession = ReturnType<typeof useOpenClawSession>;
const CHAT_READY_SETTLE_MS = 180;
const AUDIO_BAR_WEIGHTS = [
  0.62,
  0.78,
  0.94,
  0.7,
  0.86,
  1,
  0.74,
  0.9,
  0.66,
  0.82,
  0.98,
  0.76,
  0.92,
  0.68,
  0.84,
  0.96,
  0.72,
  0.88,
  0.64,
  0.8,
] as const;

const FILE_TYPE_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  md: "text/markdown",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "audio/webm",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

interface ActiveFileMention {
  start: number;
  end: number;
  query: string;
}

interface FileReferenceSuggestion {
  file: ChatPendingFile;
  displayPath: string;
}

type FileReferenceCandidate = ChatSession["files"][number] | ChatPendingFile;

function getActiveFileMention(input: string, caretIndex: number | null): ActiveFileMention | null {
  const cursor = Math.max(0, Math.min(caretIndex ?? input.length, input.length));
  const beforeCaret = input.slice(0, cursor);
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);
  if (!match || match.index === undefined) return null;
  const prefix = match[1] ?? "";
  return {
    start: match.index + prefix.length,
    end: cursor,
    query: match[2] ?? "",
  };
}

function inferReferenceFileType(path: string): string {
  const extension = path.split(/[?#]/)[0].split("/").filter(Boolean).pop()?.split(".").pop()?.toLowerCase() ?? "";
  return FILE_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function normalizeReferenceRelativePath(path: string): string {
  const normalized = normalizeOpenClawWorkspaceFilePath(path);
  const workspacePrefix = ".openclaw/workspace";
  if (normalized === workspacePrefix) return "";
  return normalized.startsWith(`${workspacePrefix}/`) ? normalized.slice(workspacePrefix.length + 1) : normalized;
}

function buildFileReferenceSuggestions(files: FileReferenceCandidate[]): FileReferenceSuggestion[] {
  const seenPaths = new Set<string>();
  return files
    .filter((file) => {
      if (!file || typeof file.name !== "string" || !file.name.trim()) return false;
      return !("missing" in file && file.missing);
    })
    .map((file) => {
      const candidatePath = "path" in file && typeof file.path === "string" && file.path.trim()
        ? file.path.trim()
        : file.name.trim();
      const displayPath = normalizeReferenceRelativePath(candidatePath);
      const name = displayPath.split("/").filter(Boolean).pop() || file.name.trim();
      const path = displayPath ? `${OPENCLAW_WORKSPACE_DIR}/${displayPath}` : OPENCLAW_WORKSPACE_DIR;
      const candidateType = "type" in file && typeof file.type === "string" && file.type.includes("/")
        ? file.type
        : undefined;
      return {
        file: { name, path, type: candidateType ?? inferReferenceFileType(displayPath || name) },
        displayPath: displayPath || name,
      };
    })
    .filter((suggestion) => {
      if (!suggestion.displayPath || seenPaths.has(suggestion.file.path)) return false;
      seenPaths.add(suggestion.file.path);
      return true;
    })
    .sort((a, b) => a.displayPath.localeCompare(b.displayPath));
}

function fileReferenceRank(suggestion: FileReferenceSuggestion, query: string): number | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;
  const name = suggestion.file.name.toLowerCase();
  const path = suggestion.displayPath.toLowerCase();
  if (name.startsWith(normalizedQuery)) return 0;
  if (path.startsWith(normalizedQuery)) return 1;
  if (name.includes(normalizedQuery)) return 2;
  if (path.includes(normalizedQuery)) return 3;
  return null;
}

function removeFileMentionToken(input: string, mention: ActiveFileMention): string {
  const before = input.slice(0, mention.start);
  const after = input.slice(mention.end);
  if (before.endsWith(" ") && after.startsWith(" ")) return `${before}${after.trimStart()}`;
  if (before && after && !/\s$/.test(before) && !/^\s/.test(after)) return `${before} ${after}`;
  return `${before}${after}`;
}

function fileNameFromPath(path: string): string {
  return path.split(/[?#]/)[0].split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
}

function hasMatchingVoiceFile(files: ChatPendingFile[] | undefined, voicePath: string): boolean {
  const normalizedVoicePath = normalizeOpenClawWorkspaceFilePath(voicePath);
  const voiceFileName = fileNameFromPath(voicePath);
  return (files ?? []).some((file) => (
    normalizeOpenClawWorkspaceFilePath(file.path) === normalizedVoicePath ||
    Boolean(voiceFileName && file.name.toLowerCase() === voiceFileName)
  ));
}

function hasRenderableMessagePayload(message: ChatSession["messages"][number]): boolean {
  return Boolean(
    message.content.trim() ||
    (message.toolCalls?.length ?? 0) > 0 ||
    (message.mediaUrls?.length ?? 0) > 0 ||
    (message.attachments?.length ?? 0) > 0 ||
    (message.files?.length ?? 0) > 0
  );
}

function isIntegrationConnectAction(action: ClawUiAction): action is ClawIntegrationConnectAction {
  return action.type === "integration.connect";
}

function shouldHideIntegrationSetupMessage(message: ChatSession["messages"][number]): boolean {
  return shouldHideGitHubAgentSetupMessage(message) || shouldHideTelegramAgentConfigMessage(message);
}

function ChatEmptyStateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden text-text-muted">
      <div className="flex max-h-full min-h-0 w-full items-center justify-center overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

function StoppedChatEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-6 text-center text-text-muted">
      <Sparkles className="mb-2 h-8 w-8" />
      <p className="text-sm">Start the agent to begin chatting.</p>
    </div>
  );
}

function resizeComposer(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
}

function caretIsOnFirstLogicalLine(textarea: HTMLTextAreaElement): boolean {
  return !textarea.value.slice(0, textarea.selectionStart ?? 0).includes("\n");
}

function caretIsOnLastLogicalLine(textarea: HTMLTextAreaElement): boolean {
  return !textarea.value.slice(textarea.selectionEnd ?? 0).includes("\n");
}

function useSettledChatBootStatus(agentId: string, nextStatus: AgentChatBootStatus) {
  const [status, setStatus] = React.useState(nextStatus);
  const statusRef = React.useRef(nextStatus);
  const agentIdRef = React.useRef(agentId);

  const commitStatus = React.useCallback((value: AgentChatBootStatus) => {
    statusRef.current = value;
    setStatus(value);
  }, []);

  React.useEffect(() => {
    if (agentIdRef.current !== agentId) {
      agentIdRef.current = agentId;
      commitStatus(nextStatus);
      return;
    }

    if (nextStatus.status !== "ready") {
      commitStatus(stabilizeAgentChatBootStatus(statusRef.current, nextStatus));
      return;
    }

    if (statusRef.current.status !== "loading") {
      commitStatus(nextStatus);
      return;
    }

    const timeout = window.setTimeout(() => commitStatus(nextStatus), CHAT_READY_SETTLE_MS);
    return () => window.clearTimeout(timeout);
  }, [agentId, commitStatus, nextStatus]);

  return status;
}

interface AgentChatPanelProps {
  chat: ChatSession;
  selectedAgent: Agent;
  isSelectedRunning: boolean;
  chatDragActive: boolean;
  setChatDragActive: (active: boolean) => void;
  chatDragDepthRef: React.MutableRefObject<number>;
  handleChatFileDrop: (files: FileList) => Promise<void> | void;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
  handleChatScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  recording: boolean;
  audioLevel: number;
  recordingDuration: number;
  stopRecording: () => void;
  audioUrl: string | null;
  audioPreviewPlaying: boolean;
  audioPreviewDuration: number;
  toggleAudioPreviewPlayback: () => void;
  discardAudio: () => void;
  sendAudio: () => void;
  sendingAudio: boolean;
  startRecording: () => void;
  handleSendChat: () => void;
  formatDuration: (seconds: number) => string;
  onConnectionCta?: (suggestion: ChatConnectionSuggestion) => void;
  slashCommandActions?: AgentSlashCommandActions;
  onReadFileBytesFromChat?: (path: string) => Promise<Uint8Array>;
  onOpenFileFromChat?: (path: string) => void;
  onDownloadFileFromChat?: (file: ChatPendingFile) => void | Promise<void>;
  fileReferenceCandidates?: ChatPendingFile[];
  journeyIntro?: (JourneyIntroPanelProps & { enabled: boolean }) | null;
  journeyMissionCard?: (JourneyMissionChatCardProps & { enabled: boolean }) | null;
}

export function AgentChatPanel({
  chat,
  selectedAgent,
  isSelectedRunning,
  chatDragActive,
  setChatDragActive,
  chatDragDepthRef,
  handleChatFileDrop,
  chatScrollRef,
  handleChatScroll,
  chatEndRef,
  recording,
  audioLevel,
  recordingDuration,
  stopRecording,
  audioUrl,
  audioPreviewPlaying,
  audioPreviewDuration,
  toggleAudioPreviewPlayback,
  discardAudio,
  sendAudio,
  sendingAudio,
  startRecording,
  handleSendChat,
  formatDuration,
  onConnectionCta,
  slashCommandActions,
  onReadFileBytesFromChat,
  onOpenFileFromChat,
  onDownloadFileFromChat,
  fileReferenceCandidates = [],
  journeyIntro,
  journeyMissionCard,
}: AgentChatPanelProps) {
  const slashCommandMenuRef = React.useRef<AgentSlashCommandMenuHandle>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const slashFeedbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dismissedSlashInput, setDismissedSlashInput] = React.useState<string | null>(null);
  const [dismissedFileMentionInput, setDismissedFileMentionInput] = React.useState<string | null>(null);
  const [slashCommandFeedback, setSlashCommandFeedback] = React.useState("");
  const [activeIntegrationAction, setActiveIntegrationAction] = React.useState<ClawIntegrationConnectAction | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileMentionOptionRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const [composerSelectionStart, setComposerSelectionStart] = React.useState<number | null>(null);
  const [fileMentionSelectedIndex, setFileMentionSelectedIndex] = React.useState(0);
  const historyIndexRef = React.useRef<number | null>(null);
  const draftBeforeHistoryRef = React.useRef("");
  const pendingHistoryInputRef = React.useRef<string | null>(null);
  const connectionSuggestions = React.useMemo(
    () => getConnectionSuggestions(chat.input, chat.config, chat.configSchema),
    [chat.config, chat.configSchema, chat.input],
  );
  const openIntegrationChatCard = React.useCallback((integrationId: ClawIntegrationConnectAction["integrationId"]) => {
    setActiveIntegrationAction({ version: 1, type: "integration.connect", integrationId });
  }, []);
  const visibleChatMessages = React.useMemo(
    () => chat.messages
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => !shouldHideIntegrationSetupMessage(message)),
    [chat.messages],
  );
  const commandActions = React.useMemo<AgentSlashCommandActions>(() => ({
    ...slashCommandActions,
    onTriggerFilePicker: slashCommandActions?.onTriggerFilePicker ?? (() => fileInputRef.current?.click()),
    onOpenConnectionSuggestion: async (suggestion) => {
      if (suggestion.connectorId) {
        openIntegrationChatCard(suggestion.connectorId);
        return;
      }
      onConnectionCta?.(suggestion);
    },
    onOpenIntegrationChatCard: (integrationId) => {
      openIntegrationChatCard(integrationId);
    },
  }), [onConnectionCta, openIntegrationChatCard, slashCommandActions]);
  const slashInputActive = !recording && !audioUrl && chat.input.trimStart().startsWith("/") && !chat.input.trimStart().startsWith("//");
  const slashMenuDismissed = dismissedSlashInput === chat.input;
  const slashMenuOpen = slashInputActive && !slashMenuDismissed;
  const fileReferenceSuggestions = React.useMemo(
    () => buildFileReferenceSuggestions([...fileReferenceCandidates, ...chat.files, ...chat.pendingFiles]),
    [chat.files, chat.pendingFiles, fileReferenceCandidates],
  );
  const activeFileMention = React.useMemo(
    () => getActiveFileMention(chat.input, composerSelectionStart),
    [chat.input, composerSelectionStart],
  );
  const matchingFileReferences = React.useMemo(() => {
    if (!activeFileMention) return [];
    const ranked = fileReferenceSuggestions
      .map((suggestion) => ({ suggestion, rank: fileReferenceRank(suggestion, activeFileMention.query) }))
      .filter((entry): entry is { suggestion: FileReferenceSuggestion; rank: number } => entry.rank !== null)
      .sort((a, b) => a.rank - b.rank || a.suggestion.displayPath.localeCompare(b.suggestion.displayPath));
    return ranked.slice(0, 8).map((entry) => entry.suggestion);
  }, [activeFileMention, fileReferenceSuggestions]);
  const fileMentionMenuDismissed = dismissedFileMentionInput === chat.input;
  const fileMentionMenuOpen = !slashMenuOpen && Boolean(activeFileMention) && matchingFileReferences.length > 0 && !fileMentionMenuDismissed;
  React.useEffect(() => () => {
    if (slashFeedbackTimerRef.current) clearTimeout(slashFeedbackTimerRef.current);
  }, []);
  const clampedFileMentionSelectedIndex = Math.min(fileMentionSelectedIndex, Math.max(0, matchingFileReferences.length - 1));
  const selectedFileReference = matchingFileReferences[clampedFileMentionSelectedIndex];
  React.useEffect(() => {
    if (!fileMentionMenuOpen || !selectedFileReference) return;
    const selectedOption = fileMentionOptionRefs.current.get(selectedFileReference.file.path);
    if (typeof selectedOption?.scrollIntoView !== "function") return;
    selectedOption.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [fileMentionMenuOpen, selectedFileReference]);
  const handleSlashCommandFeedback = React.useCallback((message: string) => {
    setSlashCommandFeedback(message);
    if (slashFeedbackTimerRef.current) clearTimeout(slashFeedbackTimerRef.current);
    slashFeedbackTimerRef.current = setTimeout(() => {
      setSlashCommandFeedback("");
      slashFeedbackTimerRef.current = null;
    }, 2600);
  }, []);
  const setChatInput = chat.setInput;
  const syncComposerSelection = React.useCallback((textarea: HTMLTextAreaElement) => {
    setComposerSelectionStart(textarea.selectionStart ?? null);
  }, []);
  const completeFileReference = React.useCallback((suggestion: FileReferenceSuggestion | undefined = selectedFileReference) => {
    if (!suggestion || !activeFileMention) return false;
    if (!chat.pendingFiles.some((file) => file.path === suggestion.file.path)) {
      chat.addPendingFiles([suggestion.file]);
    }
    const nextInput = removeFileMentionToken(chat.input, activeFileMention);
    const nextCaret = activeFileMention.start;
    setChatInput(nextInput);
    setDismissedFileMentionInput(null);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const caret = Math.min(nextCaret, nextInput.length);
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      resizeComposer(textarea);
      setComposerSelectionStart(caret);
    });
    return true;
  }, [activeFileMention, chat, selectedFileReference, setChatInput]);
  const promptHistory = React.useMemo(() => {
    const history: string[] = [];
    for (const message of chat.messages) {
      if (shouldHideIntegrationSetupMessage(message)) continue;
      const content = message.role === "user" ? message.content.trim() : "";
      if (!content) continue;
      if (history[history.length - 1] !== content) history.push(content);
    }
    return history;
  }, [chat.messages]);
  const resetPromptHistoryNavigation = React.useCallback(() => {
    historyIndexRef.current = null;
    draftBeforeHistoryRef.current = "";
  }, []);
  const applyPromptHistoryInput = React.useCallback((value: string) => {
    pendingHistoryInputRef.current = value;
    setChatInput(value);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(value.length, value.length);
      resizeComposer(textarea);
    });
  }, [setChatInput]);
  const openFullIntegrationSetup = React.useCallback((integrationId: ClawIntegrationConnectAction["integrationId"]) => {
    if (integrationId === "telegram" && onConnectionCta) {
      onConnectionCta(getChatConnectorSuggestion("telegram"));
      return;
    }
    void slashCommandActions?.onOpenIntegrations?.();
  }, [onConnectionCta, slashCommandActions]);
  const githubAgentSetupStatus = React.useMemo(
    () => extractGitHubAgentSetupStatus(chat.messages),
    [chat.messages],
  );
  const startAgentGitHubSetup = React.useCallback(async () => {
    if (chat.activeSessionReadOnly) return;
    await chat.sendMessage(GITHUB_AGENT_SETUP_PROMPT, { displayContent: "Set up GitHub in this workspace." });
  }, [chat]);
  const verifyAgentGitHubSetup = React.useCallback(async () => {
    if (chat.sending || chat.activeSessionReadOnly) return;
    await chat.sendMessage(GITHUB_AGENT_VERIFY_PROMPT, { displayContent: "Check GitHub connection in this workspace." });
  }, [chat]);

  const handleConnectionSuggestionClick = React.useCallback((suggestion: ChatConnectionSuggestion) => {
    if (suggestion.connectorId) {
      openIntegrationChatCard(suggestion.connectorId);
      return;
    }
    onConnectionCta?.(suggestion);
  }, [onConnectionCta, openIntegrationChatCard]);
  React.useEffect(() => {
    if (!activeIntegrationAction) return;
    const frame = window.requestAnimationFrame(() => {
      if (typeof chatEndRef.current?.scrollIntoView !== "function") return;
      chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeIntegrationAction, chatEndRef]);
  React.useEffect(() => {
    resetPromptHistoryNavigation();
  }, [chat.activeSessionKey, promptHistory, resetPromptHistoryNavigation, selectedAgent.id]);
  React.useEffect(() => {
    if (pendingHistoryInputRef.current === chat.input) {
      pendingHistoryInputRef.current = null;
      return;
    }
    resetPromptHistoryNavigation();
  }, [chat.input, resetPromptHistoryNavigation]);
  const handlePromptHistoryKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (promptHistory.length === 0) return false;

    const textarea = event.currentTarget;
    if (event.key === "ArrowUp") {
      const currentIndex = historyIndexRef.current;
      if (currentIndex === null && !caretIsOnFirstLogicalLine(textarea)) return false;

      event.preventDefault();
      if (currentIndex === null) draftBeforeHistoryRef.current = chat.input;
      const nextIndex = currentIndex === null
        ? promptHistory.length - 1
        : Math.max(0, currentIndex - 1);
      historyIndexRef.current = nextIndex;
      applyPromptHistoryInput(promptHistory[nextIndex]);
      return true;
    }

    if (event.key === "ArrowDown") {
      const currentIndex = historyIndexRef.current;
      if (currentIndex === null || !caretIsOnLastLogicalLine(textarea)) return false;

      event.preventDefault();
      if (currentIndex < promptHistory.length - 1) {
        const nextIndex = currentIndex + 1;
        historyIndexRef.current = nextIndex;
        applyPromptHistoryInput(promptHistory[nextIndex]);
      } else {
        historyIndexRef.current = null;
        applyPromptHistoryInput(draftBeforeHistoryRef.current);
        draftBeforeHistoryRef.current = "";
      }
      return true;
    }

    return false;
  }, [applyPromptHistoryInput, chat.input, promptHistory]);
  const rawBootStatus = React.useMemo(
    () => getAgentChatBootStatus({
      agentState: selectedAgent.state,
      isSelectedRunning,
      gatewayConnected: chat.gatewayConnected,
      ready: chat.ready,
      connected: chat.connected,
      connecting: chat.connecting,
      hydrating: chat.hydrating,
      error: chat.error,
    }),
    [
      chat.connected,
      chat.connecting,
      chat.error,
      chat.gatewayConnected,
      chat.hydrating,
      chat.ready,
      isSelectedRunning,
      selectedAgent.state,
    ],
  );
  const bootStatus = useSettledChatBootStatus(selectedAgent.id, rawBootStatus);
  const displayBootStatus = bootStatus;
  const hasPendingAttachmentWork = chat.pendingAttachments.length > 0 || chat.pendingAttachmentReads > 0;
  const readOnlyComposerReason = chat.activeSessionReadOnlyReason ?? "This connected conversation is read-only here.";
  const canSendChatDraft =
    chat.connected &&
    !chat.activeSessionReadOnly &&
    chat.pendingAttachmentReads === 0 &&
    (chat.input.trim().length > 0 || chat.pendingAttachments.length > 0 || chat.pendingFiles.length > 0);
  const composerHasDraft =
    recording ||
    Boolean(audioUrl) ||
    chat.input.trim().length > 0 ||
    hasPendingAttachmentWork ||
    chat.pendingFiles.length > 0;
  const showComposer = displayBootStatus.status === "ready" || composerHasDraft;
  const composerDisabled = displayBootStatus.status !== "ready" || !chat.connected || chat.activeSessionReadOnly;
  const composerPlaceholder = chat.activeSessionReadOnly
    ? readOnlyComposerReason
    : chat.connected
      ? "Message agent..."
      : chat.connecting
        ? "Preparing chat..."
        : "Connect gateway to message...";
  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    resizeComposer(textarea);
  }, [audioUrl, chat.input, recording, showComposer]);
  const originDenied = displayBootStatus.status === "error" && /another dashboard address/i.test(displayBootStatus.detail);
  const errorActionLabel = originDenied && isSelectedRunning && slashCommandActions?.onStopAgent ? "Stop agent" : "Retry";
  const handleErrorAction = originDenied && isSelectedRunning && slashCommandActions?.onStopAgent
    ? () => { void slashCommandActions.onStopAgent?.(); }
    : chat.retry;
  const emptyChatContent = (() => {
    if (displayBootStatus.status === "loading") {
      return (
        <AgentLoadingState
          bootStatus={displayBootStatus}
        />
      );
    }

    if (displayBootStatus.status === "error") {
      return (
        <AgentLoadingState
          bootStatus={displayBootStatus}
          actionLabel={errorActionLabel}
          onAction={handleErrorAction}
        />
      );
    }

    if (displayBootStatus.status === "ready") {
      if (journeyIntro?.enabled) return <JourneyIntroPanel {...journeyIntro} />;
      if (journeyMissionCard?.enabled) return <JourneyMissionChatCard key={journeyMissionCard.day.id} {...journeyMissionCard} />;
      return <AgentEmptyHistory onPromptSelect={setChatInput} />;
    }

    return <StoppedChatEmptyState />;
  })();

  return (
    <div
      className={`relative flex h-full max-h-full min-h-0 min-w-0 flex-col overflow-hidden ${chatDragActive ? "bg-surface-low/10" : ""}`}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (chat.activeSessionReadOnly) return;
        if (!e.dataTransfer.types.includes("Files")) return;
        chatDragDepthRef.current += 1;
        setChatDragActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (chat.activeSessionReadOnly) return;
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (chat.activeSessionReadOnly) return;
        chatDragDepthRef.current = Math.max(0, chatDragDepthRef.current - 1);
        if (chatDragDepthRef.current === 0) {
          setChatDragActive(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        chatDragDepthRef.current = 0;
        setChatDragActive(false);
        if (chat.activeSessionReadOnly) return;
        if (e.dataTransfer.files?.length) {
          void handleChatFileDrop(e.dataTransfer.files);
        }
      }}
    >
      {chatDragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-[rgb(var(--selection-accent-rgb)_/_0.5)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)]">
          <div className="rounded-xl border border-border bg-background/95 px-4 py-3 text-center shadow-lg backdrop-blur">
            <p className="text-sm font-medium text-foreground">Drop files into chat</p>
            <p className="mt-1 text-xs text-text-muted">Images attach inline. Other files upload to the workspace and prepare a prompt.</p>
          </div>
        </div>
      )}
      <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-5xl min-w-0 flex-1 flex-col gap-4 overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
          {visibleChatMessages.length === 0 && !activeIntegrationAction && (
            <ChatEmptyStateFrame>{emptyChatContent}</ChatEmptyStateFrame>
          )}

          {visibleChatMessages.map(({ message: msg, index: i }) => {
            const parsedUiActions = parseClawUiActionBlocks(msg.content, msg.role);
            const integrationConnectActions = parsedUiActions.actions.filter(isIntegrationConnectAction);
            const displayMessage = parsedUiActions.displayContent === msg.content
              ? msg
              : { ...msg, content: parsedUiActions.displayContent };
            const voicePath = extractVoicePathFromMessage(msg.content);
            const inlineAudioFile = voicePath && !hasMatchingVoiceFile(msg.files, voicePath)
              ? { agentId: selectedAgent.id, path: voicePath }
              : null;
            return (
              <React.Fragment key={i}>
                {integrationConnectActions.length === 0 && hasRenderableMessagePayload(displayMessage) && (
                  <ChatMessageBubble
                    message={displayMessage}
                    inlineAudioFile={inlineAudioFile}
                    agentId={selectedAgent.id}
                    timestampVariant="v2"
                    bubblesVariant="v2"
                    nameVariant="v2"
                    animationVariant="v2"
                    themeVariant="v2"
                    streamingVariant="v2"
                    isStreaming={chat.sending && i === chat.messages.length - 1 && msg.role === "assistant"}
                    agentName={selectedAgent.name ?? "Agent"}
                    agentMeta={selectedAgent.meta}
                    onReadFileBytesFromChat={onReadFileBytesFromChat}
                    onOpenFileFromChat={onOpenFileFromChat}
                    onDownloadFileFromChat={onDownloadFileFromChat}
                  />
                )}
                {integrationConnectActions.length > 0 && (
                  <div className="flex w-full justify-stretch">
                    <div className="w-full min-w-0">
                      {integrationConnectActions.map((action, actionIndex) => (
                        <IntegrationChatCardHost
                          key={`${action.type}:${action.integrationId}:${actionIndex}`}
                          action={action}
                          chat={chat}
                          agentName={selectedAgent.name || selectedAgent.id}
                          agentSetupStatus={githubAgentSetupStatus}
                          onStartAgentGitHubSetup={startAgentGitHubSetup}
                          onVerifyAgentGitHubSetup={verifyAgentGitHubSetup}
                          onOpenFullSetup={openFullIntegrationSetup}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {chat.messages.length > 0 && displayBootStatus.status === "ready" && journeyMissionCard?.enabled ? (
            <div className="flex justify-center py-1">
              <JourneyMissionChatCard key={journeyMissionCard.day.id} {...journeyMissionCard} />
            </div>
          ) : null}

          {activeIntegrationAction && (
            <div className="flex w-full justify-stretch">
              <div className="w-full min-w-0">
                <IntegrationChatCardHost
                  action={activeIntegrationAction}
                  chat={chat}
                  agentName={selectedAgent.name || selectedAgent.id}
                  agentSetupStatus={githubAgentSetupStatus}
                  onStartAgentGitHubSetup={startAgentGitHubSetup}
                  onVerifyAgentGitHubSetup={verifyAgentGitHubSetup}
                  onOpenFullSetup={openFullIntegrationSetup}
                  onDismiss={() => setActiveIntegrationAction(null)}
                />
              </div>
            </div>
          )}

          {(() => {
            if (chat.aborting) {
              return (
                <div className="flex justify-center py-1">
                  <div
                    role="status"
                    aria-label="Stopping reply"
                    className="inline-flex items-center gap-2 rounded-full border border-destructive/25 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Stopping reply...</span>
                  </div>
                </div>
              );
            }
            if (!chat.sending) return null;
            const last = chat.messages[chat.messages.length - 1];
            if (last && shouldHideIntegrationSetupMessage(last)) return null;
            const hasContent = last?.role === "assistant" && ((last.content && last.content.trim().length > 0) || (last.toolCalls && last.toolCalls.length > 0));
            return hasContent ? null : <ChatThinkingIndicator variant="v2" />;
          })()}

          {(visibleChatMessages.length > 0 || activeIntegrationAction) && <div ref={chatEndRef} />}
        </div>
      </div>

      {showComposer && (
        <div className={`max-h-[45%] flex-shrink-0 px-3 pt-2 pb-[max(0.625rem,env(safe-area-inset-bottom,0.625rem))] md:max-h-[38%] md:p-3 ${slashMenuOpen || fileMentionMenuOpen ? "overflow-visible" : "overflow-y-auto"}`}>
          <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col">
            {!activeIntegrationAction && !recording && !audioUrl && displayBootStatus.status === "ready" && connectionSuggestions.length > 0 && (
              <div className="mb-2 flex flex-col gap-2">
                {connectionSuggestions.map((suggestion) => {
                  const Icon = suggestion.Icon;
                  return (
                    <div key={suggestion.id} className="flex items-center gap-3 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.2)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-3 py-2 shadow-sm">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.15)] text-[var(--selection-accent)]">
                        <Icon className="h-4 w-4" style={suggestion.iconColor ? { color: suggestion.iconColor } : undefined} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">Connect {suggestion.displayName}</p>
                        <p className="truncate text-xs text-text-muted">{suggestion.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleConnectionSuggestionClick(suggestion)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-3 py-1.5 text-xs font-medium text-[var(--selection-accent)] transition-colors hover:bg-[rgb(var(--selection-accent-rgb)_/_0.2)] disabled:opacity-50"
                        disabled={!onConnectionCta && !suggestion.connectorId}
                        title={`Open ${suggestion.displayName} connection setup`}
                      >
                        Connect
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {slashCommandFeedback ? (
              <div
                role="status"
                aria-live="polite"
                aria-label={slashCommandFeedback}
                className="mb-2 inline-flex max-w-full self-start rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.22)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-3 py-1.5 text-xs font-medium leading-4 text-[var(--selection-accent)]"
              >
                <span className="truncate">{slashCommandFeedback}</span>
              </div>
            ) : null}
            {hasPendingAttachmentWork && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {chat.pendingAttachments.map((att, i) => (
                  <div key={i} className="group relative h-16 w-16">
                    <ResourceImage
                      src={`data:${att.mimeType};base64,${att.content}`}
                      alt={att.fileName || "attachment"}
                      fill
                      sizes="64px"
                      className="rounded-md border border-border object-cover"
                    />
                    <button onClick={() => chat.removeAttachment(i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-3 h-3 text-destructive-foreground" />
                    </button>
                  </div>
                ))}
                {Array.from({ length: chat.pendingAttachmentReads }).map((_, i) => (
                  <div
                    key={`pending-read-${i}`}
                    role="status"
                    aria-label="Preparing image attachment"
                    className="relative flex h-16 w-16 items-center justify-center rounded-md border border-border bg-surface-low"
                  >
                    <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted/25 border-t-[var(--selection-accent)]" />
                  </div>
                ))}
              </div>
            )}
            {chat.pendingFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {chat.pendingFiles.map((file, i) => (
                  <div key={`${file.name}-${i}`} className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface-low px-3 py-1.5 text-xs text-text-secondary">
                    <Paperclip className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{file.name}</span>
                    <button type="button" onClick={() => chat.removePendingFile(i)} className="text-text-muted transition-colors hover:text-destructive" title="Remove attachment">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-center">
              {recording ? (
                <>
                  <div className="flex-1 flex items-center gap-3 bg-surface-low border border-destructive/30 rounded-lg px-3 py-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-destructive transition-transform duration-75" style={{ transform: `scale(${1 + audioLevel * 1.5})` }} />
                    <span className="text-sm text-destructive font-mono">{formatDuration(recordingDuration)}</span>
                    <div className="flex items-center gap-0.5 flex-1">
                      {Array.from({ length: 20 }).map((_, i) => (
                        <div
                          key={i}
                          className="w-1 rounded-full transition-all duration-75"
                          style={{
                            height: `${Math.max(4, Math.min(20, audioLevel * 24 * AUDIO_BAR_WEIGHTS[i % AUDIO_BAR_WEIGHTS.length]))}px`,
                            backgroundColor: audioLevel > 0.1 ? `color-mix(in srgb, var(--destructive) ${Math.round((0.3 + audioLevel * 0.7) * 100)}%, transparent)` : "color-mix(in srgb, var(--destructive) 20%, transparent)",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <button onClick={stopRecording} className="px-3 py-2 rounded-lg border border-destructive text-destructive hover:bg-destructive/10 flex items-center justify-center transition-colors">
                    <Square className="w-4 h-4" />
                  </button>
                </>
              ) : audioUrl ? (
                <>
                  <div className="min-w-0 flex-1 flex items-center gap-1 rounded-full border border-border bg-surface-low px-2 py-1.5">
                    <button onClick={toggleAudioPreviewPlayback} type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-text-muted hover:text-foreground hover:bg-background/50" title={audioPreviewPlaying ? "Pause" : "Play"}>
                      {audioPreviewPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                    <span className="min-w-0 truncate text-xs font-mono text-text-secondary">{formatDuration(audioPreviewDuration || recordingDuration)}</span>
                  </div>
                  <button onClick={discardAudio} className="px-2 py-2 rounded-full border border-border text-text-muted hover:text-destructive hover:bg-surface-low flex items-center justify-center transition-colors" title="Discard" type="button">
                    <X className="w-4 h-4" />
                  </button>
                  <button onClick={sendAudio} disabled={!chat.connected || chat.activeSessionReadOnly || chat.sending || sendingAudio} className="btn-primary px-3 py-2 rounded-full disabled:opacity-50 flex items-center justify-center" type="button">
                    {sendingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </>
              ) : (
                <div className="relative flex-1 min-w-0">
                  <textarea
                    ref={textareaRef}
                    aria-label="Message agent"
                    value={chat.input}
                    onChange={(e) => {
                      resetPromptHistoryNavigation();
                      setDismissedSlashInput(null);
                      setDismissedFileMentionInput(null);
                      setFileMentionSelectedIndex(0);
                      syncComposerSelection(e.target);
                      setChatInput(e.target.value);
                      resizeComposer(e.target);
                    }}
                    onClick={(e) => syncComposerSelection(e.currentTarget)}
                    onKeyUp={(e) => syncComposerSelection(e.currentTarget)}
                    onSelect={(e) => syncComposerSelection(e.currentTarget)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Escape" &&
                        !e.altKey &&
                        !e.ctrlKey &&
                        !e.metaKey &&
                        !e.shiftKey &&
                        chat.sending
                      ) {
                        e.preventDefault();
                        e.stopPropagation();
                        void chat.abortMessage();
                        return;
                      }
                      if (slashMenuOpen && slashCommandMenuRef.current?.canHandleInput()) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          slashCommandMenuRef.current.moveSelection(1);
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          slashCommandMenuRef.current.moveSelection(-1);
                          return;
                        }
                        if (e.key === "PageDown") {
                          e.preventDefault();
                          slashCommandMenuRef.current.moveSelection(5);
                          return;
                        }
                        if (e.key === "PageUp") {
                          e.preventDefault();
                          slashCommandMenuRef.current.moveSelection(-5);
                          return;
                        }
                        if (e.key === "Home") {
                          e.preventDefault();
                          slashCommandMenuRef.current.selectFirst();
                          return;
                        }
                        if (e.key === "End") {
                          e.preventDefault();
                          slashCommandMenuRef.current.selectLast();
                          return;
                        }
                        if (e.key === "Tab") {
                          e.preventDefault();
                          slashCommandMenuRef.current.completeSelection();
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          slashCommandMenuRef.current.close();
                          if (chat.input.trim() === "/") {
                            chat.setInput("");
                          } else {
                            setDismissedSlashInput(chat.input);
                          }
                          return;
                        }
                      }
                      if (fileMentionMenuOpen) {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setFileMentionSelectedIndex((current) => (current + 1) % matchingFileReferences.length);
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setFileMentionSelectedIndex((current) => (current - 1 + matchingFileReferences.length) % matchingFileReferences.length);
                          return;
                        }
                        if (e.key === "PageDown") {
                          e.preventDefault();
                          setFileMentionSelectedIndex((current) => Math.min(matchingFileReferences.length - 1, current + 5));
                          return;
                        }
                        if (e.key === "PageUp") {
                          e.preventDefault();
                          setFileMentionSelectedIndex((current) => Math.max(0, current - 5));
                          return;
                        }
                        if (e.key === "Home") {
                          e.preventDefault();
                          setFileMentionSelectedIndex(0);
                          return;
                        }
                        if (e.key === "End") {
                          e.preventDefault();
                          setFileMentionSelectedIndex(Math.max(0, matchingFileReferences.length - 1));
                          return;
                        }
                        if (e.key === "Tab") {
                          e.preventDefault();
                          completeFileReference();
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setDismissedFileMentionInput(chat.input);
                          return;
                        }
                      }
                      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && handlePromptHistoryKeyDown(e)) {
                        return;
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (fileMentionMenuOpen) {
                          completeFileReference();
                          return;
                        }
                        if (slashMenuOpen && slashCommandMenuRef.current?.canHandleInput()) {
                          void slashCommandMenuRef.current.executeCurrentInput();
                          return;
                        }
                        handleSendChat();
                      }
                    }}
                    onPaste={(e) => {
                      if (chat.activeSessionReadOnly) return;
                      const items = e.clipboardData?.items;
                      if (!items) return;
                      const imageFiles: File[] = [];
                      for (const item of Array.from(items)) {
                        if (item.type.startsWith("image/")) {
                          const file = item.getAsFile();
                          if (file) imageFiles.push(file);
                        }
                      }
                      if (imageFiles.length > 0) {
                        e.preventDefault();
                        const dt = new DataTransfer();
                        imageFiles.forEach((f) => dt.items.add(f));
                        chat.addAttachments(dt.files);
                      }
                    }}
                    rows={1}
                    placeholder={composerPlaceholder}
                    disabled={composerDisabled}
                    className={`w-full resize-none bg-surface-low border border-border rounded-3xl pl-5 py-3 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-border-strong disabled:opacity-50 overflow-hidden ${chat.sending ? "pr-40" : "pr-24 sm:pr-28"}`}
                  />
                  {slashMenuOpen ? (
                    <AgentSlashCommandMenu
                      ref={slashCommandMenuRef}
                      chat={chat}
                      input={chat.input}
                      selectedAgentName={selectedAgent.name || "Agent"}
                      isSelectedRunning={isSelectedRunning}
                      actions={commandActions}
                      onFeedback={handleSlashCommandFeedback}
                    />
                  ) : null}
                  {fileMentionMenuOpen ? (
                    <div
                      className="absolute bottom-full left-0 right-0 z-40 mb-2 max-h-[min(20rem,calc(100vh-10rem))] overflow-hidden rounded-lg border border-border bg-background/98 shadow-2xl backdrop-blur"
                      role="listbox"
                      aria-label="File reference suggestions"
                    >
                      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-text-muted">
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-xs">
                          {activeFileMention?.query ? `@${activeFileMention.query}` : "Reference a workspace file"}
                        </span>
                        <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] uppercase text-text-muted">Tab</span>
                      </div>
                      <div className="max-h-[min(16rem,calc(100vh-14rem))] overflow-y-auto p-1.5">
                        {matchingFileReferences.map((suggestion, index) => {
                          const selected = index === clampedFileMentionSelectedIndex;
                          return (
                            <button
                              key={suggestion.file.path}
                              ref={(node) => {
                                if (node) {
                                  fileMentionOptionRefs.current.set(suggestion.file.path, node);
                                } else {
                                  fileMentionOptionRefs.current.delete(suggestion.file.path);
                                }
                              }}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onMouseEnter={() => setFileMentionSelectedIndex(index)}
                              onClick={() => completeFileReference(suggestion)}
                              className={`flex w-full min-w-0 items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
                                selected ? "bg-[rgb(var(--selection-accent-rgb)_/_0.12)] text-foreground" : "text-text-secondary hover:bg-surface-low"
                              }`}
                            >
                              <FileText className="h-4 w-4 shrink-0 text-[var(--selection-accent)]" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium text-foreground">{suggestion.file.name}</span>
                                <span className="block truncate font-mono text-[11px] leading-4 text-text-muted">{suggestion.displayPath}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  <div className="absolute right-2 top-[calc(50%-3px)] -translate-y-1/2 flex items-center gap-1">
                    <label
                      aria-disabled={composerDisabled}
                      className={`w-8 h-8 rounded-full text-text-muted flex items-center justify-center transition-colors ${composerDisabled ? "cursor-not-allowed opacity-40" : "hover:text-foreground hover:bg-surface-low cursor-pointer"}`}
                      title={chat.activeSessionReadOnly ? readOnlyComposerReason : "Attach file"}
                    >
                      <Paperclip className="w-4 h-4" />
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        disabled={composerDisabled}
                        onChange={(e) => {
                          if (composerDisabled) return;
                          if (e.target.files?.length) {
                            void handleChatFileDrop(e.target.files);
                            e.target.value = "";
                          }
                        }}
                      />
                    </label>
                    <button onClick={startRecording} disabled={composerDisabled || chat.input.trim().length > 0} className="w-8 h-8 rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.15)] text-[var(--selection-accent)] hover:bg-[rgb(var(--selection-accent-rgb)_/_0.25)] hover:text-[var(--selection-accent)] flex items-center justify-center transition-colors disabled:opacity-40 disabled:hover:bg-[rgb(var(--selection-accent-rgb)_/_0.15)]" title={chat.activeSessionReadOnly ? readOnlyComposerReason : chat.input.trim().length > 0 ? "Clear text to record voice" : "Record voice message"}>
                      <Mic className="w-4 h-4" />
                    </button>
                    {chat.sending ? (
                      <button
                        onClick={() => { void chat.abortMessage(); }}
                        disabled={!chat.connected || chat.aborting}
                        className="w-8 h-8 rounded-full border border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20 disabled:opacity-40 flex items-center justify-center transition-colors"
                        title={chat.aborting ? "Stopping reply" : "Stop reply"}
                        aria-label={chat.aborting ? "Stopping reply" : "Stop reply"}
                        type="button"
                      >
                        {chat.aborting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
                      </button>
                    ) : null}
                    <button onClick={handleSendChat} disabled={!canSendChatDraft} className="w-8 h-8 btn-primary rounded-full disabled:opacity-40 flex items-center justify-center" title="Send message">
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
