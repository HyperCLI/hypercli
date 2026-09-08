import { useCallback, useEffect, useMemo, useState } from "react";
import { agentLogsUrl, type AgentSummary } from "./api";

type Phase = "idle" | "connecting" | "connected" | "closed" | "error";

const MAX_LOG_LINES = 10_000;
const MAX_LOG_LINE_CHARS = 4096;
const MAX_LOG_TOTAL_CHARS = 32_000_000;

interface LogFrame {
  event?: string;
  log?: string;
  detail?: string;
}

function parseLog(raw: string) {
  try {
    const frame = JSON.parse(raw) as LogFrame;
    if (frame.event === "log") return frame.log ?? "";
    if (frame.event === "error") throw new Error(frame.detail || "Log stream failed");
    return null;
  } catch (e) {
    if (e instanceof SyntaxError) return raw;
    throw e;
  }
}

function boundedLogLines(current: string[], pending: string[]) {
  const combined = [...current, ...pending.map((line) => (
    line.length > MAX_LOG_LINE_CHARS ? line.slice(-MAX_LOG_LINE_CHARS) : line
  ))];
  let start = combined.length;
  let chars = 0;
  while (start > 0 && combined.length - start < MAX_LOG_LINES) {
    const nextLength = combined[start - 1].length;
    if (chars + nextLength > MAX_LOG_TOTAL_CHARS) break;
    chars += nextLength;
    start -= 1;
  }
  return combined.slice(start);
}

export function useAgentLogs(agent: AgentSummary | null, enabled: boolean) {
  const agentId = agent?.id ?? null;
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce((value) => value + 1), []);
  const clear = useCallback(() => setLines([]), []);

  useEffect(() => {
    if (!agentId || !enabled) {
      setPhase("idle");
      setLines([]);
      setError(null);
      return;
    }
    let alive = true;
    let ws: WebSocket | null = null;
    setPhase("connecting");
    setError(null);

    const open = async () => {
      try {
        ws = new WebSocket(await agentLogsUrl(agentId));
        ws.onopen = () => alive && setPhase("connected");
        ws.onmessage = (event) => {
          if (!alive || typeof event.data !== "string" || !event.data) return;
          try {
            const line = parseLog(event.data);
          if (line) setLines((prev) => boundedLogLines(prev, [line]));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setPhase("error");
          }
        };
        ws.onerror = () => {
          if (!alive) return;
          setError("Log stream failed");
          setPhase("error");
        };
        ws.onclose = () => alive && setPhase((current) => (current === "error" ? "error" : "closed"));
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    };
    void open();

    return () => {
      alive = false;
      ws?.close();
    };
  }, [agentId, enabled, nonce]);

  return useMemo(() => ({ phase, lines, error, retry, clear }), [phase, lines, error, retry, clear]);
}
