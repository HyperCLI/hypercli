"use client";

import { useEffect, useRef, useState } from "react";
import type { GatewayClient, GatewayCloseInfo, GatewayPairingState } from "@hypercli.com/sdk/openclaw/gateway";
import { createAgentClient } from "@/lib/agent-client";

interface Agent {
  id: string;
  state: string;
  hostname: string | null;
}

type OpenClawConnectable = {
  connect: (options?: Record<string, unknown>) => Promise<GatewayClient>;
};

const GATEWAY_RECONNECT_PAUSED_CODES = new Set([
  "PAIRING_REQUIRED",
  "AUTH_RATE_LIMITED",
  "AUTH_TOKEN_MISMATCH",
]);

function shouldShowGatewayConnecting(closeError: unknown, code: number): boolean {
  if (code === 1000) return false;
  if (!closeError || typeof closeError !== "object") return true;
  const value = (closeError as { code?: unknown }).code;
  return !(typeof value === "string" && GATEWAY_RECONNECT_PAUSED_CODES.has(value));
}

export function useOpenClawGateway(
  agent: Agent | null,
  getToken: () => Promise<string>,
  enabled: boolean = true,
) {
  const getTokenRef = useRef(getToken);
  const attemptRef = useRef(0);
  const [gateway, setGateway] = useState<GatewayClient | null>(null);
  const [status, setStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    const attempt = ++attemptRef.current;
    let active = true;
    let localGateway: GatewayClient | null = null;

    const isCurrentAttempt = () => active && attemptRef.current === attempt;

    if (!enabled || !agent || agent.state !== "RUNNING") {
      setGateway(null);
      setStatus("disconnected");
      setError(null);
      return () => {
        active = false;
      };
    }

    const agentId = agent.id;

    setGateway(null);
    setStatus("connecting");
    setError(null);

    async function connect() {
      try {
        const authToken = await getTokenRef.current();
        if (!isCurrentAttempt()) return;

        const deployment = await createAgentClient(authToken).get(agentId);
        if (!isCurrentAttempt()) return;

        const maybeConnectable = deployment as unknown as { connect?: unknown };
        if (typeof maybeConnectable.connect !== "function") {
          throw new Error("Selected deployment does not expose an OpenClaw gateway");
        }

        const connectable = deployment as unknown as OpenClawConnectable;
        localGateway = await connectable.connect({
          autoApprovePairing: true,
          onHello: () => {
            if (!isCurrentAttempt()) return;
            setStatus("connected");
            setError(null);
          },
          onClose: ({ error: closeError, code, reason }: GatewayCloseInfo) => {
            if (!isCurrentAttempt()) return;
            setStatus(shouldShowGatewayConnecting(closeError, code) ? "connecting" : "disconnected");
            if (closeError?.message) {
              setError(closeError.message);
              return;
            }
            if (code !== 1000 && reason) {
              setError(`Disconnected: ${reason}`);
              return;
            }
            setError(null);
          },
          onGap: ({ expected, received }: { expected: number; received: number }) => {
            if (!isCurrentAttempt()) return;
            setError(`Gateway event gap detected (expected ${expected}, got ${received})`);
          },
          onPairing: (pairing: GatewayPairingState | null) => {
            if (!isCurrentAttempt() || !pairing) return;
            if (pairing.status === "failed" && pairing.error) {
              setStatus("disconnected");
              setError(pairing.error);
              return;
            }
            setStatus("connecting");
            setError(null);
          },
        });

        if (!isCurrentAttempt()) {
          localGateway.close();
          return;
        }

        setGateway(localGateway);
        setStatus("connected");
        setError(null);
      } catch (e: unknown) {
        if (!isCurrentAttempt()) return;
        setGateway(null);
        setStatus("disconnected");
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    void connect();

    return () => {
      active = false;
      localGateway?.close();
    };
  }, [enabled, agent?.id, agent?.state]);

  return {
    gateway,
    status,
    error,
    connected: status === "connected",
    connecting: status === "connecting",
  };
}
