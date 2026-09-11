import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DictationButton } from "./DictationButton";

// The dictation singleton builds its deps from ../api; the button never calls
// them in a static render, but the import must resolve without Tauri IPC.
vi.mock("../api", () => ({ createVoiceTranscriptionSession: vi.fn() }));

/**
 * Node's test env has a `navigator` but no `mediaDevices` and no
 * `MediaRecorder`; the two dictation environments (a modern WKWebView and an
 * old one) are reproduced by defining both globals for one render.
 */
function defineGlobals(overrides: { navigator?: unknown; mediaRecorder?: unknown }) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const hadRecorder = Reflect.has(globalThis, "MediaRecorder");
  const previousRecorder = Reflect.get(globalThis, "MediaRecorder");

  if (overrides.navigator !== undefined) {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: overrides.navigator,
    });
  }
  if (overrides.mediaRecorder !== undefined) {
    Reflect.set(globalThis, "MediaRecorder", overrides.mediaRecorder);
  }

  return () => {
    if (overrides.navigator !== undefined) {
      if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
    if (overrides.mediaRecorder !== undefined) {
      if (hadRecorder) Reflect.set(globalThis, "MediaRecorder", previousRecorder);
      else Reflect.deleteProperty(globalThis, "MediaRecorder");
    }
  };
}

function supportedEnv() {
  return defineGlobals({
    navigator: { mediaDevices: { getUserMedia: async () => new Promise<never>(() => {}) } },
    mediaRecorder: { isTypeSupported: () => true },
  });
}

describe("DictationButton (ChatPane mic gating)", () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("renders nothing without getUserMedia — old WKWebView / no mic", () => {
    const html = renderToStaticMarkup(<DictationButton disabled={false} onTranscript={() => {}} />);
    expect(html).toBe("");
  });

  it("renders nothing when no container is encodable", () => {
    restore = defineGlobals({
      navigator: { mediaDevices: { getUserMedia: async () => new Promise<never>(() => {}) } },
      mediaRecorder: { isTypeSupported: () => false },
    });
    const html = renderToStaticMarkup(<DictationButton disabled={false} onTranscript={() => {}} />);
    expect(html).toBe("");
  });

  it("renders the idle mic when dictation is supported", () => {
    restore = supportedEnv();
    const html = renderToStaticMarkup(<DictationButton disabled={false} onTranscript={() => {}} />);
    expect(html).toContain('title="Dictate a message"');
    expect(html).toContain("lucide-mic");
    expect(html).not.toMatch(/(<|\s)disabled(=|\s|>)/);
  });

  it("renders disabled while the composer is busy", () => {
    restore = supportedEnv();
    const html = renderToStaticMarkup(<DictationButton disabled={true} onTranscript={() => {}} />);
    expect(html).toContain('title="Dictate a message"');
    expect(html).toMatch(/(<|\s)disabled(=|\s|>)/);
  });
});
