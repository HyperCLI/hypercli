"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useHyperCLI } from "./useHyperCLI";

const MAX_LOG_LINES = 1500;
const RECONNECT_INTERVAL = 15_000;

type LogsStatus = "connected" | "connecting" | "disconnected";

export function useAgentLogs(agentId: string | null, enabled: boolean = true) {
  const { deployments, ready } = useHyperCLI();
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<LogsStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const cleanup = useCallback(() => {
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
    setStatus("disconnected");
  }, []);

  const connect = useCallback(async () => {
    if (!deployments || !agentId || !enabledRef.current) return;

    cleanup();
    setStatus("connecting");

    try {
      const ws = await deployments.logsConnect(agentId);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        const line = typeof event.data === "string" ? event.data : "";
        setLogs((prev) => {
          const next = [...prev, line];
          return next.length > MAX_LOG_LINES ? next.slice(-MAX_LOG_LINES) : next;
        });
      };

      ws.onclose = () => {
        setStatus("disconnected");
        wsRef.current = null;
        if (enabledRef.current) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_INTERVAL);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      setStatus("disconnected");
      if (enabledRef.current) {
        reconnectTimer.current = setTimeout(connect, RECONNECT_INTERVAL);
      }
    }
  }, [deployments, agentId, cleanup]);

  useEffect(() => {
    if (ready && enabled && agentId) {
      connect();
    } else {
      cleanup();
    }
    return cleanup;
  }, [ready, enabled, agentId, connect, cleanup]);

  const clearLogs = useCallback(() => setLogs([]), []);

  const reconnect = useCallback(() => {
    cleanup();
    connect();
  }, [cleanup, connect]);

  return {
    logs,
    status,
    reconnect,
    clearLogs,
  };
}
