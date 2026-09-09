// Browser shim for the Node `ws` package. ts-sdk's ACP client selects
// `NodeWebSocket ?? globalThis.WebSocket` — it *prefers* the import — so this
// alias is what makes ACP work in the browser bundle, not a fallback. Removing
// the `ws` alias in vite.config.ts breaks chat.
//
// It is a wrapper rather than a bare re-export because the native `WebSocket`
// and Node's `ws` do not take the same arguments, and ts-sdk calls the Node
// shape:
//
//   new WebSocketImpl(url, protocols, options)   // acp.ts
//
// The third argument is Node's options bag (headers, agent). Handing it to the
// native constructor breaks the handshake outright — measured in Chrome against
// the live ACP bridge:
//
//   new WebSocket(url)                 => OPEN
//   new WebSocket(url, undefined)      => OPEN
//   new WebSocket(url, [undefined])    => HANDSHAKE FAILED
//   new WebSocket(url, undefined, {})  => HANDSHAKE FAILED
//
// The failure surfaces as "Sent non-empty 'Sec-WebSocket-Protocol' header but
// no response was received": the browser asks for a subprotocol it was never
// meant to request, the server does not echo one back, and Chrome refuses the
// connection before any ACP traffic happens. The agent was healthy throughout;
// every "ACP initialize failed" was this.
//
// So: drop the options bag, and drop a protocol list that has nothing real in
// it. Headers cannot be set from a browser anyway — the bridge takes its
// credential as `?token=` (see AGENTS.md rule 6).

const Native = globalThis.WebSocket;

/** Empty, undefined, or a list of nothing — none of which may reach the wire. */
function usableProtocols(protocols?: string | string[]): string | string[] | undefined {
  if (typeof protocols === "string") return protocols || undefined;
  if (!Array.isArray(protocols)) return undefined;
  const real = protocols.filter((p): p is string => typeof p === "string" && p.length > 0);
  return real.length > 0 ? real : undefined;
}

class BrowserWebSocket extends Native {
  constructor(url: string | URL, protocols?: string | string[], _options?: unknown) {
    const usable = usableProtocols(protocols);
    // Two-argument form only when there is a genuine subprotocol to request.
    if (usable === undefined) super(url);
    else super(url, usable);
  }
}

export default BrowserWebSocket;
export { BrowserWebSocket as WebSocket };
