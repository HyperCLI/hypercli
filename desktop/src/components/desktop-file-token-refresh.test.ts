import { describe, expect, it, vi } from "vitest";
import { watchDesktopFileTokenRefresh } from "./desktop-file-token-refresh";

const IFRAME_URL = "https://desktop-agent-1.hypercli.app/_jwt_auth?jwt=x&redirect=hyper-desktop.html";
const IFRAME_ORIGIN = "https://desktop-agent-1.hypercli.app";

function fakeSource() {
  return { postMessage: vi.fn() };
}

function message(init: { origin?: string; data?: unknown; source?: unknown }) {
  const event = new Event("message");
  Object.assign(event, {
    origin: init.origin ?? IFRAME_ORIGIN,
    data: "data" in init ? init.data : { type: "hyper-desktop:ft-refresh" },
    source: init.source ?? fakeSource(),
  });
  return event as unknown as MessageEvent;
}

describe("watchDesktopFileTokenRefresh", () => {
  it("answers a refresh request with a freshly minted token, addressed only to the iframe origin", async () => {
    const target = new EventTarget();
    const source = fakeSource();
    const mintToken = vi.fn(async () => ({ url: "https://agent-1.hypercli.app/_reef", token: "fresh-token", expires_at: 1790000000 }));

    const stop = watchDesktopFileTokenRefresh("agent-1", IFRAME_URL, mintToken, target as unknown as Window);
    target.dispatchEvent(message({ source }));

    await vi.waitFor(() => expect(source.postMessage).toHaveBeenCalledTimes(1));
    expect(mintToken).toHaveBeenCalledWith("agent-1");
    expect(source.postMessage).toHaveBeenCalledWith(
      { type: "hyper-desktop:ft", token: "fresh-token", expiresAt: 1790000000 },
      IFRAME_ORIGIN,
    );
    stop();
  });

  it("ignores messages from other origins and other message types", async () => {
    const target = new EventTarget();
    const mintToken = vi.fn();
    const stop = watchDesktopFileTokenRefresh("agent-1", IFRAME_URL, mintToken, target as unknown as Window);

    target.dispatchEvent(message({ origin: "https://evil.example" }));
    target.dispatchEvent(message({ data: { type: "hyper-desktop:unrelated" } }));
    target.dispatchEvent(message({ data: null }));
    target.dispatchEvent(message({ data: "hyper-desktop:ft-refresh" }));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mintToken).not.toHaveBeenCalled();
    stop();
  });

  it("stops listening when the cleanup runs", async () => {
    const target = new EventTarget();
    const mintToken = vi.fn(async () => ({ url: "u", token: "t", expires_at: 1 }));
    const stop = watchDesktopFileTokenRefresh("agent-1", IFRAME_URL, mintToken, target as unknown as Window);
    stop();
    target.dispatchEvent(message({}));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mintToken).not.toHaveBeenCalled();
  });

  it("returns a no-op for an unparseable iframe URL", () => {
    const mintToken = vi.fn();
    const stop = watchDesktopFileTokenRefresh("agent-1", "not a url", mintToken);
    expect(typeof stop).toBe("function");
    stop();
    expect(mintToken).not.toHaveBeenCalled();
  });
});
