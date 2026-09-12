import type { AgentDesktopFileToken } from "../api";

/**
 * The embedded hyper-desktop viewer holds a short-lived upload token; when it
 * nears expiry (or was never issued) the page asks its parent window for a
 * fresh one over postMessage. Only the iframe's own origin may ask, and the
 * answer (targetOrigin = that origin) carries the raw token straight back to
 * it.
 */
export function watchDesktopFileTokenRefresh(
  agentId: string,
  iframeUrl: string,
  mintToken: (agentId: string) => Promise<AgentDesktopFileToken>,
  target?: Pick<Window, "addEventListener" | "removeEventListener">,
): () => void {
  const eventTarget = target ?? (typeof window !== "undefined" ? window : undefined);
  if (!eventTarget) return () => {};
  let origin: string;
  try {
    origin = new URL(iframeUrl).origin;
  } catch {
    return () => {};
  }
  if (!origin || origin === "null") return () => {};
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== origin) return;
    const data = event.data as { type?: unknown } | null;
    if (!data || data.type !== "hyper-desktop:ft-refresh") return;
    const source = event.source as Window | null;
    if (!source || typeof source.postMessage !== "function") return;
    void mintToken(agentId)
      .then(({ token, expires_at }) => {
        source.postMessage({ type: "hyper-desktop:ft", token, expiresAt: expires_at }, origin);
      })
      .catch(() => {
        // The viewer toasts the failure and asks again on the next drop.
      });
  };
  eventTarget.addEventListener("message", onMessage);
  return () => eventTarget.removeEventListener("message", onMessage);
}
