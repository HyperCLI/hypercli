import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Image,
  Loader2,
  PanelLeftOpen,
  Paperclip,
  Play,
  Plus,
  Settings,
  Share2,
  Square,
  X,
} from "lucide-react";
import { hasAgentVoice, type AgentSummary } from "../api";
import type { AgentChat, ChatMessage, MessageAttachment } from "../useAgentChat";
import { readAttachment } from "../attachments";
import { insertTranscript } from "../lib/dictation";
import { readAloud } from "../lib/read-aloud";
import { setReadAloudEnabled } from "../lib/voice-read";
import { setVoiceRepliesReadAloudEnabled, voiceRepliesEnabled } from "../lib/voice-replies";
import { usePersona } from "../personas";
import { Avatar } from "./Avatar";
import { DictationButton } from "./DictationButton";
import { Markdown } from "./Markdown";
import { ReadAloudButton } from "./ReadAloudButton";
import { PlanList, ThinkingBlock, ToolCallRow } from "./ToolCallRow";
import { ApprovalCard } from "./ApprovalCard";
import { RUNNING, TRANSITIONAL, runtimeFamily } from "../agent-utils";
import { canRuntimeChat } from "../runtime-client";

const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function AttachmentGlyph({ attachment }: { attachment: MessageAttachment }) {
  if (attachment.mimeType.startsWith("image/")) {
    return (
      <img
        src={`data:${attachment.mimeType};base64,${attachment.dataBase64}`}
        alt={attachment.name}
        className="attachment-thumb"
      />
    );
  }
  return <Paperclip size={11} />;
}

function TurnAudioStatus({
  message,
  onStop,
  onReplay,
}: {
  message: ChatMessage;
  onStop: (messageId: string) => void;
  onReplay: (messageId: string) => void;
}) {
  if (message.role !== "assistant" || !message.audioStatus) return null;
  if (message.audioStatus === "generating") {
    return (
      <div className="mt-2 flex items-center gap-2 text-[11px] text-text-secondary">
        <Loader2 size={12} className="animate-spin" />
        Generating audio…
      </div>
    );
  }
  if (message.audioStatus === "playing") {
    return (
      <div className="mt-2 flex items-center gap-2 text-[11px] text-text-secondary">
        <Loader2 size={12} className="animate-spin" />
        <span>Audio playing</span>
        <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-text hover:bg-surface-2" onClick={() => onStop(message.id)}>
          <Square size={10} />
          Stop
        </button>
      </div>
    );
  }
  return (
    <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-text" onClick={() => onReplay(message.id)}>
      <Play size={12} />
      Replay Audio
    </button>
  );
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportChatHtml(agentName: string, messages: ChatMessage[]) {
  const rows = messages
    .map((message) => {
      const who = message.role === "user" ? "You" : agentName;
      const tools = message.toolCalls
        .map((tool) => `<div class="tool">🔧 ${escapeHtml(tool.title)} — ${escapeHtml(tool.status)}</div>`)
        .join("");
      const thoughts = message.thoughts.length
        ? `<details class="thinking"><summary>Thinking</summary><pre>${escapeHtml(message.thoughts.join(""))}</pre></details>`
        : "";
      return `<div class="msg ${message.role}">
        <div class="meta"><strong>${escapeHtml(who)}</strong> · ${new Date(message.ts).toLocaleString()}</div>
        ${thoughts}
        ${tools}
        <div class="text">${escapeHtml(message.text)}</div>
      </div>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(agentName)} chat</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  .msg { margin-bottom: 1.5rem; }
  .msg.user .text { background: #eef2ff; border-radius: 12px; padding: 0.6rem 0.9rem; display: inline-block; }
  .meta { color: #888; font-size: 0.8rem; margin-bottom: 0.25rem; }
  .text { white-space: pre-wrap; line-height: 1.5; }
  .tool { font-family: ui-monospace, monospace; font-size: 0.8rem; color: #555; background: #f4f4f5; border-radius: 6px; padding: 0.3rem 0.6rem; margin: 0.25rem 0; }
  .thinking pre { white-space: pre-wrap; color: #777; font-size: 0.8rem; }
</style></head>
<body><h1>${escapeHtml(agentName)}</h1>
${rows}
</body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${agentName.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}-chat.html`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ChatPane({
  agent,
  chat,
  sessionNonce,
  busy,
  onStart,
  onRestore,
  onOpenLogs,
  leftOpen,
  rightOpen,
  onOpenLeft,
  onOpenRight,
}: {
  agent: AgentSummary | null;
  chat: AgentChat;
  /** Bumped on agent/session switch so the view snaps to the latest messages. */
  sessionNonce: number;
  /**
   * A lifecycle command is in flight or waiting for the roster to confirm it.
   * The failure itself is not a prop any more: `agentMachine` publishes it to
   * the [ErrorBar](ErrorBar.tsx) with a Retry action (FSM.md §2 guarantee 5).
   */
  busy: boolean;
  onStart: (id: string) => void;
  onRestore: (id: string) => void;
  onOpenLogs: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onOpenLeft: () => void;
  onOpenRight: () => void;
}) {
  const persona = usePersona(agent?.id ?? null);
  const [draft, setDraft] = useState("");
  const [speakReplies, setSpeakReplies] = useState(() =>
    agent && hasAgentVoice(agent) ? voiceRepliesEnabled(agent.id) : false,
  );
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [now, setNow] = useState(Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Caret position a dictation insert asked for; applied by the draft effect. */
  const pendingCaretRef = useRef<number | null>(null);

  const approvalCount = chat.approvals.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.busy, approvalCount]);

  // Switching agent/session must land on the latest message regardless of
  // where the previous conversation was scrolled to.
  const chatInstanceKey = `${agent?.id ?? ""}:${sessionNonce}`;
  useEffect(() => {
    nearBottomRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatInstanceKey]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
      // A dictation insert restores focus and the caret to just after what it added.
      if (pendingCaretRef.current !== null) {
        el.focus();
        el.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current);
        pendingCaretRef.current = null;
      }
    }
  }, [draft]);

  useEffect(() => {
    if (!chat.busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [chat.busy]);

  useEffect(() => {
    if (!agent) return;
    const enabled = hasAgentVoice(agent) && voiceRepliesEnabled(agent.id);
    setReadAloudEnabled(enabled);
    setSpeakReplies(enabled);
  }, [agent?.id, agent?.avatar_audio_url]);

  useEffect(() => {
    if (!plusMenuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlusMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [plusMenuOpen]);

  const reopenLeft = !leftOpen && (
    <button
      onClick={onOpenLeft}
      title="Show sidebar (⌘B)"
      className="ui-icon-button-sm"
    >
      <PanelLeftOpen size={15} />
    </button>
  );
  const reopenRight = agent && !rightOpen && (
    <button
      onClick={onOpenRight}
      title="Show context panel (⌘⇧B)"
      className="ui-icon-button-sm"
    >
      <Settings size={15} />
    </button>
  );

  if (!agent) {
    return (
      <section className="app-main">
        <header className="app-header">
          <div data-tauri-drag-region className="drag-fill" />
          <div className="app-header-content px-5">
            {reopenLeft}
            <div className="flex-1" />
            {reopenRight}
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-[340px] px-6">
            <div className="text-[15px] font-semibold mb-1">Your agents, one desk</div>
            <p className="text-[13px] text-text-secondary leading-relaxed">
              Pick an agent from the sidebar, or create a new one.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const isRunning = agent.state === RUNNING;
  const family = runtimeFamily(agent.runtime);
  const transitional = TRANSITIONAL.has(agent.state);
  const archived = agent.state === "ARCHIVED";
  const runtimeCanChat = canRuntimeChat(agent);
  const canCompose = chat.phase === "ready" && (family === "acp" || (runtimeCanChat && chat.mountState === "MOUNTED"));
  const acceptsAttachments = canCompose && family === "acp";
  const canSend = canCompose && (draft.trim().length > 0 || attachments.length > 0) && !chat.busy;

  const addFiles = async (files: Iterable<File>) => {
    setAttachError(null);
    if (!acceptsAttachments) {
      setAttachError("This agent can't take file attachments.");
      return;
    }
    for (const file of files) {
      if (file.size > ATTACHMENT_MAX_BYTES) {
        setAttachError(`${file.name} is over ${formatBytes(ATTACHMENT_MAX_BYTES)} — too large to attach.`);
        continue;
      }
      try {
        const attachment = await readAttachment(file);
        setAttachments((prev) => [...prev, attachment]);
      } catch (error) {
        setAttachError(error instanceof Error ? error.message : `Could not read ${file.name}.`);
      }
    }
    // When new attachments arrive the follow-up question usually comes next.
    textareaRef.current?.focus();
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    const files = event.dataTransfer?.files;
    if (files?.length) void addFiles(files);
  };
  const composerPlaceholder = chat.phase === "ready"
    ? `Message ${agent.name}…`
    : isRunning && runtimeCanChat
      ? "Preparing chat…"
      : "Start the agent to chat…";

  const submit = () => {
    if (!canSend) return;
    chat.send(draft, attachments);
    setDraft("");
    setAttachments([]);
    setAttachError(null);
    nearBottomRef.current = true;
  };
  const lastAssistant = [...chat.messages].reverse().find((message) => message.role === "assistant");
  const pendingTools = lastAssistant?.toolCalls.filter((tool) => tool.status === "in_progress" || tool.status === "pending") ?? [];
  const completedTools = lastAssistant?.toolCalls.filter((tool) => tool.status === "completed") ?? [];
  const lastUser = [...chat.messages].reverse().find((message) => message.role === "user");
  const elapsed = lastUser ? Math.max(1, Math.round((now - lastUser.ts) / 1000)) : 0;
  const activeTrace = chat.busy
    ? pendingTools.length > 0
      ? `Using ${pendingTools.length === 1 ? pendingTools[0].title : `${pendingTools.length} tools`} · ${elapsed}s`
      : completedTools.length > 0 && !lastAssistant?.text.trim()
        ? `Preparing answer · ${elapsed}s`
        : `Working · ${elapsed}s`
    : null;

  return (
    <section
      className={`app-main ${dragging ? "drop-target" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer?.types.includes("Files")) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <header className="app-header">
        <div data-tauri-drag-region className="drag-fill" />
        <div className="app-header-content px-5 gap-3">
          {reopenLeft}
          {hasAgentVoice(agent) && (
            <ReadAloudButton
              hasVoice
              enabled={speakReplies}
              onToggle={(next) => {
                setVoiceRepliesReadAloudEnabled(agent.id, next);
                setSpeakReplies(next);
                // The speaker button is the authoritative audio-enable
                // gesture: unlock the WebAudio context inside this click,
                // before a streamed reply needs it.
                if (next) void readAloud.preparePlayback();
                else readAloud.stop();
              }}
            />
          )}
          <Avatar
            name={agent.name}
            url={agent.avatar_url}
            size={24}
            color={persona.color}
            icon={persona.icon}
          />
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-semibold text-[13px] truncate">{agent.name}</span>
            {persona.title && (
              <span className="hidden text-[11px] text-text-secondary truncate min-[768px]:block">
                {persona.title}
              </span>
            )}
          </div>
          <div className="flex-1" />
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-secondary shrink">
            {isRunning ? (
              <>
                <span className="status-dot bg-success shrink-0" />
                <span className="truncate">
                  {family === "acp" ? `Running — ${chat.lastAction ?? "Idle"}` : "Running"}
                </span>
              </>
            ) : transitional ? (
              <>
                <span className="status-dot bg-warning animate-pulse" />
                {agent.state.charAt(0) + agent.state.slice(1).toLowerCase()}…
              </>
            ) : archived ? (
              <>
                <span className="status-dot bg-text-secondary/50" />
                Archived
              </>
            ) : agent.state === "FAILED" ? (
              <>
                <span className="status-dot bg-error shrink-0" />
                Failed
              </>
            ) : agent.state === "DELETED" ? (
              <>
                <span className="status-dot bg-text-secondary/50" />
                Deleted
              </>
            ) : agent.state === "STOPPED" ? (
              <>
                <span className="status-dot bg-text-secondary/50" />
                Stopped
              </>
            ) : (
              // An unrecognised state degrades visibly — never silently as
              // "Stopped" (FSM.md: the union is forward-open).
              <>
                <span className="status-dot bg-text-secondary/50" />
                {agent.state.charAt(0) + agent.state.slice(1).toLowerCase()}
              </>
            )}
          </span>
          {reopenRight}
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        onLoadCapture={(e) => {
          if ((e.target as HTMLElement).tagName !== "IMG") return;
          const el = e.currentTarget;
          if (nearBottomRef.current) el.scrollTop = el.scrollHeight;
        }}
        className="flex-1 overflow-y-auto"
      >
        <div className="chat-column mx-auto max-w-[640px] px-5 py-6 space-y-6">
          {chat.phase === "connecting" && (
            <div className="flex items-center justify-center gap-2 pt-16 text-text-secondary text-[12px]">
              <Loader2 size={14} className="animate-spin" />
              Connecting to {agent.name}…
            </div>
          )}

          {chat.phase === "error" && (
            <div className="mx-auto max-w-[420px] rounded-lg border border-error/40 bg-error-bg px-4 py-3 text-[12px] text-error">
              <div>{chat.error ?? "Connection failed"}</div>
              <button
                onClick={chat.retry}
                className="mt-2 rounded-md border border-error/50 px-2.5 py-1 text-[11px] font-medium hover:bg-error/10 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {busy && (
            <div className="mx-auto flex max-w-[460px] items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-[12px] text-text-secondary">
              <Loader2 size={13} className="animate-spin shrink-0" />
              <span className="min-w-0 flex-1">
                Waiting for the control plane to confirm the last action on {agent.name}…
              </span>
              <button
                onClick={onOpenLogs}
                className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-foreground/5"
              >
                View logs
              </button>
            </div>
          )}

          {!isRunning && !transitional && (
            <div className="text-center pt-16">
              <Avatar
                name={agent.name}
                url={agent.avatar_url}
                size={44}
                color={persona.color}
                icon={persona.icon}
                className="mx-auto mb-4"
              />
              <div className="text-[15px] font-semibold mb-1">{agent.name}</div>
              <p className="text-[13px] text-text-secondary leading-relaxed mb-5">
                {archived
                  ? "This agent is archived. Restore it to pick up where you left off."
                  : agent.state === "FAILED"
                    ? "This agent failed. Start it to try again."
                    : agent.state === "DELETED"
                      ? "This agent has been deleted."
                      : "This agent is stopped. Start it to chat."}
              </p>
              {archived ? (
                <button
                  onClick={() => onRestore(agent.id)}
                  disabled={busy}
                  className="ui-primary-button disabled:opacity-50"
                >
                  {busy ? "Restoring…" : "Restore agent"}
                </button>
              ) : agent.state === "DELETED" ? null : (
                // Start stays offered for FAILED exactly as the machine allows
                // (agentFsm.allowedFor); a tombstone is commanded by no one.
                <button
                  onClick={() => onStart(agent.id)}
                  disabled={busy}
                  className="ui-primary-button disabled:opacity-50"
                >
                  {busy ? "Starting…" : "Start agent"}
                </button>
              )}
            </div>
          )}

          {isRunning && chat.messages.length === 0 && <div className="pt-16" />}

          {chat.messages.map((message) => {
            const failed = message.role === "assistant" && (message.error || message.text.startsWith("Send failed:"));
            return (
            <div key={message.id} className="message-row" data-role={message.role}>
              {message.role === "assistant" ? (
                <Avatar
                  name={agent.name}
                  url={agent.avatar_url}
                  size={24}
                  color={persona.color}
                  icon={persona.icon}
                />
              ) : (
                <Avatar name="You" size={24} color="var(--you-avatar)" />
              )}
              <div className="min-w-0 flex-1">
                <div className="message-meta">
                  <span className="text-[13px] font-semibold">
                    {message.role === "assistant" ? agent.name : "You"}
                  </span>
                  <span className="text-[10px] text-text-secondary">
                    {formatTime(message.ts)}
                  </span>
                </div>
                <div className={`message-body ${failed ? "message-body-error" : ""}`}>
                  {message.attachments && message.attachments.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {message.attachments.map((attachment, index) =>
                        attachment.mimeType.startsWith("image/") ? (
                          <img
                            key={`${attachment.name}-${index}`}
                            src={`data:${attachment.mimeType};base64,${attachment.dataBase64}`}
                            alt={attachment.name}
                            className="attachment-echo-img"
                          />
                        ) : (
                          <span key={`${attachment.name}-${index}`} className="attachment-chip">
                            <Paperclip size={11} />
                            {attachment.name}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                  {message.thoughts.length > 0 && (
                    <ThinkingBlock thoughts={message.thoughts} />
                  )}
                  {message.plan.length > 0 && <PlanList plan={message.plan} />}
                  {message.toolCalls.map((tool) => (
                    <ToolCallRow key={tool.id} tool={tool} />
                  ))}
                  {message.text && (failed
                    ? <div className="text-[12px] leading-relaxed">{message.text}</div>
                    : <Markdown text={message.text} />)}
                </div>
                <TurnAudioStatus message={message} onStop={chat.stopAudio} onReplay={chat.replayAudio} />
              </div>
            </div>
            );
          })}

          {chat.busy && (
            <div className="message-row">
              <Avatar
                name={agent.name}
                url={agent.avatar_url}
                size={24}
                color={persona.color}
                icon={persona.icon}
              />
              <div className="flex items-center gap-2 text-[12px] text-text-secondary pt-1">
                <Loader2 size={13} className="animate-spin" />
                Working…
              </div>
            </div>
          )}

          {chat.approvals[0] && <ApprovalCard approval={chat.approvals[0]} />}
        </div>
      </div>

      <div className="chat-composer-wrap shrink-0 px-5 pb-4">
        {activeTrace && (
          <div className="mx-auto mb-2 max-w-[520px] text-[11px] text-text-secondary">
            {activeTrace}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-[520px] flex-wrap gap-1.5">
            {attachments.map((attachment, index) => (
              <span key={`${attachment.name}-${index}`} className="attachment-chip">
                <AttachmentGlyph attachment={attachment} />
                <span className="max-w-40 truncate">{attachment.name}</span>
                <button
                  className="attachment-remove"
                  onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {attachError && (
          <div className="mx-auto mb-2 max-w-[520px] text-[11px] text-error">{attachError}</div>
        )}
        <div className="composer relative">
          <button
            className="composer-icon disabled:opacity-40"
            onClick={() => setPlusMenuOpen((open) => !open)}
            disabled={!acceptsAttachments}
            title="More options"
          >
            <Plus size={16} />
          </button>
          {plusMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPlusMenuOpen(false)} />
              <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[180px] rounded-lg border border-border bg-surface py-1 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-foreground/5"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <Paperclip size={14} />
                  Attach file
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-foreground/5"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    mediaInputRef.current?.click();
                  }}
                >
                  <Image size={14} />
                  Attach media
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-foreground/5 disabled:opacity-40"
                  disabled={chat.messages.length === 0}
                  onClick={() => {
                    setPlusMenuOpen(false);
                    exportChatHtml(agent.name, chat.messages);
                  }}
                >
                  <Share2 size={14} />
                  Share this chat
                </button>
              </div>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = event.target.files;
              if (files?.length) void addFiles(files);
              event.target.value = "";
            }}
          />
          <input
            ref={mediaInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            className="hidden"
            onChange={(event) => {
              const files = event.target.files;
              if (files?.length) void addFiles(files);
              event.target.value = "";
            }}
          />
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={(e) => {
              const files = e.clipboardData?.files;
              if (files?.length) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            disabled={!canCompose}
            placeholder={composerPlaceholder}
            className="flex-1 bg-transparent outline-none resize-none text-[13px] py-1 placeholder:text-text-secondary disabled:opacity-60"
          />
          <DictationButton
            disabled={!canCompose || chat.busy}
            onTranscript={(text) => {
              const el = textareaRef.current;
              const selection = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
              setDraft((prev) => {
                const inserted = insertTranscript(prev, text, selection);
                pendingCaretRef.current = inserted.caret;
                return inserted.draft;
              });
            }}
          />
          {chat.busy ? (
            <button
              onClick={chat.cancel}
              title="Stop"
              className="composer-send bg-error"
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!canSend}
              className="composer-send bg-accent"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
