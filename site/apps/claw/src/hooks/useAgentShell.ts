"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Deployments } from "@hypercli.com/sdk/agents";
import { markShellPerformance, measureShellPerformance } from "@/lib/agent-shell-performance";

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000];
const RECONNECT_JITTER = 0.2;
const TERMINAL_CLOSE_CODES = new Set([1000, 1008, 4001, 4003, 4004, 4401, 4403, 4404]);
const SHELL_INPUT_CHUNK_MAX_CHARS = 16_384;
const SHELL_INPUT_BUFFER_HIGH_WATER_BYTES = 256_000;
const SHELL_INPUT_QUEUE_MAX_CHARS = 1_000_000;
const SHELL_INPUT_PUMP_INTERVAL_MS = 8;
const SHELL_INPUT_PUMP_MAX_INTERVAL_MS = 128;
const SHELL_CREDENTIAL_TIMEOUT_MS = 10_000;
const SHELL_OUTPUT_BURST_WINDOW_MS = 8;
const SHELL_OUTPUT_BURST_FLUSH_MS = 4;
const SHELL_OUTPUT_BURST_MAX_CHARS = 32_768;
const SHELL_CONNECTION_STABLE_MS = 20_000;

export type ShellStatus = "connected" | "connecting" | "reconnecting" | "disconnected";

interface UseAgentShellOptions {
  agentId: string | null;
  enabled?: boolean;
  reconnectEnabled?: boolean;
  onData?: (data: string) => void;
  onInputRejected?: () => void;
  getDeployments?: (signal: AbortSignal) => Promise<Deployments | null>;
}

type ConnectOptions = {
  reconnecting?: boolean;
};

type CleanupOptions = {
  resetReconnect?: boolean;
};

function reconnectDelay(attempt: number): number {
  const baseDelay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
  const jitter = baseDelay * RECONNECT_JITTER * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(baseDelay + jitter));
}

function automaticReconnectAvailable(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return typeof document === "undefined" || document.visibilityState === "visible";
}

function terminalCloseReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return /\bnormal(?: closure)?\b/.test(normalized) || [
    "unauthorized",
    "forbidden",
    "not found",
    "deleted",
    "stopped",
    "exited",
    "policy",
  ].some((value) => normalized.includes(value));
}

function shouldRetryShellConnectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const closeCode = (error as { closeCode?: unknown }).closeCode;
  if (typeof closeCode === "number" && TERMINAL_CLOSE_CODES.has(closeCode)) return false;
  const closeReason = (error as { closeReason?: unknown }).closeReason;
  if (typeof closeReason === "string" && terminalCloseReason(closeReason)) return false;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === "number") {
    if (statusCode >= 500) return true;
    return statusCode === 408 || statusCode === 425 || statusCode === 429;
  }
  const message = error instanceof Error ? error.message : "";
  const tokenExchangeStatus = /token exchange failed:\s*(\d{3})/i.exec(message);
  if (tokenExchangeStatus) {
    const parsedStatus = Number(tokenExchangeStatus[1]);
    return parsedStatus >= 500 || parsedStatus === 408 || parsedStatus === 425 || parsedStatus === 429;
  }
  if (/not authenticated|response missing token/i.test(message)) return false;
  return true;
}

function bashUnavailableReason(reason: string): boolean {
  return /(\/bin\/bash|\bbash\b)/i.test(reason)
    && /(not found|no such file|missing|unavailable|unsupported)/i.test(reason);
}

function shouldReconnectClose(event: CloseEvent): boolean {
  if (TERMINAL_CLOSE_CODES.has(event.code)) return false;
  if (event.reason && terminalCloseReason(event.reason)) return false;
  return true;
}

function decodeBytes(bytes: Uint8Array, decoder: TextDecoder | null): string {
  if (decoder) return decoder.decode(bytes, { stream: true });
  let text = "";
  for (let index = 0; index < bytes.length; index += 32_768) {
    text += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  }
  return text;
}

function decodeShellMessage(data: MessageEvent["data"], decoder: TextDecoder | null): string | Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return decodeBytes(new Uint8Array(data), decoder);
  if (ArrayBuffer.isView(data)) {
    return decodeBytes(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), decoder);
  }
  if (data && typeof data === "object" && typeof (data as { byteLength?: unknown }).byteLength === "number") {
    return decodeBytes(new Uint8Array(data as ArrayBuffer), decoder);
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return data.text();
  }
  return "";
}

function shellNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function splitShellInput(data: string): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < data.length) {
    let end = Math.min(offset + SHELL_INPUT_CHUNK_MAX_CHARS, data.length);
    if (
      end < data.length &&
      end > offset &&
      data.charCodeAt(end - 1) >= 0xd800 &&
      data.charCodeAt(end - 1) <= 0xdbff &&
      data.charCodeAt(end) >= 0xdc00 &&
      data.charCodeAt(end) <= 0xdfff
    ) {
      end -= 1;
    }
    chunks.push(data.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function loadShellDeployments(
  getter: (signal: AbortSignal) => Promise<Deployments | null>,
  controller: AbortController,
): Promise<Deployments | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: unknown, value?: Deployments | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      controller.signal.removeEventListener("abort", handleAbort);
      if (error) reject(error);
      else resolve(value ?? null);
    };
    const handleAbort = () => {
      const reason = controller.signal.reason;
      finish(reason instanceof Error ? reason : new Error("Shell connection cancelled"));
    };

    if (controller.signal.aborted) {
      handleAbort();
      return;
    }
    controller.signal.addEventListener("abort", handleAbort, { once: true });
    timer = setTimeout(() => {
      const error = new Error("Shell credential request timed out");
      controller.abort(error);
      finish(error);
    }, SHELL_CREDENTIAL_TIMEOUT_MS);
    void getter(controller.signal).then(
      (value) => finish(undefined, value),
      (error) => finish(error),
    );
  });
}

export function useAgentShell(
  deployments: Deployments | null,
  { agentId, enabled = true, reconnectEnabled = enabled, onData, onInputRejected, getDeployments }: UseAgentShellOptions,
) {
  const [status, setStatus] = useState<ShellStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<((options?: ConnectOptions) => void) | null>(null);
  const connectionIdRef = useRef(0);
  const agentIdRef = useRef(agentId);
  const connectedAgentIdRef = useRef<string | null>(null);
  const enabledRef = useRef(enabled);
  const reconnectEnabledRef = useRef(reconnectEnabled);
  const onDataRef = useRef(onData);
  const onInputRejectedRef = useRef(onInputRejected);
  const deploymentsRef = useRef(deployments);
  const getDeploymentsRef = useRef(getDeployments);
  const reconnectAttemptRef = useRef(0);
  const reconnectBlockedRef = useRef(false);
  const previousReconnectEnabledRef = useRef(reconnectEnabled);
  const connectionStableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageQueueRef = useRef(Promise.resolve());
  const messageQueuePendingRef = useRef(false);
  const outputBurstCleanupRef = useRef<(() => void) | null>(null);
  const connectAbortRef = useRef<AbortController | null>(null);
  const connectingAgentIdRef = useRef<string | null>(null);
  const decoderRef = useRef<TextDecoder | null>(null);
  const preferredShellRef = useRef<string | undefined>(undefined);
  const inputQueueRef = useRef<string[]>([]);
  const inputQueueHeadRef = useRef(0);
  const inputQueueCharsRef = useRef(0);
  const inputPumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputPumpDelayRef = useRef(SHELL_INPUT_PUMP_INTERVAL_MS);
  const inputRejectionNotifiedRef = useRef(false);
  const pumpInputRef = useRef<() => void>(() => undefined);

  const clearInputQueue = useCallback(() => {
    if (inputPumpTimerRef.current) {
      clearTimeout(inputPumpTimerRef.current);
      inputPumpTimerRef.current = null;
    }
    inputQueueRef.current = [];
    inputQueueHeadRef.current = 0;
    inputQueueCharsRef.current = 0;
    inputPumpDelayRef.current = SHELL_INPUT_PUMP_INTERVAL_MS;
    inputRejectionNotifiedRef.current = false;
  }, []);

  const cleanup = useCallback((options: CleanupOptions = {}) => {
    const { resetReconnect = true } = options;
    connectionIdRef.current += 1;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (connectionStableTimerRef.current) {
      clearTimeout(connectionStableTimerRef.current);
      connectionStableTimerRef.current = null;
    }
    connectedAgentIdRef.current = null;
    connectingAgentIdRef.current = null;
    connectAbortRef.current?.abort();
    connectAbortRef.current = null;
    outputBurstCleanupRef.current?.();
    outputBurstCleanupRef.current = null;
    messageQueueRef.current = Promise.resolve();
    messageQueuePendingRef.current = false;
    decoderRef.current = null;
    clearInputQueue();
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    if (resetReconnect) reconnectAttemptRef.current = 0;
    if (resetReconnect) reconnectBlockedRef.current = false;
    if (resetReconnect) preferredShellRef.current = undefined;
    setStatus("disconnected");
  }, [clearInputQueue]);

  const scheduleReconnect = useCallback((immediate = false) => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (!reconnectEnabledRef.current) {
      setStatus("disconnected");
      return;
    }
    if (!automaticReconnectAvailable()) {
      setStatus("reconnecting");
      return;
    }
    const attempt = reconnectAttemptRef.current;
    reconnectAttemptRef.current += 1;
    setStatus("reconnecting");
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      if (!reconnectEnabledRef.current || !automaticReconnectAvailable()) {
        setStatus("reconnecting");
        return;
      }
      connectRef.current?.({ reconnecting: true });
    }, immediate ? 0 : reconnectDelay(attempt));
  }, []);

  const connect = useCallback(async (options: ConnectOptions = {}) => {
    const requestedAgentId = agentIdRef.current;
    if ((!deploymentsRef.current && !getDeploymentsRef.current) || !requestedAgentId || !enabledRef.current) return;
    if (options.reconnecting && (
      !reconnectEnabledRef.current ||
      reconnectBlockedRef.current ||
      !automaticReconnectAvailable()
    )) {
      if (reconnectEnabledRef.current && !reconnectBlockedRef.current) setStatus("reconnecting");
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN && connectedAgentIdRef.current === requestedAgentId) return;
    if (connectAbortRef.current && connectingAgentIdRef.current === requestedAgentId) return;

    cleanup({ resetReconnect: false });
    const connectionId = connectionIdRef.current + 1;
    connectionIdRef.current = connectionId;
    const abortController = new AbortController();
    connectAbortRef.current = abortController;
    connectingAgentIdRef.current = requestedAgentId;
    setStatus(options.reconnecting ? "reconnecting" : "connecting");
    markShellPerformance("connect-start");

    try {
      const activeDeployments = getDeploymentsRef.current
        ? await loadShellDeployments(getDeploymentsRef.current, abortController)
        : deploymentsRef.current;
      if (!activeDeployments) throw new Error("Shell client is unavailable");
      if (
        connectionIdRef.current !== connectionId ||
        !enabledRef.current ||
        agentIdRef.current !== requestedAgentId
      ) return;
      markShellPerformance("credentials-ready");
      measureShellPerformance("credentials", "connect-start", "credentials-ready");
      markShellPerformance("transport-start");
      const ws = await activeDeployments.shellConnect(requestedAgentId, preferredShellRef.current, {
        signal: abortController.signal,
      });
      if (
        connectionIdRef.current !== connectionId ||
        !enabledRef.current ||
        agentIdRef.current !== requestedAgentId
      ) {
        ws.close();
        return;
      }

      wsRef.current = ws;
      ws.binaryType = "arraybuffer";
      connectedAgentIdRef.current = requestedAgentId;
      connectAbortRef.current = null;
      connectingAgentIdRef.current = null;
      const Decoder = globalThis.TextDecoder;
      decoderRef.current = typeof Decoder === "function" ? new Decoder() : null;
      reconnectBlockedRef.current = false;
      if (connectionStableTimerRef.current) clearTimeout(connectionStableTimerRef.current);
      connectionStableTimerRef.current = setTimeout(() => {
        connectionStableTimerRef.current = null;
        if (wsRef.current === ws && ws.readyState === WebSocket.OPEN) reconnectAttemptRef.current = 0;
      }, SHELL_CONNECTION_STABLE_MS);
      setStatus("connected");
      markShellPerformance("connected");
      measureShellPerformance("transport", "transport-start", "connected");
      measureShellPerformance("connect-total", "connect-start", "connected");
      let acceptingMessages = true;
      let receivedFirstOutput = false;
      let outputBurstChunks: string[] = [];
      let outputBurstChars = 0;
      let outputBurstTimer: ReturnType<typeof setTimeout> | null = null;
      let lastOutputDeliveryAt = Number.NEGATIVE_INFINITY;

      const cancelOutputBurst = () => {
        acceptingMessages = false;
        if (outputBurstTimer) clearTimeout(outputBurstTimer);
        outputBurstTimer = null;
        outputBurstChunks = [];
        outputBurstChars = 0;
      };
      outputBurstCleanupRef.current = cancelOutputBurst;

      const recordFirstOutput = () => {
        if (receivedFirstOutput) return;
        receivedFirstOutput = true;
        markShellPerformance("first-output");
        measureShellPerformance("open-to-first-output", "connected", "first-output");
        measureShellPerformance("connect-to-first-output", "connect-start", "first-output");
      };

      const flushOutputBurst = () => {
        if (outputBurstTimer) clearTimeout(outputBurstTimer);
        outputBurstTimer = null;
        if (outputBurstChars === 0) return;
        const output = outputBurstChunks.join("");
        outputBurstChunks = [];
        outputBurstChars = 0;
        if (!acceptingMessages || connectionIdRef.current !== connectionId) return;
        lastOutputDeliveryAt = shellNow();
        onDataRef.current?.(output);
      };

      const emitOutput = (data: string) => {
        if (!data) return;
        recordFirstOutput();
        const now = shellNow();
        if (outputBurstChars > 0 || now - lastOutputDeliveryAt <= SHELL_OUTPUT_BURST_WINDOW_MS) {
          outputBurstChunks.push(data);
          outputBurstChars += data.length;
          if (outputBurstChars >= SHELL_OUTPUT_BURST_MAX_CHARS) {
            flushOutputBurst();
          } else if (!outputBurstTimer) {
            outputBurstTimer = setTimeout(flushOutputBurst, SHELL_OUTPUT_BURST_FLUSH_MS);
          }
          return;
        }
        lastOutputDeliveryAt = now;
        onDataRef.current?.(data);
      };

      const finishNaturalOutput = (trailingOutput: string) => {
        if (connectionIdRef.current !== connectionId) {
          cancelOutputBurst();
          return;
        }
        if (trailingOutput) {
          recordFirstOutput();
          outputBurstChunks.push(trailingOutput);
          outputBurstChars += trailingOutput.length;
        }
        flushOutputBurst();
        acceptingMessages = false;
        if (outputBurstCleanupRef.current === cancelOutputBurst) {
          outputBurstCleanupRef.current = null;
        }
      };

      const deliverDecoded = (decoded: string | Promise<string>) => {
        if (typeof decoded === "string" && !messageQueuePendingRef.current) {
          emitOutput(decoded);
          return;
        }

        messageQueuePendingRef.current = true;
        const queued = messageQueueRef.current
          .then(() => decoded)
          .then((data) => {
            if (!acceptingMessages || connectionIdRef.current !== connectionId) return;
            emitOutput(data);
          })
          .catch(() => undefined);
        messageQueueRef.current = queued;
        void queued.then(() => {
          if (messageQueueRef.current === queued) messageQueuePendingRef.current = false;
        });
      };

      ws.onopen = () => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        deliverDecoded(decodeShellMessage(event.data, decoderRef.current));
      };

      ws.onclose = (event) => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        const trailingOutput = decoderRef.current?.decode() ?? "";
        decoderRef.current = null;
        if (messageQueuePendingRef.current) {
          const closingQueue = messageQueueRef.current.then(() => finishNaturalOutput(trailingOutput));
          messageQueueRef.current = closingQueue;
          void closingQueue.then(() => {
            if (messageQueueRef.current === closingQueue) messageQueuePendingRef.current = false;
          });
        } else {
          finishNaturalOutput(trailingOutput);
        }
        setStatus("disconnected");
        wsRef.current = null;
        connectedAgentIdRef.current = null;
        if (connectionStableTimerRef.current) {
          clearTimeout(connectionStableTimerRef.current);
          connectionStableTimerRef.current = null;
        }
        clearInputQueue();
        if (
          enabledRef.current &&
          agentIdRef.current === requestedAgentId &&
          event.reason &&
          bashUnavailableReason(event.reason)
        ) {
          preferredShellRef.current = "/bin/sh";
          reconnectAttemptRef.current = 0;
          scheduleReconnect(true);
          return;
        }
        if (enabledRef.current && agentIdRef.current === requestedAgentId && shouldReconnectClose(event)) {
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        if (connectionIdRef.current !== connectionId || wsRef.current !== ws) return;
        ws.close();
      };
    } catch (error) {
      if (connectionIdRef.current !== connectionId) return;
      markShellPerformance("connect-failed");
      measureShellPerformance("failed-attempt", "connect-start", "connect-failed");
      connectAbortRef.current = null;
      connectingAgentIdRef.current = null;
      setStatus("disconnected");
      const retryable = shouldRetryShellConnectError(error);
      if (!retryable) reconnectBlockedRef.current = true;
      if (
        enabledRef.current &&
        reconnectEnabledRef.current &&
        agentIdRef.current === requestedAgentId &&
        retryable
      ) {
        scheduleReconnect();
      }
    }
  }, [cleanup, clearInputQueue, scheduleReconnect]);

  useEffect(() => {
    agentIdRef.current = agentId;
    enabledRef.current = enabled;
    reconnectEnabledRef.current = reconnectEnabled;
    onDataRef.current = onData;
    onInputRejectedRef.current = onInputRejected;
    deploymentsRef.current = deployments;
    getDeploymentsRef.current = getDeployments;
    connectRef.current = connect;
  }, [agentId, connect, deployments, enabled, getDeployments, onData, onInputRejected, reconnectEnabled]);

  useEffect(() => {
    const wasReconnectEnabled = previousReconnectEnabledRef.current;
    previousReconnectEnabledRef.current = reconnectEnabled;
    if (!reconnectEnabled) {
      let cancelledReconnect = false;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
        cancelledReconnect = true;
      }
      if (!wsRef.current && connectAbortRef.current) {
        connectionIdRef.current += 1;
        connectAbortRef.current.abort();
        connectAbortRef.current = null;
        connectingAgentIdRef.current = null;
        setStatus("disconnected");
      } else if (!wsRef.current && cancelledReconnect) {
        setStatus("disconnected");
      }
      return;
    }
    if (wasReconnectEnabled) return;
    if (!enabled || !agentId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || connectAbortRef.current) return;
    connectRef.current?.({ reconnecting: true });
  }, [agentId, enabled, reconnectEnabled]);

  const pumpInput = useCallback(() => {
    inputPumpTimerRef.current = null;
    const ws = wsRef.current;
    if (
      ws?.readyState !== WebSocket.OPEN ||
      connectedAgentIdRef.current !== agentIdRef.current
    ) {
      clearInputQueue();
      return;
    }

    let sentChunk = false;
    while (
      inputQueueHeadRef.current < inputQueueRef.current.length &&
      (ws.bufferedAmount ?? 0) < SHELL_INPUT_BUFFER_HIGH_WATER_BYTES
    ) {
      const chunk = inputQueueRef.current[inputQueueHeadRef.current];
      ws.send(chunk);
      inputQueueHeadRef.current += 1;
      inputQueueCharsRef.current -= chunk.length;
      sentChunk = true;
    }

    if (inputQueueHeadRef.current >= inputQueueRef.current.length) {
      clearInputQueue();
      return;
    }
    const delay = inputPumpDelayRef.current;
    inputPumpDelayRef.current = sentChunk
      ? SHELL_INPUT_PUMP_INTERVAL_MS
      : Math.min(delay * 2, SHELL_INPUT_PUMP_MAX_INTERVAL_MS);
    inputPumpTimerRef.current = setTimeout(
      () => pumpInputRef.current(),
      delay,
    );
  }, [clearInputQueue]);

  useEffect(() => {
    pumpInputRef.current = pumpInput;
  }, [pumpInput]);

  // Keep normal keystrokes immediate; only queue when a paste or socket backlog requires it.
  const send = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN || connectedAgentIdRef.current !== agentIdRef.current) return;
    const queueEmpty = inputQueueHeadRef.current >= inputQueueRef.current.length;
    if (
      data.length <= SHELL_INPUT_CHUNK_MAX_CHARS &&
      queueEmpty &&
      (ws.bufferedAmount ?? 0) < SHELL_INPUT_BUFFER_HIGH_WATER_BYTES
    ) {
      inputRejectionNotifiedRef.current = false;
      ws.send(data);
      return;
    }

    const available = SHELL_INPUT_QUEUE_MAX_CHARS - inputQueueCharsRef.current;
    if (data.length > available) {
      if (!inputRejectionNotifiedRef.current) {
        inputRejectionNotifiedRef.current = true;
        onInputRejectedRef.current?.();
      }
      return;
    }
    inputQueueRef.current.push(...splitShellInput(data));
    inputQueueCharsRef.current += data.length;
    if (!inputPumpTimerRef.current) pumpInputRef.current();
  }, []);

  // Send resize escape sequence
  const resize = useCallback((rows: number, cols: number) => {
    send(`\x1b[8;${rows};${cols}t`);
  }, [send]);

  const hasDeploymentSource = Boolean(deployments || getDeployments);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (hasDeploymentSource && enabled && agentId) {
        void connect();
      } else {
        cleanup();
      }
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [agentId, cleanup, connect, enabled, hasDeploymentSource]);

  const reconnect = useCallback(() => {
    cleanup();
    reconnectAttemptRef.current = 0;
    reconnectBlockedRef.current = false;
    connect();
  }, [cleanup, connect]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const retryIfInactive = () => {
      if (!enabledRef.current || !agentIdRef.current) return;
      if (!reconnectEnabledRef.current) return;
      if (!automaticReconnectAvailable()) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      connectRef.current?.({ reconnecting: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        retryIfInactive();
        return;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
        if (!wsRef.current && reconnectEnabledRef.current) setStatus("reconnecting");
      }
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
