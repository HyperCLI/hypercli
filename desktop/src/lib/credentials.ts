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

/**
 * "There is no credential here at all" — the one probe failure the session
 * machine reads as `unauthenticated` rather than `degraded`. It lives here,
 * next to the throw, so `fsm.ts` asks a nominal question instead of
 * regex-matching another crate's prose: the Rust `ConfigError::Display`
 * strings (`rs-sdk/src/config.rs`) used to drift past the JS regex silently,
 * which is exactly how a fresh install dead-ended on a splash instead of the
 * sign-in screen.
 */
export class MissingCredentialError extends Error {
  constructor(message = "No API credential available.") {
    super(message);
    this.name = "MissingCredentialError";
  }
}

/**
 * The `ConfigError::Display` strings `acp_credentials` can reject with when
 * the local credential is missing or unusable — a fresh install with no
 * `~/.hypercli/config`, an unreadable/oversized/malformed credential file, or
 * a misconfigured API base are all "no usable key", not a reachability fault.
 * They cross IPC as bare strings, so this exact list — not a regex over
 * message fragments — is the classification. Keep it in sync with the
 * `#[error(...)]` arms in `rs-sdk/src/config.rs`.
 */
export const RUST_ABSENT_CREDENTIAL_MESSAGES: readonly string[] = [
  "no HyperCLI credential found; set HYPER_AGENTS_API_KEY or HYPER_API_KEY, run `hyper configure`, or run `hyper agent login`",
  "invalid HyperCLI agents API URL",
  "could not read HyperCLI credential file",
  "HyperCLI credential file is too large",
  "HyperCLI agent credential file is not valid JSON",
];

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

/**
 * Fold a credential-probe failure into {@link MissingCredentialError} when it
 * positively names an absent or unusable local credential; pass everything
 * else through untouched, so a genuinely unknown failure still degrades
 * (fsm.ts — only a positively identified missing credential signs out).
 */
export function normalizeCredentialError(error: unknown): unknown {
  if (error instanceof MissingCredentialError) return error;
  const message = describe(error);
  if (RUST_ABSENT_CREDENTIAL_MESSAGES.some((known) => message === known)) {
    return new MissingCredentialError(message);
  }
  return error;
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
  if (hasTauriIpc()) {
    try {
      return await invoke<AcpCredentials>("acp_credentials");
    } catch (error) {
      throw normalizeCredentialError(error);
    }
  }
  const dev = devCredentials();
  if (dev) return dev;
  throw new MissingCredentialError(
    "No API credential available. Run the desktop app, or set HYPER_API_KEY in the environment that starts the dev server.",
  );
}

/** True when this tab is running against the dev-injected credential. */
export function usingDevCredentials(): boolean {
  return !hasTauriIpc() && devCredentials() !== null;
}
