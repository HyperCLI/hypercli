import { useCallback, useEffect, useMemo, useState } from "react";
import { agentLogsToken, type AgentSummary } from "./api";

type Phase = "idle" | "connecting" | "connected" | "closed" | "error";

interface LogFrame {
  event?: string;
  log?: string;
  detail?: string;
}

function logsWsBase(apiBase: string) {
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/agents$/, "").replace(/\/api$/, "");
  return `${url.toString().replace(/\/+$/, "")}/ws`;
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

    agentLogsToken(agentId)
      .then((token) => {
        if (!alive) return;
        const wsUrl = token.ws_url ?? `${logsWsBase(token.api_base ?? window.location.origin)}/logs/${agentId}`;
        const url = new URL(wsUrl);
        url.searchParams.set("jwt", token.jwt);
        url.searchParams.set("container", "reef");
        url.searchParams.set("tail_lines", "0");
        ws = new WebSocket(url.toString());
        ws.onopen = () => alive && setPhase("connected");
        ws.onmessage = (event) => {
          if (!alive || typeof event.data !== "string" || !event.data) return;
          try {
            const line = parseLog(event.data);
            if (line) setLines((prev) => [...prev, line].slice(-1000));
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
      })
      .catch((e) => {
        if (!alive) return;
        const message = e instanceof Error ? e.message : String(e);
        if (/\b409\b/.test(message)) {
          setPhase("closed");
          return;
        }
        setError(message);
        setPhase("error");
      });

    return () => {
      alive = false;
      ws?.close();
    };
  }, [agentId, enabled, nonce]);

  return useMemo(() => ({ phase, lines, error, retry, clear }), [phase, lines, error, retry, clear]);
}
