"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import type { Deployments } from "@hypercli.com/sdk/agents";

// Mirror the Backend's bounds rather than picking smaller ones, so the panel
// never discards history the server was willing to send: it retains 10_000
// lines, truncates a single line at 4096 chars, and caps the whole buffer at
// 32MB. Trimming to 1500 here silently threw away most of the replay we now
// ask for in full, which defeated the point of asking.
//
// Per-line and whole-buffer are separate bounds. Sharing one constant for both
// meant raising the buffer ceiling would also let a single line grow to it.
const MAX_LOG_LINES = 10_000;
const MAX_LOG_LINE_CHARS = 4096;
const MAX_LOG_TOTAL_CHARS = 32_000_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000];
const RECONNECT_JITTER = 0.2;
const LOG_PUBLICATION_INTERVAL_MS = 32;
const LOGS_CLOSE_CODES = new Set([1000, 1008, 4001, 4003, 4004, 4401, 4403, 4404]);

export type LogsStatus = "connected" | "connecting" | "reconnecting" | "disconnected";

type ConnectOptions = {
  reconnecting?: boolean;
};

type CleanupOptions = {
  resetReconnect?: boolean;
};

function reconnectDelay(attempt: number): number {
  const baseDelay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
  const jitter = baseDelay * RECONNECT_JITTER * Math.random();
  return Math.round(baseDelay + jitter);
}

function logCloseReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return [
    "unauthorized",
    "forbidden",
    "not found",
    "deleted",
    "stopped",
    "normal",
    "exited",
    "policy",
  ].some((value) => normalized.includes(value));
}

function shouldReconnectClose(event: { code: number; reason: string }): boolean {
  if (LOGS_CLOSE_CODES.has(event.code)) return false;
  if (event.reason && logCloseReason(event.reason)) return false;
  return true;
}

function boundedLogLines(current: string[], pending: string[]): string[] {
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

export function useAgentLogs(deployments: Deployments | null, agentId: string | null, enabled: boolean = true) {
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<LogsStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<((options?: ConnectOptions) => void) | null>(null);
  const connectionIdRef = useRef(0);
  const agentIdRef = useRef(agentId);
  const enabledRef = useRef(enabled);
  const reconnectAttemptRef = useRef(0);
  const pendingLogsRef = useRef<string[]>([]);
  const logPublicationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingLogs = useCallback(() => {
    if (logPublicationTimerRef.current) {
      clearTimeout(logPublicationTimerRef.current);
      logPublicationTimerRef.current = null;
    }
    pendingLogsRef.current = [];
  }, []);

  const flushPendingLogs = useCallback(() => {
    if (logPublicationTimerRef.current) {
      clearTimeout(logPublicationTimerRef.current);
      logPublicationTimerRef.current = null;
    }
    if (pendingLogsRef.current.length === 0) return;
    const pending = pendingLogsRef.current;
    pendingLogsRef.current = [];
    setLogs((current) => boundedLogLines(current, pending));
  }, []);

  const queueLog = useCallback((line: string) => {
    pendingLogsRef.current.push(line);
    if (logPublicationTimerRef.current) return;
    logPublicationTimerRef.current = setTimeout(flushPendingLogs, LOG_PUBLICATION_INTERVAL_MS);
  }, [flushPendingLogs]);

  const cleanup = useCallback((options: CleanupOptions = {}) => {
    const { resetReconnect = true } = options;
    connectionIdRef.current += 1;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    clearPendingLogs();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (resetReconnect) reconnectAttemptRef.current = 0;
    setStatus("disconnected");
  }, [clearPendingLogs]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      setStatus("disconnected");
      return;
    }
    const attempt = reconnectAttemptRef.current;
    reconnectAttemptRef.current += 1;
    setStatus("reconnecting");
    reconnectTimer.current = setTimeout(() => {
      connectRef.current?.({ reconnecting: true });
    }, reconnectDelay(attempt));
  }, []);

  const connect = useCallback(async (options: ConnectOptions = {}) => {
    if (!deployments || !agentId || !enabledRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

    cleanup({ resetReconnect: false });
    const connectionId = connectionIdRef.current + 1;
    connectionIdRef.current = connectionId;
    const requestedAgentId = agentId;
    setLogs([]);
    setError(null);
    setStatus(options.reconnecting ? "reconnecting" : "connecting");

    const controller = new AbortController();
    abortRef.current = controller;
    // The socket is live for the whole subscription, so a close arriving through
    // subscribeLogs still has to be told apart from a mint that never opened one.
    let sawClose: { code: number; reason: string } | null = null;
    const current = () =>
      connectionIdRef.current === connectionId &&
      enabledRef.current &&
      agentIdRef.current === requestedAgentId;

    try {
      await deployments.subscribeLogs(requestedAgentId, (line) => {
        if (!current()) return;
        queueLog(line);
      }, {
        // Ask for the whole retained buffer, not a window. The connect replay
        // is the Backend's live buffer when it has one and the persisted rows
        // when it does not, so 0 yields whichever is fuller -- and the reason
        // anyone opens this panel is usually a traceback, which a hundred-line
        // tail truncates exactly when it matters. Bounded server-side by
        // LOG_BUFFER_MAX_LINES.
        tailLines: 0,
        signal: controller.signal,
        onReady: () => {
          if (!current()) return;
          reconnectAttemptRef.current = 0;
          setStatus("connected");
        },
        onClose: (event) => {
          sawClose = event;
        },
      });
      if (!current()) return;
      flushPendingLogs();
      setStatus("disconnected");
      // A resolved subscription that never saw a close was aborted by us.
      if (sawClose && shouldReconnectClose(sawClose)) scheduleReconnect();
    } catch (err) {
      if (!current()) return;
      flushPendingLogs();
      // An `error` frame is a stream fault the user should see; a failed mint or
      // transport is not, and only drives the reconnect ladder.
      if (sawClose === null) setError(err instanceof Error ? err.message : "Log stream failed");
      setStatus("disconnected");
      if (!sawClose || shouldReconnectClose(sawClose)) scheduleReconnect();
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [deployments, agentId, cleanup, flushPendingLogs, queueLog, scheduleReconnect]);

  useLayoutEffect(() => {
    agentIdRef.current = agentId;
    enabledRef.current = enabled;
    connectRef.current = connect;
  }, [agentId, connect, enabled]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (deployments && enabled && agentId) {
        void connect();
      } else {
        cleanup();
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [deployments, enabled, agentId, connect, cleanup]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        cleanup({ resetReconnect: false });
      } else if (enabledRef.current && agentIdRef.current) {
        connectRef.current?.({ reconnecting: true });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [cleanup]);

  const clearLogs = useCallback(() => setLogs([]), []);

  const reconnect = useCallback(() => {
    cleanup();
    reconnectAttemptRef.current = 0;
    connect();
  }, [cleanup, connect]);

  return {
    logs,
    status,
    error,
    reconnect,
    clearLogs,
  };
}
