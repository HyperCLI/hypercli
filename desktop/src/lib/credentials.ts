/**
 * Where the app's API credential comes from.
 *
 * REST is a bearer API key and nothing more, so requiring Tauri IPC to obtain
 * one is what made dev unable to reproduce the app: a browser tab dead-ended at
 * `invoke("acp_credentials")` and never exercised a single real request. That is
 * why bugs only ever surfaced after packaging.
 *
 * Rust still owns credential *persistence* — `~/.hypercli/config`, `save_api_key`,
 * `logout` — which is a genuine OS-integration job. It just is not the only way
 * to read one. In dev, Vite injects the key from the environment so a plain
 * browser tab runs the same client, the same transport, and the same failures.
 */
import { invoke } from "@tauri-apps/api/core";

export interface AcpCredentials {
  api_base: string;
  token: string;
}

/** Injected by vite.config.ts, and only while serving — empty in any build. */
declare const __HYPER_DEV_API_KEY__: string;
declare const __HYPER_DEV_API_BASE__: string;

function hasTauriIpc(): boolean {
  const internals = (globalThis as { __TAURI_INTERNALS__?: Record<string, unknown> }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function";
}

function devCredentials(): AcpCredentials | null {
  if (!import.meta.env.DEV) return null;
  const token = typeof __HYPER_DEV_API_KEY__ === "string" ? __HYPER_DEV_API_KEY__ : "";
  const apiBase = typeof __HYPER_DEV_API_BASE__ === "string" ? __HYPER_DEV_API_BASE__ : "";
  if (!token || !apiBase) return null;
  return { api_base: apiBase, token };
}

/**
 * The packaged app always goes through Rust. A dev browser tab falls back to
 * the injected key, so it behaves like the app rather than like nothing.
 */
export async function resolveCredentials(): Promise<AcpCredentials> {
  if (hasTauriIpc()) return invoke<AcpCredentials>("acp_credentials");
  const dev = devCredentials();
  if (dev) return dev;
  throw new Error(
    "No API credential available. Run the desktop app, or set HYPER_API_KEY in the environment that starts the dev server.",
  );
}

/** True when this tab is running against the dev-injected credential. */
export function usingDevCredentials(): boolean {
  return !hasTauriIpc() && devCredentials() !== null;
}
