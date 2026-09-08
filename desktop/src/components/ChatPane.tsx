import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Loader2,
  Mic,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  Share2,
  Square,
} from "lucide-react";
import type { AgentSummary } from "../api";
import type { AgentChat, ChatMessage } from "../useAgentChat";
import { usePersona } from "../personas";
import { Avatar } from "./Avatar";
import { Markdown } from "./Markdown";
import { PlanList, ThinkingBlock, ToolCallRow } from "./ToolCallRow";
import { ApprovalCard } from "./ApprovalCard";
import { RUNNING, TRANSITIONAL, runtimeFamily } from "../agent-utils";
import { canRuntimeChat } from "../runtime-client";

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
  lifecycleError,
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
  lifecycleError: string | null;
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
  const [now, setNow] = useState(Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const approvalCount = chat.approvals.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.busy, approvalCount]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, [draft]);

  useEffect(() => {
    if (!chat.busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [chat.busy]);

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
      <PanelRightOpen size={15} />
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
  const canSend = canCompose && draft.trim().length > 0 && !chat.busy;
  const composerPlaceholder = chat.phase === "ready"
    ? `Message ${agent.name}…`
    : isRunning && runtimeCanChat
      ? "Preparing chat…"
      : isRunning && family === "hermes"
        ? "Hermes chat is coming next…"
      : "Start the agent to chat…";

  const submit = () => {
    if (!canSend) return;
    chat.send(draft);
    setDraft("");
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
    <section className="app-main">
      <header className="app-header">
        <div data-tauri-drag-region className="drag-fill" />
        <div className="app-header-content px-5 gap-3">
          {reopenLeft}
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
              <span className="text-[11px] text-text-secondary truncate">
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
            ) : (
              <>
                <span className="status-dot bg-text-secondary/50" />
                Stopped
              </>
            )}
          </span>
          <button
            onClick={() => exportChatHtml(agent.name, chat.messages)}
            disabled={chat.messages.length === 0}
            className="ui-icon-button-sm shrink-0 disabled:opacity-40"
            title="Export chat as HTML"
          >
            <Share2 size={14} />
          </button>
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
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-[640px] px-5 py-6 space-y-6">
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

          {lifecycleError && (
            <div className="mx-auto max-w-[460px] rounded-lg border border-error/40 bg-error-bg px-4 py-3 text-[12px] text-error">
              <div className="font-medium">Agent action failed</div>
              <div className="mt-1 space-y-0.5 leading-relaxed">
                {lifecycleError.split(/\n|;\s+/).filter(Boolean).map((line, index) => (
                  <div key={index}>{line}</div>
                ))}
              </div>
              <button
                onClick={onOpenLogs}
                className="mt-2 rounded-md border border-error/50 px-2.5 py-1 text-[11px] font-medium hover:bg-error/10 transition-colors"
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
                  : family === "acp"
                    ? "This agent is stopped. Start it to chat."
                    : "This agent is stopped. Start it to chat."}
              </p>
              {archived ? (
                <button
                  onClick={() => onRestore(agent.id)}
                  className="ui-primary-button"
                >
                  Restore agent
                </button>
              ) : (
                <button
                  onClick={() => onStart(agent.id)}
                  className="ui-primary-button"
                >
                  Start agent
                </button>
              )}
            </div>
          )}

          {isRunning && chat.messages.length === 0 && <div className="pt-16" />}

          {chat.messages.map((message) => {
            const failed = message.role === "assistant" && (message.error || message.text.startsWith("Send failed:"));
            return (
            <div key={message.id} className="message-row">
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
                <div className={`message-body ${message.role === "user" ? "message-body-user" : failed ? "message-body-error" : ""}`}>
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

      <div className="shrink-0 px-5 pb-4">
        {activeTrace && (
          <div className="mx-auto mb-2 max-w-[520px] text-[11px] text-text-secondary">
            {activeTrace}
          </div>
        )}
        <div className="composer">
          <button className="composer-icon">
            <Plus size={16} />
          </button>
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
            disabled={!canCompose}
            placeholder={composerPlaceholder}
            className="flex-1 bg-transparent outline-none resize-none text-[13px] py-1 placeholder:text-text-secondary disabled:opacity-60"
          />
          <button className="composer-icon">
            <Mic size={16} />
          </button>
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
