"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Check, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { isChannelLive } from "./TelegramWizard";

interface QrLoginWizardProps {
  pluginId: string;
  displayName: string;
  onWebLoginStart: (options?: { force?: boolean; verbose?: boolean }) => Promise<Record<string, any>>;
  onWebLoginWait: (options?: { timeoutMs?: number }) => Promise<Record<string, any>>;
  onChannelProbe: () => Promise<Record<string, any>>;
  onClose: () => void;
  onVerified?: () => void;
}

// ---------------------------------------------------------------------------
// Defensive QR data extraction — handles unknown gateway response shapes
// ---------------------------------------------------------------------------

interface QrDisplayData {
  imageUrl: string | null;
  rawText: string | null;
}

function extractQrData(response: Record<string, any>): QrDisplayData {
  const imageKeys = ["qr", "qrCode", "qrDataUrl", "qr_data_url", "image", "qrImage"];
  const urlKeys = ["qr", "qrCode", "url", "qrUrl", "qr_url", "image"];
  const base64Keys = ["qr", "qrCode", "qrBase64", "qr_base64", "image"];
  const textKeys = ["qr", "qrCode", "qr_code", "qrText", "qr_text", "code"];

  // Case 1: data URL (e.g., "data:image/png;base64,...")
  for (const key of imageKeys) {
    const val = response[key];
    if (typeof val === "string" && val.startsWith("data:image")) {
      return { imageUrl: val, rawText: null };
    }
  }

  // Case 2: regular URL to an image
  for (const key of urlKeys) {
    const val = response[key];
    if (typeof val === "string" && (val.startsWith("http://") || val.startsWith("https://"))) {
      return { imageUrl: val, rawText: null };
    }
  }

  // Case 3: base64 string (no data: prefix)
  for (const key of base64Keys) {
    const val = response[key];
    if (typeof val === "string" && val.length > 100 && /^[A-Za-z0-9+/=]+$/.test(val)) {
      return { imageUrl: `data:image/png;base64,${val}`, rawText: null };
    }
  }

  // Case 4: plain text QR content
  for (const key of textKeys) {
    const val = response[key];
    if (typeof val === "string" && val.length > 0) {
      return { imageUrl: null, rawText: val };
    }
  }

  return { imageUrl: null, rawText: null };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QrLoginWizard({
  pluginId,
  displayName,
  onWebLoginStart,
  onWebLoginWait,
  onChannelProbe,
  onClose,
  onVerified,
}: QrLoginWizardProps) {
  // step 1 = generating QR, step 2 = waiting for scan, step 3 = verifying, step 4 = done
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [qrData, setQrData] = useState<QrDisplayData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<Record<string, any> | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => { cancelRef.current = true; };
  }, []);

  // Generate QR code
  const generateQr = useCallback(async (force = false) => {
    cancelRef.current = false;
    setLoading(true);
    setError(null);
    setQrData(null);
    setRawResponse(null);
    try {
      const response = await onWebLoginStart({ force, verbose: true });
      if (cancelRef.current) return;
      setRawResponse(response);
      const data = extractQrData(response);
      if (!data.imageUrl && !data.rawText) {
        setError("Unexpected response from server.");
        setStep(1);
        return;
      }
      setQrData(data);
      setStep(2);
      // Immediately start waiting for scan
      waitForScan();
    } catch (err) {
      if (cancelRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to generate QR code");
    } finally {
      setLoading(false);
    }
  }, [onWebLoginStart]);

  // Wait for QR scan completion
  const waitForScan = useCallback(async () => {
    try {
      await onWebLoginWait();
      if (cancelRef.current) return;
      // Scan completed — move to verification
      setStep(3);
      verifyChannel();
    } catch (err) {
      if (cancelRef.current) return;
      const msg = err instanceof Error ? err.message : "Connection timed out";
      if (msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("expired")) {
        setError("QR code expired. Generate a new one to try again.");
      } else {
        setError(msg);
      }
      setStep(1);
    }
  }, [onWebLoginWait]);

  // Verify channel is live (same pattern as TelegramWizard)
  const verifyChannel = useCallback(async () => {
    setVerifyError(null);
    const maxAttempts = 8;
    const intervalMs = 4000;

    for (let i = 0; i < maxAttempts; i++) {
      if (cancelRef.current) return;
      try {
        const status = await onChannelProbe();
        if (cancelRef.current) return;
        if (isChannelLive(status, pluginId)) {
          setStep(4);
          onVerified?.();
          return;
        }
      } catch {
        // Probe may fail while gateway restarts — keep trying
      }
      if (i < maxAttempts - 1 && !cancelRef.current) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }

    if (!cancelRef.current) {
      setVerifyError("Verification timed out. Your agent may still be starting up.");
    }
  }, [onChannelProbe, onVerified, pluginId]);

  // Auto-start QR generation on mount
  useEffect(() => {
    generateQr();
  }, []);

  // --- Step 1: Loading / Error ---
  if (step === 1) {
    return (
      <div className="space-y-6">
        {loading ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
            <p className="text-sm text-text-secondary">Generating QR code...</p>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 text-sm text-[var(--error)]">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            {rawResponse && (
              <details className="text-xs text-text-tertiary">
                <summary className="cursor-pointer hover:text-text-secondary">Debug response</summary>
                <pre className="mt-2 p-2 rounded bg-[var(--surface-low)] overflow-auto max-h-32">
                  {JSON.stringify(rawResponse, null, 2)}
                </pre>
              </details>
            )}
            <button
              onClick={() => generateQr(true)}
              className="btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try again
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // --- Step 2: QR displayed, waiting for scan ---
  if (step === 2) {
    return (
      <div className="space-y-5">
        <div className="text-center space-y-3">
          <p className="text-sm font-medium text-foreground">
            Scan with {displayName}
          </p>
          <p className="text-xs text-text-tertiary">
            Open {displayName} on your phone → Settings → Linked Devices → Scan QR code
          </p>
        </div>

        {/* QR code display */}
        <div className="flex justify-center">
          <div className="relative p-4 bg-white rounded-xl">
            {qrData?.imageUrl ? (
              <img
                src={qrData.imageUrl}
                alt={`${displayName} QR code`}
                className="w-56 h-56 object-contain"
              />
            ) : qrData?.rawText ? (
              <div className="w-56 h-56 flex items-center justify-center text-xs text-text-tertiary font-mono break-all p-2 bg-[var(--surface-low)] rounded">
                {qrData.rawText}
              </div>
            ) : null}
            {/* Subtle waiting overlay */}
            <div className="absolute inset-0 flex items-end justify-center pb-2">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/60 text-white text-xs">
                <Loader2 className="w-3 h-3 animate-spin" />
                Waiting for scan...
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-center pt-2">
          <button
            onClick={() => { cancelRef.current = true; generateQr(true); }}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:bg-[var(--surface-low)] transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh QR
          </button>
          <button
            onClick={() => { cancelRef.current = true; onClose(); }}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // --- Step 3: Verifying channel ---
  if (step === 3) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-4 py-8">
          {verifyError ? (
            <>
              <AlertCircle className="w-8 h-8 text-amber-400" />
              <p className="text-sm text-text-secondary text-center">{verifyError}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => { setVerifyError(null); verifyChannel(); }}
                  className="btn-primary px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Retry
                </button>
                <button
                  onClick={() => { setStep(4); onVerified?.(); }}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-[var(--surface-low)] transition-colors"
                >
                  Skip
                </button>
              </div>
            </>
          ) : (
            <>
              <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
              <p className="text-sm text-text-secondary">Verifying connection...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  // --- Step 4: Success ---
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <Check className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">{displayName} is live!</p>
          <p className="text-xs text-text-tertiary mt-1">Your agent can now send and receive messages.</p>
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <button onClick={onClose} className="btn-primary px-4 py-2 rounded-lg text-sm font-medium">
          Done
        </button>
      </div>
    </div>
  );
}
