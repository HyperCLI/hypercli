import { useState, useRef, useCallback, useEffect } from "react";

export interface ChannelProbeResult {
  channels?: Record<string, {
    configured?: boolean;
    running?: boolean;
    probe?: { ok?: boolean };
  }>;
}

/** Check whether a channel is live from a channelsStatus(probe=true) response. */
export function isChannelLive(status: ChannelProbeResult | null | undefined, channel: string): boolean {
  if (!status) return false;
  const ch = status.channels?.[channel];
  if (!ch || typeof ch !== "object") return false;
  return ch.configured === true && ch.running === true;
}

interface UsePluginVerificationOptions {
  pluginId: string;
  onChannelProbe: () => Promise<ChannelProbeResult>;
  onVerified?: () => void;
  /** When true, skip polling entirely — immediately mark as verified (e.g., IRC). */
  skip?: boolean;
}

interface UsePluginVerificationResult {
  verifying: boolean;
  verifyError: string | null;
  startVerification: () => void;
  retryVerification: () => void;
}

const MAX_ATTEMPTS = 8;
const INTERVAL_MS = 4000;

export function usePluginVerification({
  pluginId,
  onChannelProbe,
  onVerified,
  skip = false,
}: UsePluginVerificationOptions): UsePluginVerificationResult {
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => { cancelRef.current = true; };
  }, []);

  const runVerification = useCallback(async () => {
    // Skip mode — immediately succeed (e.g., IRC has no HTTP-based probe)
    if (skip) {
      onVerified?.();
      return;
    }

    cancelRef.current = false;
    setVerifying(true);
    setVerifyError(null);

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (cancelRef.current) return;
      try {
        const status = await onChannelProbe();
        if (cancelRef.current) return;
        if (isChannelLive(status, pluginId)) {
          setVerifying(false);
          onVerified?.();
          return;
        }
      } catch {
        // Probe may fail while gateway restarts — keep trying
      }
      if (i < MAX_ATTEMPTS - 1 && !cancelRef.current) {
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
      }
    }

    if (!cancelRef.current) {
      setVerifying(false);
      setVerifyError("Verification timed out. The channel may still be starting up — check the Shell tab for logs, or try reconfiguring the credentials.");
    }
  }, [pluginId, onChannelProbe, onVerified, skip]);

  const startVerification = useCallback(() => {
    runVerification();
  }, [runVerification]);

  const retryVerification = useCallback(() => {
    setVerifyError(null);
    runVerification();
  }, [runVerification]);

  return { verifying, verifyError, startVerification, retryVerification };
}
