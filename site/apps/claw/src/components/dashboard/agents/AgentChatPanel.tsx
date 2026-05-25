"use client";

import React from "react";
import { ArrowRight, Loader2, Mic, Paperclip, Pause, Play, Send, Sparkles, Square, X } from "lucide-react";
import { extractVoicePathFromMessage } from "@/lib/openclaw-config";
import { ChatMessageBubble, ChatThinkingIndicator } from "@/components/dashboard/ChatMessage";
import type { Agent } from "@/app/dashboard/agents/types";
import type { useOpenClawSession } from "@/hooks/useOpenClawSession";
import { AgentLoadingState } from "@/components/dashboard/agents/page-helpers";
import { AgentEmptyHistory } from "@/components/dashboard/agents/AgentEmptyHistory";
import { getConnectionSuggestions, type ChatConnectionSuggestion } from "@/components/dashboard/agents/AgentChatConnectionSuggestions";
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
}: AgentChatPanelProps) {
  const slashCommandMenuRef = React.useRef<AgentSlashCommandMenuHandle>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const slashFeedbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [slashMenuDismissed, setSlashMenuDismissed] = React.useState(false);
  const [slashCommandFeedback, setSlashCommandFeedback] = React.useState("");
  const connectionSuggestions = React.useMemo(
    () => getConnectionSuggestions(chat.input, chat.config, chat.configSchema),
    [chat.config, chat.configSchema, chat.input],
  );
  const commandActions = React.useMemo<AgentSlashCommandActions>(() => ({
    ...slashCommandActions,
    onTriggerFilePicker: slashCommandActions?.onTriggerFilePicker ?? (() => fileInputRef.current?.click()),
  }), [slashCommandActions]);
  const slashInputActive = !recording && !audioUrl && chat.input.trimStart().startsWith("/") && !chat.input.trimStart().startsWith("//");
  const slashMenuOpen = slashInputActive && !slashMenuDismissed;
  React.useEffect(() => {
    setSlashMenuDismissed(false);
  }, [chat.input]);
  React.useEffect(() => () => {
    if (slashFeedbackTimerRef.current) clearTimeout(slashFeedbackTimerRef.current);
  }, []);
  const handleSlashCommandFeedback = React.useCallback((message: string) => {
    setSlashCommandFeedback(message);
    if (slashFeedbackTimerRef.current) clearTimeout(slashFeedbackTimerRef.current);
    slashFeedbackTimerRef.current = setTimeout(() => {
      setSlashCommandFeedback("");
      slashFeedbackTimerRef.current = null;
    }, 2600);
  }, []);
  const setChatInput = chat.setInput;
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
  const canSendChatDraft =
    chat.connected &&
    chat.pendingAttachmentReads === 0 &&
    (chat.input.trim().length > 0 || chat.pendingAttachments.length > 0 || chat.pendingFiles.length > 0);
  const composerHasDraft =
    recording ||
    Boolean(audioUrl) ||
    chat.input.trim().length > 0 ||
    hasPendingAttachmentWork ||
    chat.pendingFiles.length > 0;
  const showComposer = displayBootStatus.status === "ready" || composerHasDraft;
  const composerDisabled = displayBootStatus.status !== "ready" || !chat.connected;
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
        if (!e.dataTransfer.types.includes("Files")) return;
        chatDragDepthRef.current += 1;
        setChatDragActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
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
          {chat.messages.length === 0 && (
            <ChatEmptyStateFrame>{emptyChatContent}</ChatEmptyStateFrame>
          )}

          {chat.messages.map((msg, i) => {
            const voicePath = msg.role === "user" ? extractVoicePathFromMessage(msg.content) : null;
            const inlineAudioFile = voicePath ? { agentId: selectedAgent.id, path: voicePath } : null;
            return (
              <ChatMessageBubble
                key={i}
                message={msg}
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
              />
            );
          })}

          {(() => {
            if (!chat.sending) return null;
            const last = chat.messages[chat.messages.length - 1];
            const hasContent = last?.role === "assistant" && ((last.content && last.content.trim().length > 0) || (last.toolCalls && last.toolCalls.length > 0));
            return hasContent ? null : <ChatThinkingIndicator variant="v2" />;
          })()}

          {chat.messages.length > 0 && <div ref={chatEndRef} />}
        </div>
      </div>

      {showComposer && (
        <div className={`max-h-[45%] flex-shrink-0 px-3 pt-2 pb-[max(0.625rem,env(safe-area-inset-bottom,0.625rem))] md:max-h-[38%] md:p-3 ${slashMenuOpen ? "overflow-visible" : "overflow-y-auto"}`}>
          <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col">
            {!recording && !audioUrl && displayBootStatus.status === "ready" && connectionSuggestions.length > 0 && (
              <div className="mb-2 flex flex-col gap-2">
                {connectionSuggestions.map((suggestion) => {
                  const Icon = suggestion.Icon;
                  return (
                    <div key={suggestion.id} className="flex items-center gap-3 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.2)] bg-[rgb(var(--selection-accent-rgb)_/_0.08)] px-3 py-2 shadow-sm">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.15)] text-[var(--selection-accent)]">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">Connect {suggestion.displayName}</p>
                        <p className="truncate text-xs text-text-muted">{suggestion.description}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onConnectionCta?.(suggestion)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[rgb(var(--selection-accent-rgb)_/_0.3)] bg-[rgb(var(--selection-accent-rgb)_/_0.1)] px-3 py-1.5 text-xs font-medium text-[var(--selection-accent)] transition-colors hover:bg-[rgb(var(--selection-accent-rgb)_/_0.2)] disabled:opacity-50"
                        disabled={!onConnectionCta}
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
                    <button onClick={() => chat.removeAttachment(i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#d05f5f] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="w-3 h-3 text-white" />
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
                    <button type="button" onClick={() => chat.removePendingFile(i)} className="text-text-muted transition-colors hover:text-[#d05f5f]" title="Remove attachment">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-center">
              {recording ? (
                <>
                  <div className="flex-1 flex items-center gap-3 bg-surface-low border border-[#d05f5f]/30 rounded-lg px-3 py-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#d05f5f] transition-transform duration-75" style={{ transform: `scale(${1 + audioLevel * 1.5})` }} />
                    <span className="text-sm text-[#d05f5f] font-mono">{formatDuration(recordingDuration)}</span>
                    <div className="flex items-center gap-0.5 flex-1">
                      {Array.from({ length: 20 }).map((_, i) => (
                        <div
                          key={i}
                          className="w-1 rounded-full transition-all duration-75"
                          style={{
                            height: `${Math.max(4, Math.min(20, audioLevel * 24 * AUDIO_BAR_WEIGHTS[i % AUDIO_BAR_WEIGHTS.length]))}px`,
                            backgroundColor: audioLevel > 0.1 ? `rgba(208, 95, 95, ${0.3 + audioLevel * 0.7})` : "rgba(208, 95, 95, 0.2)",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <button onClick={stopRecording} className="px-3 py-2 rounded-lg border border-[#d05f5f] text-[#d05f5f] hover:bg-[#d05f5f]/10 flex items-center justify-center transition-colors">
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
                  <button onClick={discardAudio} className="px-2 py-2 rounded-full border border-border text-text-muted hover:text-[#d05f5f] hover:bg-surface-low flex items-center justify-center transition-colors" title="Discard" type="button">
                    <X className="w-4 h-4" />
                  </button>
                  <button onClick={sendAudio} disabled={!chat.connected || chat.sending || sendingAudio} className="btn-primary px-3 py-2 rounded-full disabled:opacity-50 flex items-center justify-center" type="button">
                    {sendingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </>
              ) : (
                <div className="relative flex-1 min-w-0">
                  <textarea
                    aria-label="Message agent"
                    value={chat.input}
                    onChange={(e) => {
                      setSlashMenuDismissed(false);
                      chat.setInput(e.target.value);
                      e.target.style.height = "auto";
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                    }}
                    onKeyDown={(e) => {
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
                            setSlashMenuDismissed(true);
                          }
                          return;
                        }
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (slashMenuOpen && slashCommandMenuRef.current?.canHandleInput()) {
                          void slashCommandMenuRef.current.executeCurrentInput();
                          return;
                        }
                        handleSendChat();
                      }
                    }}
                    onPaste={(e) => {
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
                    placeholder={chat.connected ? "Message agent..." : chat.connecting ? "Preparing chat..." : "Connect gateway to message..."}
                    disabled={composerDisabled}
                    className="w-full resize-none bg-[#232323] border border-border rounded-3xl pl-5 pr-24 py-3 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-border-strong disabled:opacity-50 overflow-hidden sm:pr-28"
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
                  <div className="absolute right-2 top-[calc(50%-3px)] -translate-y-1/2 flex items-center gap-1">
                    <label className="w-8 h-8 rounded-full text-text-muted hover:text-foreground hover:bg-surface-low cursor-pointer flex items-center justify-center transition-colors" title="Attach file">
                      <Paperclip className="w-4 h-4" />
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.length) {
                            void handleChatFileDrop(e.target.files);
                            e.target.value = "";
                          }
                        }}
                      />
                    </label>
                    <button onClick={startRecording} disabled={!chat.connected || chat.input.trim().length > 0} className="w-8 h-8 rounded-full bg-[rgb(var(--selection-accent-rgb)_/_0.15)] text-[var(--selection-accent)] hover:bg-[rgb(var(--selection-accent-rgb)_/_0.25)] hover:text-[var(--selection-accent)] flex items-center justify-center transition-colors disabled:opacity-40 disabled:hover:bg-[rgb(var(--selection-accent-rgb)_/_0.15)]" title={chat.input.trim().length > 0 ? "Clear text to record voice" : "Record voice message"}>
                      <Mic className="w-4 h-4" />
                    </button>
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
