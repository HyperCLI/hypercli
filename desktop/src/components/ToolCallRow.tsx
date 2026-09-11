import { useEffect, useState } from "react";
import { Brain, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, XCircle } from "lucide-react";
import type { ChatMessage, ToolCallEntry } from "../useAgentChat";
import { ToolCallDiffs } from "./DiffBlock";

const STATUS_STYLE: Record<string, string> = {
  completed: "text-success",
  failed: "text-error",
  in_progress: "text-warning",
  pending: "text-text-secondary",
};

export function ToolCallRow({ tool }: { tool: ToolCallEntry }) {
  const hasDiffs = Boolean(tool.diffs?.length);
  const [open, setOpen] = useState(tool.status !== "completed" || (Boolean(tool.detail) && !hasDiffs));
  const running = tool.status === "in_progress" || tool.status === "pending";
  const failed = tool.status === "failed";
  useEffect(() => {
    if (tool.status === "completed" && (!tool.detail || hasDiffs)) setOpen(false);
  }, [tool.status, tool.detail, hasDiffs]);
  return (
    <div className={`tool-card tool-trace ${running ? "tool-trace-running" : ""}`}>
      <button
        onClick={() => setOpen(!open)}
        className="relative w-full flex items-center gap-2 px-2.5 py-1.5 text-left overflow-hidden"
      >
        {running && <span className="tool-trace-scan" />}
        {open ? (
          <ChevronDown size={13} className="relative text-text-secondary shrink-0" />
        ) : (
          <ChevronRight size={13} className="relative text-text-secondary shrink-0" />
        )}
        {running ? (
          <CircleDashed size={13} className="relative shrink-0 text-warning animate-spin motion-reduce:animate-none" />
        ) : failed ? (
          <XCircle size={13} className="relative shrink-0 text-error" />
        ) : (
          <CheckCircle2 size={13} className="relative shrink-0 text-success" />
        )}
        <span className="relative text-[12px] font-mono truncate flex-1">{tool.title}</span>
        {tool.durationMs != null && (
          <span className="relative text-[10px] text-text-secondary shrink-0">
            {(tool.durationMs / 1000).toFixed(1)}s
          </span>
        )}
        {!running && (
          <span
            className={`relative text-[10px] font-medium shrink-0 ${STATUS_STYLE[tool.status] ?? "text-text-secondary"}`}
          >
            {tool.status.replace(/_/g, " ")}
          </span>
        )}
      </button>
      {open && tool.detail && (
        <div className="px-2.5 pb-2 pt-0.5">
          <code className="block text-[11px] font-mono text-text-secondary bg-surface rounded px-2 py-1.5 break-all whitespace-pre-wrap">
            {tool.detail}
          </code>
        </div>
      )}
      {hasDiffs && (
        <div className="px-2 pb-2 pt-0.5">
          <ToolCallDiffs diffs={tool.diffs!} />
        </div>
      )}
    </div>
  );
}

export function ThinkingBlock({ thoughts }: { thoughts: string[] }) {
  const [open, setOpen] = useState(false);
  const text = thoughts.join("").trim();
  if (!text) return null;
  return (
    <div className="tool-card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-text-secondary"
      >
        <Brain size={13} className="shrink-0" />
        <span className="text-[12px] flex-1">Thinking</span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="px-3 pb-2.5 text-[12px] text-text-secondary leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

export function PlanList({ plan }: { plan: ChatMessage["plan"] }) {
  if (plan.length === 0) return null;
  return (
    <div className="tool-card px-3 py-2 space-y-1">
      {plan.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-[12px]">
          <span
            className={`status-dot ${
              entry.status === "completed"
                ? "bg-success"
                : entry.status === "in_progress"
                  ? "bg-warning"
                  : "bg-border-strong"
            }`}
          />
          <span
            className={
              entry.status === "completed" ? "text-text-secondary line-through" : ""
            }
          >
            {entry.content}
          </span>
        </div>
      ))}
    </div>
  );
}
