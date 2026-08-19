"use client";

import { useEffect, useState } from "react";
import { getSlackInstallStatus } from "@hypercli.com/sdk/agents";

import { useAgentAuth } from "@/hooks/useAgentAuth";
import { SLACK_RELAY_BASE_URL } from "@/lib/api";

/**
 * Whether the signed-in account has a hosted Slack install connected.
 *
 * `null` means "not known yet" (loading, signed out, or relay unconfigured),
 * which callers treat as "no Slack" rather than blocking on it.
 */
export function useSlackInstallConnected(): boolean | null {
  const { getToken, isAuthenticated } = useAgentAuth();
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const timeout = window.setTimeout(() => {
      if (!SLACK_RELAY_BASE_URL || !isAuthenticated) {
        if (active) setConnected(null);
        return;
      }
      void (async () => {
        try {
          const status = await getSlackInstallStatus({
            relayBaseUrl: SLACK_RELAY_BASE_URL,
            token: await getToken(),
          });
          if (active) setConnected(status.connected === true);
        } catch {
          if (active) setConnected(false);
        }
      })();
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [getToken, isAuthenticated]);

  return connected;
}
