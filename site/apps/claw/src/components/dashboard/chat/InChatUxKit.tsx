"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  ChevronDown,
  Clipboard,
  Code2,
  Copy,
  Database,
  Download,
  Edit3,
  FileCode2,
  FileText,
  Globe,
  History,
  Link,
  Loader2,
  Mic2,
  Pause,
  Pin,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  UploadCloud,
  WifiOff,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

import { ApprovalCard } from "./ApprovalCard";
import { ChatCard, type ChatCardTone } from "./ChatCard";
import { ToolCallStack } from "./ToolCallStack";

type ActionKind = "command" | "file" | "browser" | "api" | "database";
type ActionStatus = "queued" | "running" | "done" | "failed";

const ACTION_META: Record<ActionKind, { icon: LucideIcon; tone: ChatCardTone; label: string }> = {
  command: { icon: Terminal, tone: "warning", label: "Command" },
  file: { icon: FileCode2, tone: "primary", label: "File" },
  browser: { icon: Globe, tone: "info", label: "Browser" },
  api: { icon: Link, tone: "info", label: "API" },
  database: { icon: Database, tone: "warning", label: "Database" },
};

const STATUS_TONE: Record<ActionStatus, ChatCardTone> = {
  queued: "neutral",
  running: "warning",
  done: "primary",
  failed: "danger",
};

export function ActionCard({
  kind,
  title,
  subtitle,
  status,
  details,
  preview,
}: {
  kind: ActionKind;
  title: string;
  subtitle?: string;
  status: ActionStatus;
  details?: Array<{ label: string; value: string }>;
  preview?: string;
}) {
  const meta = ACTION_META[kind];
  const Icon = meta.icon;

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <ChatCard
        tone={STATUS_TONE[status] ?? meta.tone}
        icon={Icon}
        title={title}
        subtitle={subtitle ?? meta.label}
        status={{ label: status, tone: STATUS_TONE[status] }}
        collapsible
        defaultOpen={status === "running" || status === "failed"}
      >
        <div className="space-y-2">
          {details && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
              {details.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-[10px] uppercase tracking-wide text-text-muted">{row.label}</dt>
                  <dd className="truncate font-mono text-[11px] text-text-secondary">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {preview && (
            <pre className="max-h-36 overflow-auto rounded border border-white/8 bg-background/70 px-2.5 py-2 font-mono text-[11px] leading-5 text-text-secondary">
              {preview}
            </pre>
          )}
        </div>
      </ChatCard>
    </motion.div>
  );
}

export function ToolTimelineCard({
  steps,
}: {
  steps: Array<{ name: string; detail: string; state: ActionStatus }>;
}) {
  return (
    <ChatCard
      tone="info"
      icon={History}
      title={`${steps.length} tool steps`}
      subtitle="Collapsed execution timeline"
      status={{ label: `${steps.filter((step) => step.state === "done").length}/${steps.length} done`, tone: "info" }}
      collapsible
      defaultOpen={false}
    >
      <div className="space-y-0">
        {steps.map((step, index) => {
          const pending = step.state === "running";
          const failed = step.state === "failed";
          return (
            <motion.div
              key={`${step.name}-${index}`}
              className="grid grid-cols-[18px_1fr] gap-2 pb-3 last:pb-0"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.04 }}
            >
              <div className="relative flex justify-center">
                <span className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border ${
                  failed ? "border-[#d05f5f]/40 bg-[#d05f5f]/15 text-[#d05f5f]" :
                  pending ? "border-[#f0c56c]/40 bg-[#f0c56c]/15 text-[#f0c56c]" :
                  "border-[#38D39F]/40 bg-[#38D39F]/15 text-[#38D39F]"
                }`}>
                  {pending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : failed ? <X className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5" />}
                </span>
                {index < steps.length - 1 && <span className="absolute top-5 h-[calc(100%-1rem)] w-px bg-white/10" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">{step.name}</p>
                <p className="truncate text-[11px] text-text-muted">{step.detail}</p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </ChatCard>
  );
}

export function FileResultCard({
  path,
  change,
  lines,
  preview,
}: {
  path: string;
  change: "created" | "modified" | "deleted";
  lines?: { added: number; removed: number };
  preview?: string;
}) {
  const tone: ChatCardTone = change === "deleted" ? "danger" : change === "created" ? "primary" : "info";
  return (
    <ChatCard
      tone={tone}
      icon={FileText}
      title={path}
      subtitle={lines ? `+${lines.added} / -${lines.removed}` : change}
      status={{ label: change, tone }}
      collapsible
      defaultOpen={Boolean(preview)}
      actions={
        <>
          <button className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs text-text-secondary hover:text-foreground">
            <Code2 className="h-3 w-3" />
            Open
          </button>
          <button className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs text-text-secondary hover:text-foreground">
            <Copy className="h-3 w-3" />
            Copy path
          </button>
        </>
      }
    >
      {preview && (
        <pre className="max-h-32 overflow-auto rounded border border-white/8 bg-background/70 px-2.5 py-2 font-mono text-[11px] leading-5 text-text-secondary">
          {preview}
        </pre>
      )}
    </ChatCard>
  );
}

export function MessageToolbar({
  onCopy,
  onRetry,
  onEdit,
  onDelete,
  onPin,
}: {
  onCopy?: () => void;
  onRetry?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
}) {
  const actions = [
    { label: "Copy", icon: Copy, onClick: onCopy },
    { label: "Retry", icon: RefreshCw, onClick: onRetry },
    { label: "Edit", icon: Edit3, onClick: onEdit },
    { label: "Pin", icon: Pin, onClick: onPin },
    { label: "Delete", icon: Trash2, onClick: onDelete, danger: true },
  ];

  return (
    <div className="inline-flex items-center rounded-lg border border-white/10 bg-background/80 p-1 shadow-lg">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
              action.danger ? "text-text-muted hover:bg-[#d05f5f]/10 hover:text-[#d05f5f]" : "text-text-muted hover:bg-white/[0.06] hover:text-foreground"
            }`}
            title={action.label}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}

export function StopGenerationButton({
  runningLabel = "Agent is running tools",
  onStop,
}: {
  runningLabel?: string;
  onStop?: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onStop}
      className="inline-flex items-center gap-2 rounded-full border border-[#d05f5f]/30 bg-[#d05f5f]/10 px-3 py-1.5 text-xs font-medium text-[#d05f5f] hover:bg-[#d05f5f]/20"
      animate={{ boxShadow: ["0 0 0 rgba(208,95,95,0)", "0 0 18px rgba(208,95,95,0.2)", "0 0 0 rgba(208,95,95,0)"] }}
      transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
    >
      <Square className="h-3 w-3" />
      Stop
      <span className="hidden text-text-muted sm:inline">{runningLabel}</span>
    </motion.button>
  );
}

export function RetryToolCard({
  toolName,
  error,
  onRetry,
}: {
  toolName: string;
  error: string;
  onRetry?: () => void;
}) {
  return (
    <ChatCard
      tone="danger"
      icon={AlertTriangle}
      title={`${toolName} failed`}
      subtitle={error}
      status={{ label: "Retry available", tone: "danger" }}
      actions={
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#d05f5f]/35 bg-[#d05f5f]/10 px-3 py-1 text-xs font-medium text-[#d05f5f] hover:bg-[#d05f5f]/20"
        >
          <RefreshCw className="h-3 w-3" />
          Retry tool
        </button>
      }
    />
  );
}

export function ConnectionRecoveryCard({
  state,
  onReconnect,
}: {
  state: "disconnected" | "reconnecting" | "connected";
  onReconnect?: () => void;
}) {
  const reconnecting = state === "reconnecting";
  const connected = state === "connected";
  return (
    <ChatCard
      tone={connected ? "primary" : reconnecting ? "warning" : "danger"}
      icon={connected ? Check : reconnecting ? Loader2 : WifiOff}
      title={connected ? "Gateway connected" : reconnecting ? "Reconnecting gateway" : "Gateway disconnected"}
      subtitle={connected ? "Messages and tool events are live." : "The session is temporarily unavailable."}
      status={{ label: connected ? "Online" : reconnecting ? "Retrying" : "Offline", tone: connected ? "primary" : reconnecting ? "warning" : "danger" }}
      actions={!connected && (
        <button
          type="button"
          onClick={onReconnect}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1 text-xs font-medium text-text-secondary hover:text-foreground"
        >
          {reconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Reconnect
        </button>
      )}
    />
  );
}

export function CommandPaletteCard({
  commands,
}: {
  commands: Array<{ command: string; description: string; icon?: LucideIcon }>;
}) {
  const [selected, setSelected] = useState(0);
  return (
    <div className="rounded-lg border border-white/10 bg-background/80 shadow-xl">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <Search className="h-3.5 w-3.5 text-text-muted" />
        <span className="text-xs text-text-secondary">/ command palette</span>
      </div>
      <div className="p-1.5">
        {commands.map((command, index) => {
          const Icon = command.icon ?? Wrench;
          return (
            <button
              key={command.command}
              type="button"
              onClick={() => setSelected(index)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                selected === index ? "bg-[#38D39F]/10 text-foreground" : "text-text-secondary hover:bg-white/[0.04]"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-[#38D39F]" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium">{command.command}</span>
                <span className="block truncate text-[11px] text-text-muted">{command.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PromptChips({
  prompts,
  onSelect,
}: {
  prompts: string[];
  onSelect?: (prompt: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {prompts.map((prompt, index) => (
        <motion.button
          key={prompt}
          type="button"
          onClick={() => onSelect?.(prompt)}
          className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-text-secondary hover:border-[#38D39F]/35 hover:bg-[#38D39F]/10 hover:text-[#38D39F]"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.035 }}
        >
          {prompt}
        </motion.button>
      ))}
    </div>
  );
}

export function UploadProgressCard({
  files,
}: {
  files: Array<{ name: string; progress: number; status: "uploading" | "done" | "failed" }>;
}) {
  return (
    <ChatCard tone="info" icon={UploadCloud} title="Uploading files" subtitle={`${files.length} queued`} status={{ label: "Active", tone: "info" }}>
      <div className="space-y-2">
        {files.map((file) => (
          <div key={file.name} className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-xs text-foreground">{file.name}</span>
              <span className="text-[10px] text-text-muted">{file.status === "done" ? "Done" : file.status === "failed" ? "Failed" : `${file.progress}%`}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div
                className={file.status === "failed" ? "h-full bg-[#d05f5f]" : "h-full bg-[#38D39F]"}
                initial={false}
                animate={{ width: `${file.progress}%` }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              />
            </div>
          </div>
        ))}
      </div>
    </ChatCard>
  );
}

export function AudioMessageBubble({
  title,
  duration,
  transcript,
}: {
  title: string;
  duration: string;
  transcript?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const bars = useMemo(() => Array.from({ length: 28 }, (_, index) => 8 + ((index * 7) % 18)), []);
  return (
    <div className="max-w-md rounded-2xl border border-white/10 bg-surface-low px-3 py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#38D39F]/15 text-[#38D39F] hover:bg-[#38D39F]/25"
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-xs font-medium text-foreground">{title}</p>
            <span className="font-mono text-[11px] text-text-muted">{duration}</span>
          </div>
          <div className="mt-1 flex h-7 items-center gap-0.5">
            {bars.map((height, index) => (
              <motion.span
                key={index}
                className="w-1 rounded-full bg-[#38D39F]/55"
                animate={playing ? { height: [height, Math.max(4, height - 5), height] } : { height }}
                transition={playing ? { repeat: Infinity, duration: 0.9, delay: index * 0.015 } : { duration: 0.15 }}
              />
            ))}
          </div>
        </div>
      </div>
      {transcript && <p className="mt-2 line-clamp-2 text-xs text-text-muted">{transcript}</p>}
    </div>
  );
}

export function ChatSearchJump({
  query,
  current,
  total,
}: {
  query: string;
  current: number;
  total: number;
}) {
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-background/85 px-2 py-1.5 shadow-lg">
      <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      <span className="truncate text-xs text-text-secondary">{query}</span>
      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-text-muted">{current}/{total}</span>
      <button type="button" className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted hover:bg-white/[0.06] hover:text-foreground" title="Previous result">
        <ArrowDown className="h-3 w-3 rotate-180" />
      </button>
      <button type="button" className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted hover:bg-white/[0.06] hover:text-foreground" title="Next result">
        <ArrowDown className="h-3 w-3" />
      </button>
    </div>
  );
}

export function LongOutputViewer({
  title,
  output,
}: {
  title: string;
  output: string;
}) {
  const [wrap, setWrap] = useState(true);
  const [open, setOpen] = useState(false);
  const lines = output.split("\n");
  return (
    <div className="overflow-hidden rounded-md border border-white/10 bg-background/70">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.04]"
      >
        <ChevronDown className={`h-3.5 w-3.5 text-text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
        <Terminal className="h-3.5 w-3.5 text-[#f0c56c]" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{title}</span>
        <span className="text-[10px] text-text-muted">{lines.length} lines</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-white/10"
          >
            <div className="flex items-center justify-end gap-2 px-3 py-1.5">
              <button type="button" onClick={() => setWrap((value) => !value)} className="text-[11px] text-text-muted hover:text-foreground">
                {wrap ? "No wrap" : "Wrap"}
              </button>
              <button type="button" className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-foreground">
                <Download className="h-3 w-3" />
                Download
              </button>
            </div>
            <pre className={`max-h-64 overflow-auto bg-black/20 px-3 py-2 font-mono text-[11px] leading-5 text-text-secondary ${wrap ? "whitespace-pre-wrap" : "whitespace-pre"}`}>
              {lines.map((line, index) => `${String(index + 1).padStart(3, " ")}  ${line}`).join("\n")}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SessionSummaryCard({
  title,
  summary,
  changedFiles,
  blockers,
}: {
  title: string;
  summary: string[];
  changedFiles: string[];
  blockers?: string[];
}) {
  return (
    <ChatCard
      tone="primary"
      icon={Clipboard}
      title={title}
      subtitle={`${changedFiles.length} files changed`}
      status={{ label: blockers?.length ? "Needs review" : "Current", tone: blockers?.length ? "warning" : "primary" }}
      collapsible
      defaultOpen
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">Summary</p>
          <ul className="space-y-1">
            {summary.map((item) => <li key={item} className="text-xs text-text-secondary">{item}</li>)}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">Changed Files</p>
          <div className="flex flex-wrap gap-1.5">
            {changedFiles.map((file) => (
              <span key={file} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-text-secondary">
                {file}
              </span>
            ))}
          </div>
          {blockers && blockers.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">Blockers</p>
              <ul className="space-y-1">
                {blockers.map((item) => <li key={item} className="text-xs text-[#f0c56c]">{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </ChatCard>
  );
}

export function InChatUxKitDemo() {
  const sampleToolCalls = [
    { id: "read", name: "Read", args: '{"path":"src/app.ts"}', result: "Loaded 240 lines." },
    { id: "edit", name: "Edit", args: '{"path":"src/app.ts"}', result: "Patch applied." },
    { id: "test", name: "Test", args: '{"command":"npm test"}', result: "12 passed." },
    { id: "lint", name: "Lint", args: '{"command":"npm run lint"}' },
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 pb-10">
      <div>
        <p className="text-xs uppercase tracking-wide text-text-muted">In-chat UX kit</p>
        <h2 className="mt-1 text-lg font-semibold text-foreground">Interactive states for agent workflows</h2>
      </div>

      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Action cards and approval</p>
        <ActionCard
          kind="command"
          title="Run typecheck"
          subtitle="npm --prefix site/apps/claw run typecheck"
          status="running"
          details={[
            { label: "cwd", value: "site/apps/claw" },
            { label: "pid", value: "dev-2418" },
          ]}
          preview="> tsc --noEmit\nChecking project references..."
        />
        <ApprovalCard
          approvalId="approval-dev"
          action="Modify workspace files"
          summary="Apply patch to chat components"
          risk="medium"
          details={[
            { label: "Scope", value: "site/apps/claw/src/components/dashboard/chat" },
            { label: "Reason", value: "Add interactive UX cards" },
          ]}
          preview="*** Update File: ToolCallStack.tsx"
        />
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Tool flow and files</p>
        <ToolCallStack toolCalls={sampleToolCalls} themeVariant="v2" isStreaming />
        <ToolTimelineCard
          steps={[
            { name: "Read files", detail: "Inspect chat renderers", state: "done" },
            { name: "Patch components", detail: "Create cards and dev route", state: "done" },
            { name: "Run checks", detail: "Vitest and TypeScript", state: "running" },
          ]}
        />
        <FileResultCard
          path="src/components/dashboard/chat/InChatUxKit.tsx"
          change="created"
          lines={{ added: 540, removed: 0 }}
          preview={'export function SessionSummaryCard() {\n  return <ChatCard tone="primary" />;\n}'}
        />
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Recovery and control</p>
        <div className="flex flex-wrap items-center gap-3">
          <MessageToolbar />
          <StopGenerationButton />
          <ChatSearchJump query="gateway reconnect" current={2} total={7} />
        </div>
        <RetryToolCard toolName="Bash" error="Command exited with status 1" />
        <ConnectionRecoveryCard state="reconnecting" />
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Composer helpers</p>
        <CommandPaletteCard
          commands={[
            { command: "/fix", description: "Inspect failing output and prepare a patch", icon: Wrench },
            { command: "/summarize", description: "Summarize the current thread", icon: Clipboard },
            { command: "/ship", description: "Run checks and prepare handoff", icon: Send },
          ]}
        />
        <PromptChips
          prompts={[
            "Run the tests",
            "Open changed files",
            "Summarize what changed",
            "Create a rollback plan",
          ]}
        />
      </section>

      <section className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Media, uploads, and output</p>
        <AudioMessageBubble
          title="Voice note"
          duration="0:18"
          transcript="The build failed after the route import changed. Check the chat module exports first."
        />
        <UploadProgressCard
          files={[
            { name: "screenshot.png", progress: 74, status: "uploading" },
            { name: "trace.har", progress: 100, status: "done" },
            { name: "large-video.mov", progress: 18, status: "failed" },
          ]}
        />
        <LongOutputViewer
          title="npm run lint"
          output={[
            "> eslint src/components/dashboard/chat",
            "ToolCallStack.tsx: ok",
            "InChatUxKit.tsx: ok",
            "ChatMessage.tsx: warning no-img-element",
            "Completed with warnings.",
          ].join("\n")}
        />
      </section>

      <SessionSummaryCard
        title="Session summary"
        summary={[
          "Added stack behavior for tool-call bursts.",
          "Created reusable cards for recovery, files, output, and composer helpers.",
          "Mounted the kit on the dashboard dev chat route.",
        ]}
        changedFiles={[
          "chat/InChatUxKit.tsx",
          "chat/ToolCallStack.tsx",
          "dashboard/dev/chat/page.tsx",
        ]}
        blockers={["Wire live gateway approval events into ApprovalCard."]}
      />
    </div>
  );
}
