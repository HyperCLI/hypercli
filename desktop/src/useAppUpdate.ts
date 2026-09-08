import { useEffect, useSyncExternalStore } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export const RELEASES_URL = "https://github.com/HyperCLI/hypercli/releases/latest";

export type UpdateStatus =
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "error"
  | "manual";

export interface AppUpdateState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  downloaded: number;
  total: number | null;
  error: string | null;
}

let state: AppUpdateState = {
  status: "checking",
  version: null,
  notes: null,
  downloaded: 0,
  total: null,
  error: null,
};
const listeners = new Set<() => void>();
let started = false;
let pending: Update | null = null;
let installInFlight = false;

function setState(patch: Partial<AppUpdateState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

async function isAutoUpdateSupported(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("is_auto_update_supported");
  } catch {
    // Browser dev bridge or older builds without the command: fall through
    // and let check() fail quietly below.
    return true;
  }
}

async function runCheck(userInitiated: boolean) {
  if (pending || installInFlight) return;
  setState({ status: "checking", error: null });
  try {
    // Check support BEFORE any network call: a Linux .deb install would find
    // an update it cannot apply, so it gets a manual-download state instead.
    if (!(await isAutoUpdateSupported())) {
      setState({ status: "manual" });
      return;
    }
    const update = await check();
    if (!update) {
      setState({ status: "up-to-date" });
      return;
    }
    pending = update;
    setState({ status: "available", version: update.version, notes: update.body ?? null });
  } catch (e) {
    // Dev builds compile the updater plugin out ("plugin updater not found"),
    // and offline or missing-manifest failures land here too. Automatic
    // checks stay quiet; only an explicit re-check surfaces an error.
    if (userInitiated) {
      setState({ status: "error", error: errorMessage(e) });
    } else {
      setState({ status: "up-to-date" });
    }
  }
}

async function installUpdate() {
  const update = pending;
  if (!update || installInFlight) return;
  installInFlight = true;
  pending = null;
  setState({ status: "downloading", downloaded: 0, total: null, error: null });
  try {
    let downloaded = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        downloaded = 0;
        setState({ downloaded: 0, total: event.data.contentLength ?? null });
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        setState({ downloaded });
      }
    });
    await relaunch();
  } catch (e) {
    // Failed download/install: drop the stale handle; the next check stages
    // the update again.
    await update.close().catch(() => {});
    installInFlight = false;
    setState({ status: "error", error: errorMessage(e) });
  }
}

export function useAppUpdate() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    if (!started) {
      started = true;
      void runCheck(false);
    }
  }, []);
  return {
    state: snapshot,
    checkNow: () => void runCheck(true),
    install: () => void installUpdate(),
  };
}
