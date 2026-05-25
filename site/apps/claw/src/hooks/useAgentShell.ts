"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Deployments } from "@hypercli.com/sdk/agents";

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000];
const RECONNECT_JITTER = 0.2;
const TERMINAL_CLOSE_CODES = new Set([1000, 1008, 4001, 4003, 4004, 4401, 4403, 4404]);

export type ShellStatus = "connected" | "connecting" | "reconnecting" | "disconnected";

interface UseAgentShellOptions {
  agentId: string | null;
  enabled?: boolean;
  onData?: (data: string) => void;
}

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

function terminalCloseReason(reason: string): boolean {
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
  if (TERMINAL_CLOSE_CODES.has(event.code)) return false;
  if (event.reason && terminalCloseReason(event.reason)) return false;
  return true;
}

function decodeBytes(bytes: Uint8Array): string {
  const Decoder = globalThis.TextDecoder;
  if (typeof Decoder === "function") {
    return new Decoder().decode(bytes);
  }
  let text = "";
  for (let index = 0; index < bytes.length; index += 32_768) {
    text += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return text;
}

async function decodeShellMessage(data: MessageEvent["data"]): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return decodeBytes(new Uint8Array(data));
  if (ArrayBuffer.isView(data)) {
    return decodeBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  if (data && typeof data === "object" && typeof (data as { byteLength?: unknown }).byteLength === "number") {
    return decodeBytes(new Uint8Array(data as ArrayBuffer));
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data.text();
  }
  return "";
}

export function useAgentShell(deployments: Deployments | null, { agentId, enabled = true, onData }: UseAgentShellOptions) {
  const [status, setStatus] = useState<ShellStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<((options?: ConnectOptions) => void) | null>(null);
  const connectionIdRef = useRef(0);
  const agentIdRef = useRef(agentId);
  const connectedAgentIdRef = useRef<string | null>(null);
  const enabledRef = useRef(enabled);
  const onDataRef = useRef(onData);
  const reconnectAttemptRef = useRef(0);
  const messageQueueRef = useRef(Promise.resolve());

  const cleanup = useCallback((options: CleanupOptions = {}) => {
    const { resetReconnect = true } = options;
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
    setStatus(options.reconnecting ? "reconnecting" : "connecting");

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
      reconnectAttemptRef.current = 0;
      setStatus("connected");

      ws.onopen = () => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        messageQueueRef.current = messageQueueRef.current
          .then(() => decodeShellMessage(event.data))
          .then((data) => {
            if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
            if (data.length > 0) onDataRef.current?.(data);
          })
          .catch(() => undefined);
      };

      ws.onclose = (event) => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        setStatus("disconnected");
        wsRef.current = null;
        connectedAgentIdRef.current = null;
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
    reconnectAttemptRef.current = 0;
    connect();
  }, [cleanup, connect]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const retryIfInactive = () => {
      if (!enabledRef.current || !agentIdRef.current) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      reconnectAttemptRef.current = 0;
      connectRef.current?.({ reconnecting: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") retryIfInactive();
    };

    window.addEventListener("online", retryIfInactive);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("online", retryIfInactive);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return {
    status,
    send,
    resize,
    reconnect,
  };
}
