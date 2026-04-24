"use client";

import { useEffect, useRef, useState } from "react";
import { OpenClawAgent } from "@hypercli.com/sdk/agents";
import type { GatewayClient } from "@hypercli.com/sdk/openclaw/gateway";
import { createAgentClient } from "@/lib/agent-client";

interface Agent {
  id: string;
  state: string;
  hostname: string | null;
}

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
  const gatewayRef = useRef<GatewayClient | null>(null);
  const [gateway, setGateway] = useState<GatewayClient | null>(null);
  const [status, setStatus] = useState<"connected" | "connecting" | "disconnected">("disconnected");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!enabled || !agent || agent.state !== "RUNNING") return;

    let cancelled = false;
    let localGateway: GatewayClient | null = null;

    async function connect() {
      if (cancelled) return;
      setStatus("connecting");
      setError(null);
      try {
        const authToken = await getTokenRef.current();
        if (cancelled) return;

        const agentId = agent?.id;
        if (!agentId) return;
        const deployment = await createAgentClient(authToken).get(agentId);
        if (cancelled) return;
        if (!(deployment instanceof OpenClawAgent)) {
          throw new Error("Selected deployment does not expose an OpenClaw gateway");
        }

        localGateway = await deployment.connect({
          autoApprovePairing: true,
          onHello: () => {
            if (cancelled) return;
            setStatus("connected");
            setError(null);
          },
          onClose: ({ error: closeError, code, reason }) => {
            if (cancelled) return;
            setStatus(shouldShowGatewayConnecting(closeError, code) ? "connecting" : "disconnected");
            if (closeError?.message) {
              setError(closeError.message);
              return;
            }
            if (code !== 1000 && reason) {
              setError(`Disconnected: ${reason}`);
            }
          },
          onGap: ({ expected, received }) => {
            if (cancelled) return;
            setError(`Gateway event gap detected (expected ${expected}, got ${received})`);
          },
          onPairing: (pairing) => {
            if (cancelled || !pairing) return;
            if (pairing.status === "failed" && pairing.error) {
              setStatus("disconnected");
              setError(pairing.error);
              return;
            }
            setStatus("connecting");
            setError(null);
          },
        });

        if (cancelled) {
          localGateway.close();
          return;
        }

        gatewayRef.current = localGateway;
        setGateway(localGateway);
        setStatus("connected");
        setError(null);
      } catch (e: unknown) {
        if (!cancelled) {
          setGateway(null);
          gatewayRef.current = null;
          setStatus("disconnected");
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;
      localGateway?.close();
      gatewayRef.current?.close();
      gatewayRef.current = null;
      setGateway(null);
      setStatus("disconnected");
      setError(null);
    };
  }, [enabled, agent?.id, agent?.state, agent?.hostname]);

  return {
    gateway,
    status,
    error,
    connected: status === "connected",
    connecting: status === "connecting",
  };
}
