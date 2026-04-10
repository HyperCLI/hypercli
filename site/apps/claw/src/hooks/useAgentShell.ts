"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useHyperCLI } from "./useHyperCLI";

const RECONNECT_INTERVAL = 10_000;

type ShellStatus = "connected" | "connecting" | "disconnected";

interface UseAgentShellOptions {
  agentId: string | null;
  enabled?: boolean;
  onData?: (data: string) => void;
}

export function useAgentShell({ agentId, enabled = true, onData }: UseAgentShellOptions) {
  const { deployments, ready } = useHyperCLI();
  const [status, setStatus] = useState<ShellStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  const onDataRef = useRef(onData);
  enabledRef.current = enabled;
  onDataRef.current = onData;

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
      const ws = await deployments.shellConnect(agentId);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        const data = typeof event.data === "string" ? event.data : "";
        onDataRef.current?.(data);
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

  // Send data to the shell
  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  // Send resize escape sequence
  const resize = useCallback((rows: number, cols: number) => {
    send(`\x1b[8;${rows};${cols}t`);
  }, [send]);

  useEffect(() => {
    if (ready && enabled && agentId) {
      connect();
    } else {
      cleanup();
    }
    return cleanup;
  }, [ready, enabled, agentId, connect, cleanup]);

  const reconnect = useCallback(() => {
    cleanup();
    connect();
  }, [cleanup, connect]);

  return {
    status,
    send,
    resize,
    reconnect,
  };
}
