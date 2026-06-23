"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import type { Deployments } from "@hypercli.com/sdk/agents";

const MAX_LOG_LINES = 1500;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000];
const RECONNECT_JITTER = 0.2;
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

function shouldReconnectClose(event: CloseEvent): boolean {
  if (LOGS_CLOSE_CODES.has(event.code)) return false;
  if (event.reason && logCloseReason(event.reason)) return false;
  return true;
}

export function useAgentLogs(deployments: Deployments | null, agentId: string | null, enabled: boolean = true) {
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<LogsStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<((options?: ConnectOptions) => void) | null>(null);
  const connectionIdRef = useRef(0);
  const agentIdRef = useRef(agentId);
  const enabledRef = useRef(enabled);
  const reconnectAttemptRef = useRef(0);

  const cleanup = useCallback((options: CleanupOptions = {}) => {
    const { resetReconnect = true } = options;
    connectionIdRef.current += 1;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (resetReconnect) reconnectAttemptRef.current = 0;
    setStatus("disconnected");
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
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

    cleanup({ resetReconnect: false });
    const connectionId = connectionIdRef.current + 1;
    connectionIdRef.current = connectionId;
    const requestedAgentId = agentId;
    setLogs([]);
    setStatus(options.reconnecting ? "reconnecting" : "connecting");

    try {
      const ws = await deployments.logsConnect(requestedAgentId);
      if (
        connectionIdRef.current !== connectionId ||
        !enabledRef.current ||
        agentIdRef.current !== requestedAgentId
      ) {
        ws.close();
        return;
      }

      wsRef.current = ws;
      reconnectAttemptRef.current = 0;
      setStatus("connected");

      ws.onopen = () => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        const line = typeof event.data === "string" ? event.data : "";
        setLogs((prev) => {
          const next = [...prev, line];
          return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
        });
      };

      ws.onclose = (event) => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        setStatus("disconnected");
        wsRef.current = null;
        if (enabledRef.current && agentIdRef.current === requestedAgentId && shouldReconnectClose(event)) {
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        ws.close();
      };
    } catch {
      if (connectionIdRef.current !== connectionId) return;
      setStatus("disconnected");
      if (enabledRef.current && agentIdRef.current === requestedAgentId) {
        scheduleReconnect();
      }
    }
  }, [deployments, agentId, cleanup, scheduleReconnect]);

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

  const clearLogs = useCallback(() => setLogs([]), []);

  const reconnect = useCallback(() => {
    cleanup();
    reconnectAttemptRef.current = 0;
    connect();
  }, [cleanup, connect]);

  return {
    logs,
    status,
    reconnect,
    clearLogs,
  };
}
