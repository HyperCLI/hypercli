/**
 * Per-agent "Voice replies" preference for the Settings panel switch.
 *
 * Local-only, persisted under the app's `desktop-ng-*` localStorage
 * convention (same shape as voice-read.ts and update-banner.ts). Per agent,
 * not global: voice is an agent attribute, so the switch is too.
 *
 * The active-agent controls mirror this into the global read-aloud pref
 * consumed by the playback path, while preserving per-agent switch state.
 */

import { setReadAloudEnabled } from "./voice-read";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function voiceRepliesStorageKey(agentId: string): string {
  return `desktop-ng-voice-replies:${agentId}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage can throw on access (blocked cookies in a webview).
    return null;
  }
}

/** Whether this agent's replies should be read aloud. Default off. */
export function voiceRepliesEnabled(agentId: string, storage?: StorageLike | null): boolean {
  const store = storage === undefined ? defaultStorage() : storage;
  try {
    return store?.getItem(voiceRepliesStorageKey(agentId)) === "1";
  } catch {
    return false;
  }
}

export function setVoiceRepliesEnabled(
  agentId: string,
  enabled: boolean,
  storage?: StorageLike | null,
): void {
  const store = storage === undefined ? defaultStorage() : storage;
  try {
    store?.setItem(voiceRepliesStorageKey(agentId), enabled ? "1" : "0");
  } catch {
    // Unwritable storage degrades to session-only switch state.
  }
}

export function setVoiceRepliesReadAloudEnabled(
  agentId: string,
  enabled: boolean,
  storage?: StorageLike | null,
): void {
  setVoiceRepliesEnabled(agentId, enabled, storage);
  setReadAloudEnabled(enabled, storage);
}
