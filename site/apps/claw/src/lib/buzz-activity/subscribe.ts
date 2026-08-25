import type { Deployments } from "@hypercli.com/sdk/agents";
import {
  BuzzActivityGapError,
  BuzzActivityRouteUnavailableError,
} from "@hypercli.com/sdk/agents";

import type { ObserverEvent } from "./types";

export interface BuzzActivityCloseEvent {
  code: number;
  reason: string;
}

export interface BuzzActivityHandlers {
  onFrame: (frame: ObserverEvent) => void;
  onHistoryEnd?: () => void;
  onClose?: (event: BuzzActivityCloseEvent) => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

export interface BuzzActivitySubscription {
  close(): void;
}

export type SubscribeBuzzActivity = (
  deployments: Deployments,
  agentIdOrName: string,
  handlers: BuzzActivityHandlers,
) => Promise<BuzzActivitySubscription>;

/**
 * True when a subscribe failure can never heal by retrying: the agent is not
 * Buzz-backed (no relay URL / owner pubkey in its launch config), or the
 * secret reveal was rejected (403) or the agent is gone (404). Callers must
 * surface the error instead of scheduling another attempt.
 */
export function isTerminalBuzzActivityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (
    error.message.startsWith("Agent is not Buzz-backed:") ||
    error.message.startsWith("Buzz owner pubkey not found:")
  ) {
    return true;
  }
  if (error.name === "APIError" && "statusCode" in error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    return status === 403 || status === 404;
  }
  return false;
}

/**
 * True when the error is an in-pod stream gap: the listener skipped a lagging
 * client ahead, surfacing a `replay_gap`. The subscription stays alive, so
 * callers must not drop or reconnect on it.
 */
export function isBuzzActivityGapError(error: unknown): boolean {
  return error instanceof BuzzActivityGapError;
}

// Both transports live in the SDK (see ts-sdk `buzz-activity.ts`): the
// `hyper-acp` edge route when the agent declares it (platform auth is
// disabled; the in-pod session token — retained from creation or revealed per
// attempt — is sent as the first auth frame), otherwise the owner-key relay
// stream. The app binds to them through the same deployments client the
// logs/shell hooks use, keeping the SDK's root entry (and its optional x402
// peers) out of this bundle.
export const subscribeBuzzActivity: SubscribeBuzzActivity = async (
  deployments,
  agentIdOrName,
  handlers,
) => {
  try {
    return await deployments.subscribeBuzzActivityRoute(agentIdOrName, handlers);
  } catch (error) {
    // Only "no such route" falls through to the relay; a real edge failure
    // (bad token, forbidden) must surface instead of masking it with a second
    // transport.
    if (!(error instanceof BuzzActivityRouteUnavailableError)) throw error;
  }
  return deployments.subscribeBuzzActivity(agentIdOrName, handlers);
};
