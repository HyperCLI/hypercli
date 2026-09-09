/**
 * Where this app talks to the backend.
 *
 * Two bases, because REST and WebSockets have different constraints:
 *
 * - **REST** is subject to CORS. The gateway allows both packaged origins
 *   (`http://tauri.localhost`, `tauri://localhost`) but not the Vite dev origin
 *   (`http://localhost:1420`) — measured on every route. So in dev the REST base
 *   is same-origin and Vite proxies it upstream; CORS then does not apply at all,
 *   because the browser is talking to its own origin.
 *
 *   Every dev-proxied request carries the `DEV_PROXY_PREFIX` (`/api`) path
 *   prefix — the webview asks for `http://localhost:1420/api/agents/...` and the
 *   Vite proxy strips `/api` before forwarding — so devtools shows unambiguously
 *   which traffic is proxied to the backend and which is app-served. Packaged
 *   builds call the gateway directly with no prefix.
 *
 * - **WebSockets** are not CORS-gated, so they are dialled directly at the real
 *   upstream host in both modes, and must never be pointed at the dev proxy.
 *   Token endpoints hand back absolute `wss://` URLs; those are used verbatim.
 *
 * Keeping these apart is the whole point: derive a WS URL from the proxied base
 * and you get `ws://localhost:1420/api/ws`, which is the Vite server, not the API.
 */
import type { AcpCredentials } from "../api";

export interface Endpoints {
  /** Base for REST. Same-origin `/api`-prefixed in dev, the real gateway when packaged. */
  httpBase: string;
  /** The real upstream base. Always use this to derive WebSocket URLs. */
  apiBase: string;
  /** True when REST is going through the Vite dev proxy. */
  proxied: boolean;
}

/**
 * Upstream path prefixes the dev proxy forwards (`/agents`, `/routines`,
 * `/v1`). `vite.config.ts` imports this list and mounts each one under
 * `DEV_PROXY_PREFIX`, so there is exactly one source for what is proxied.
 */
export const PROXY_PREFIXES = ["/agents", "/routines", "/v1"] as const;

/**
 * Path prefix marking a same-origin dev request as proxied to the backend.
 * The Vite proxy strips it before forwarding upstream.
 */
export const DEV_PROXY_PREFIX = "/api";

function devHttpBase(apiBase: string): string {
  // Preserve the upstream path prefix (`/agents`) so the proxy can map it back
  // onto the same path upstream, and so the SDK's own derivations — routines
  // strips `/agents` and appends `/routines`, the agent client rewrites
  // `/agents` to `/v1` — land on a sibling proxied prefix unchanged.
  const path = new URL(apiBase).pathname.replace(/\/+$/, "") || "/agents";
  return `${window.location.origin}${DEV_PROXY_PREFIX}${path}`;
}

export function resolveEndpoints(credentials: AcpCredentials): Endpoints {
  const apiBase = credentials.api_base.replace(/\/+$/, "");
  if (!import.meta.env.DEV) {
    return { httpBase: apiBase, apiBase, proxied: false };
  }
  return { httpBase: devHttpBase(apiBase), apiBase, proxied: true };
}
