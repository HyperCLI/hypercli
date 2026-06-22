import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, vi } from "vitest";

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
