"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Deployments } from "@hypercli.com/sdk/agents";

const RECONNECT_INTERVAL = 10_000;

type ShellStatus = "connected" | "connecting" | "disconnected";

interface UseAgentShellOptions {
  agentId: string | null;
  enabled?: boolean;
  onData?: (data: string) => void;
}

export function useAgentShell(deployments: Deployments | null, { agentId, enabled = true, onData }: UseAgentShellOptions) {
  const [status, setStatus] = useState<ShellStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const connectionIdRef = useRef(0);
  const agentIdRef = useRef(agentId);
  const connectedAgentIdRef = useRef<string | null>(null);
  const enabledRef = useRef(enabled);
  const onDataRef = useRef(onData);

  const cleanup = useCallback(() => {
    connectionIdRef.current += 1;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    connectedAgentIdRef.current = null;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, []);

  const scheduleReconnect = useCallback(() => {
    reconnectTimer.current = setTimeout(() => {
      connectRef.current?.();
    }, RECONNECT_INTERVAL);
  }, []);

  const connect = useCallback(async () => {
    if (!deployments || !agentId || !enabledRef.current) return;

    cleanup();
    const connectionId = connectionIdRef.current + 1;
    connectionIdRef.current = connectionId;
    const requestedAgentId = agentId;
    setStatus("connecting");

    try {
      const ws = await deployments.shellConnect(requestedAgentId);
      if (
        connectionIdRef.current !== connectionId ||
        !enabledRef.current ||
        agentIdRef.current !== requestedAgentId
      ) {
        ws.close();
        return;
      }

      wsRef.current = ws;
      connectedAgentIdRef.current = requestedAgentId;
      setStatus("connected");

      ws.onopen = () => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        if (typeof event.data === "string" && event.data.length > 0) {
          onDataRef.current?.(event.data);
        }
      };

      ws.onclose = () => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        setStatus("disconnected");
        wsRef.current = null;
        connectedAgentIdRef.current = null;
        if (enabledRef.current && agentIdRef.current === requestedAgentId) {
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

  useEffect(() => {
    agentIdRef.current = agentId;
    enabledRef.current = enabled;
    onDataRef.current = onData;
    connectRef.current = connect;
  }, [agentId, connect, enabled, onData]);

  // Send data to the shell
  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && connectedAgentIdRef.current === agentIdRef.current) {
      wsRef.current.send(data);
    }
  }, []);

  // Send resize escape sequence
  const resize = useCallback((rows: number, cols: number) => {
    send(`\x1b[8;${rows};${cols}t`);
  }, [send]);

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
