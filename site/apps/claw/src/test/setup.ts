import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, vi } from "vitest";

if (!globalThis.ResizeObserver) {
  vi.stubGlobal("ResizeObserver", class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
}

if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

vi.mock("@turnkey/react-wallet-kit", () => ({
  TurnkeyProvider: ({ children }: { children: ReactNode }) => children,
  useTurnkey: () => ({
    handleLogin: vi.fn(),
    logout: vi.fn(),
    session: null,
    user: null,
  }),
}));

vi.mock("@turnkey/react-wallet-kit/styles.css", () => ({}));

// Instrumentation is a no-op dependency for tests; stub it so component tests
// do not pull in the shared-ui debugLog implementation.
vi.mock("@/lib/debug-flow", () => ({
  debugTransition: vi.fn(),
  debugFlow: vi.fn(),
  debugAgentState: vi.fn(),
}));

// jsdom has no server for the static bootstrap templates. Serve them from
// public/bootstrap/ so assembleOpenClawBootstrapPack exercises the real
// shipped assets in tests.
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const match = /^\/bootstrap\/([\w.-]+\.md)$/.exec(raw);
  if (match) {
    try {
      const body = await readFile(path.join(__dirname, "../../public/bootstrap", match[1]), "utf-8");
      return new Response(body, { status: 200 });
    } catch {
      return new Response("not found", { status: 404 });
    }
  }
  return originalFetch(input, init);
}) as typeof fetch;

type ConsoleMatcher = string | RegExp;

let allowedConsoleErrors: ConsoleMatcher[] = [];
let allowedConsoleWarnings: ConsoleMatcher[] = [];
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;
let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function isAllowed(message: string, matchers: ConsoleMatcher[]): boolean {
  return matchers.some((matcher) =>
    typeof matcher === "string" ? message.includes(matcher) : matcher.test(message),
  );
}

export function allowConsoleError(matcher: ConsoleMatcher): void {
  allowedConsoleErrors.push(matcher);
}

export function allowConsoleWarn(matcher: ConsoleMatcher): void {
  allowedConsoleWarnings.push(matcher);
}

beforeEach(() => {
  allowedConsoleErrors = [];
  allowedConsoleWarnings = [];

  errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = formatConsoleArgs(args);
    if (isAllowed(message, allowedConsoleErrors)) return;
    throw new Error(`Unexpected console.error: ${message}`);
  });

  warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    const message = formatConsoleArgs(args);
    if (isAllowed(message, allowedConsoleWarnings)) return;
    throw new Error(`Unexpected console.warn: ${message}`);
  });
});

afterEach(() => {
  cleanup();
  errorSpy?.mockRestore();
  warnSpy?.mockRestore();
  errorSpy = null;
  warnSpy = null;
});
