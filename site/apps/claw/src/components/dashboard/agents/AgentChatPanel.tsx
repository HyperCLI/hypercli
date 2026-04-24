"use client";

import React from "react";
import { Loader2, MessageSquare, Mic, Paperclip, Pause, Play, Send, Square, X } from "lucide-react";
import { API_BASE_URL } from "@/lib/api";
import { encodePath } from "@/lib/image-tools";
import { extractVoicePathFromMessage } from "@/lib/openclaw-config";
import { ChatMessageBubble, ChatThinkingIndicator } from "@/components/dashboard/ChatMessage";
import type { Agent } from "@/app/dashboard/agents/types";
import type { useOpenClawSession } from "@/hooks/useOpenClawSession";

type ChatSession = ReturnType<typeof useOpenClawSession>;

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
}: AgentChatPanelProps) {
  return (
    <div
      className={`relative flex h-full min-h-0 flex-col ${chatDragActive ? "bg-surface-low/10" : ""}`}
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
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-[#38D39F]/50 bg-[#38D39F]/8">
          <div className="rounded-xl border border-border bg-background/95 px-4 py-3 text-center shadow-lg backdrop-blur">
            <p className="text-sm font-medium text-foreground">Drop files into chat</p>
            <p className="mt-1 text-xs text-text-muted">Images attach inline. Other files upload to the workspace and prepare a prompt.</p>
          </div>
        </div>
      )}
      <div ref={chatScrollRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
        {chat.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted">
            {chat.connecting ? (
              <>
                <Loader2 className="w-8 h-8 mb-2 animate-spin" />
                <p className="text-sm">Connecting to gateway...</p>
                <p className="text-xs mt-1 text-text-muted/60">Retrying every 5s</p>
              </>
            ) : chat.connected ? (
              <>
                <MessageSquare className="w-8 h-8 mb-2" />
                <p className="text-sm">Send a message to start chatting with your agent</p>
              </>
            ) : (
              <>
                <MessageSquare className="w-8 h-8 mb-2" />
                <p className="text-sm">{isSelectedRunning ? "Connecting to gateway..." : "Start the agent to begin chatting"}</p>
              </>
            )}
          </div>
        )}

        {chat.messages.map((msg, i) => {
          const voicePath = msg.role === "user" ? extractVoicePathFromMessage(msg.content) : null;
          const inlineAudioUrl = voicePath
            ? `${API_BASE_URL}/deployments/${selectedAgent.id}/files/${encodePath(voicePath)}`
            : null;
          return (
            <ChatMessageBubble
              key={i}
              message={msg}
              inlineAudioUrl={inlineAudioUrl}
              agentId={selectedAgent.id}
              timestampVariant="v2"
              bubblesVariant="v2"
              nameVariant="v2"
              animationVariant="v2"
              themeVariant="v2"
              streamingVariant="v2"
              isStreaming={chat.sending && i === chat.messages.length - 1 && msg.role === "assistant"}
              agentName={selectedAgent.name ?? "Agent"}
            />
          );
        })}

        {(() => {
          if (!chat.sending) return null;
          const last = chat.messages[chat.messages.length - 1];
          const hasContent = last?.role === "assistant" && ((last.content && last.content.trim().length > 0) || (last.toolCalls && last.toolCalls.length > 0));
          return hasContent ? null : <ChatThinkingIndicator variant="v2" />;
        })()}

        <div ref={chatEndRef} />
      </div>

      <div className="flex-shrink-0 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0.75rem))] md:p-3">
        {chat.pendingAttachments.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {chat.pendingAttachments.map((att, i) => (
              <div key={i} className="relative group">
                <img src={`data:${att.mimeType};base64,${att.content}`} alt={att.fileName || "attachment"} className="w-16 h-16 rounded-md object-cover border border-border" />
                <button onClick={() => chat.removeAttachment(i)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#d05f5f] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}
        {chat.pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {chat.pendingFiles.map((file, i) => (
              <div key={`${file.name}-${i}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-surface-low px-3 py-1.5 text-xs text-text-secondary">
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
                        height: `${Math.max(4, Math.min(20, audioLevel * 24 * (0.5 + Math.random() * 0.5)))}px`,
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
              <div className="min-w-0 flex-1 flex items-center gap-1 rounded-lg border border-border bg-surface-low px-2 py-1.5">
                <button onClick={toggleAudioPreviewPlayback} type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:text-foreground hover:bg-background/50" title={audioPreviewPlaying ? "Pause" : "Play"}>
                  {audioPreviewPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </button>
                <span className="min-w-0 truncate text-xs font-mono text-text-secondary">{formatDuration(audioPreviewDuration || recordingDuration)}</span>
              </div>
              <button onClick={discardAudio} className="px-2 py-2 rounded-lg border border-border text-text-muted hover:text-[#d05f5f] hover:bg-surface-low flex items-center justify-center transition-colors" title="Discard" type="button">
                <X className="w-4 h-4" />
              </button>
              <button onClick={sendAudio} disabled={!chat.connected || chat.sending || sendingAudio} className="btn-primary px-3 py-2 rounded-lg disabled:opacity-50 flex items-center justify-center" type="button">
                {sendingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </>
          ) : (
            <div className="relative flex-1 min-w-0">
              <textarea
                value={chat.input}
                onChange={(e) => {
                  chat.setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
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
                placeholder={chat.connected ? "Message agent..." : "Waiting for gateway..."}
                disabled={!chat.connected}
                className="w-full resize-none bg-[#2f2f2f] border border-border rounded-3xl pl-5 pr-28 py-3 text-sm text-foreground placeholder-text-muted focus:outline-none focus:border-border-strong disabled:opacity-50 overflow-hidden"
              />
              <div className="absolute right-2 top-[calc(50%-3px)] -translate-y-1/2 flex items-center gap-1">
                <label className="w-8 h-8 rounded-full text-text-muted hover:text-foreground hover:bg-surface-low cursor-pointer flex items-center justify-center transition-colors" title="Attach file">
                  <Paperclip className="w-4 h-4" />
                  <input
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
                <button onClick={startRecording} disabled={!chat.connected || chat.input.trim().length > 0} className="w-8 h-8 rounded-full bg-[#38D39F]/15 text-[#38D39F] hover:bg-[#38D39F]/25 hover:text-[#38D39F] flex items-center justify-center transition-colors disabled:opacity-40 disabled:hover:bg-[#38D39F]/15" title={chat.input.trim().length > 0 ? "Clear text to record voice" : "Record voice message"}>
                  <Mic className="w-4 h-4" />
                </button>
                <button onClick={handleSendChat} disabled={!chat.connected || (!chat.input.trim() && chat.pendingAttachments.length === 0 && chat.pendingFiles.length === 0)} className="w-8 h-8 btn-primary rounded-full disabled:opacity-40 flex items-center justify-center" title="Send message">
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
