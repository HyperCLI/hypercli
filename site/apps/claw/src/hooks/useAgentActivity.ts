"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import type { Deployments } from "@hypercli.com/sdk/agents";

import { BuzzActivityJournal } from "@/lib/buzz-activity/journal";
import {
  isBuzzActivityGapError,
  isTerminalBuzzActivityError,
  subscribeBuzzActivity,
  type BuzzActivitySubscription,
} from "@/lib/buzz-activity/subscribe";
import type { BuzzActivityEvent, ObserverEvent } from "@/lib/buzz-activity/types";

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000];
const RECONNECT_JITTER = 0.2;
const EVENT_PUBLICATION_INTERVAL_MS = 32;
const ACTIVITY_CLOSE_CODES = new Set([1000, 1008, 4001, 4003, 4004, 4401, 4403, 4404]);

export type ActivityStatus = "connecting" | "connected" | "disconnected" | "error";

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

function shouldReconnectClose(event: { code: number; reason: string }): boolean {
  if (ACTIVITY_CLOSE_CODES.has(event.code)) return false;
  if (event.reason && terminalCloseReason(event.reason)) return false;
  return true;
}

export function useAgentActivity(deployments: Deployments | null, agentId: string | null, enabled: boolean = true) {
  const [events, setEvents] = useState<BuzzActivityEvent[]>([]);
  const [sessionConfig, setSessionConfig] = useState<Record<string, unknown> | null>(null);
  const [status, setStatus] = useState<ActivityStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const journalRef = useRef<BuzzActivityJournal>(new BuzzActivityJournal());
  const subscriptionRef = useRef<BuzzActivitySubscription | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<((options?: ConnectOptions) => void) | null>(null);
  const connectionIdRef = useRef(0);
  const agentIdRef = useRef(agentId);
  const enabledRef = useRef(enabled);
  const reconnectAttemptRef = useRef(0);
  const pendingFramesRef = useRef<ObserverEvent[]>([]);
  const publicationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingFrames = useCallback(() => {
    if (publicationTimerRef.current) {
      clearTimeout(publicationTimerRef.current);
      publicationTimerRef.current = null;
    }
    pendingFramesRef.current = [];
  }, []);

  const flushPendingFrames = useCallback(() => {
    if (publicationTimerRef.current) {
      clearTimeout(publicationTimerRef.current);
      publicationTimerRef.current = null;
    }
    if (pendingFramesRef.current.length === 0) return;
    const pending = pendingFramesRef.current;
    pendingFramesRef.current = [];
    const journal = journalRef.current;
    journal.appendAll(pending);
    setEvents(journal.events());
    setSessionConfig(journal.getSessionConfig());
  }, []);

  const queueFrame = useCallback((frame: ObserverEvent) => {
    pendingFramesRef.current.push(frame);
    if (publicationTimerRef.current) return;
    publicationTimerRef.current = setTimeout(flushPendingFrames, EVENT_PUBLICATION_INTERVAL_MS);
  }, [flushPendingFrames]);

  const cleanup = useCallback((options: CleanupOptions = {}) => {
    const { resetReconnect = true } = options;
    connectionIdRef.current += 1;
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    clearPendingFrames();
    if (subscriptionRef.current) {
      subscriptionRef.current.close();
      subscriptionRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (resetReconnect) reconnectAttemptRef.current = 0;
    setStatus("disconnected");
  }, [clearPendingFrames]);

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
    journalRef.current = new BuzzActivityJournal();
    setEvents([]);
    setSessionConfig(null);
    setError(null);
    setStatus("connecting");

    const controller = new AbortController();
    abortRef.current = controller;
    const current = () =>
      connectionIdRef.current === connectionId &&
      enabledRef.current &&
      agentIdRef.current === requestedAgentId;

    const dropConnection = (nextStatus: ActivityStatus, message: string | null, retry: boolean) => {
      flushPendingFrames();
      if (message) setError(message);
      setStatus(nextStatus);
      if (retry) {
        scheduleReconnect();
      } else if (reconnectTimer.current) {
        // A terminal drop after a scheduled retry must not leave a stranded
        // reconnect cycle pending.
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    try {
      const subscription = await subscribeBuzzActivity(deployments, requestedAgentId, {
        onFrame: (frame) => {
          if (!current()) return;
          queueFrame(frame);
        },
        onHistoryEnd: () => {
          if (!current()) return;
          flushPendingFrames();
        },
        onClose: (event) => {
          if (!current()) return;
          dropConnection("disconnected", null, shouldReconnectClose(event));
        },
        onError: (err) => {
          if (!current()) return;
          if (isBuzzActivityGapError(err)) {
            // The in-pod stream skipped history for a lagging moment but is
            // still alive, so keep rendering instead of cycling the socket.
            flushPendingFrames();
            return;
          }
          dropConnection(
            "error",
            err instanceof Error ? err.message : "Activity stream failed",
            true,
          );
        },
        signal: controller.signal,
      });
      if (!current()) {
        subscription.close();
        return;
      }
      subscriptionRef.current = subscription;
      reconnectAttemptRef.current = 0;
      flushPendingFrames();
      setStatus("connected");
    } catch (err) {
      if (!current()) return;
      dropConnection(
        "error",
        err instanceof Error ? err.message : "Activity stream failed",
        !isTerminalBuzzActivityError(err),
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [deployments, agentId, cleanup, flushPendingFrames, queueFrame, scheduleReconnect]);

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

  const reconnect = useCallback(() => {
    cleanup();
    reconnectAttemptRef.current = 0;
    void connect();
  }, [cleanup, connect]);

  return {
    events,
    status,
    error,
    sessionConfig,
    reconnect,
  };
}
