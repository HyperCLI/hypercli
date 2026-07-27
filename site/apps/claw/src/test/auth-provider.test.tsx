import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  AuthProvider,
  getAppToken,
  useAuth,
} from "../../../../packages/shared-ui/src/auth/AuthProvider";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    ready: true,
    authenticated: false,
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn(),
  }),
}));

function createToken(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp, tags: ["*:*"] })).toString("base64url");
  return `header.${payload}.signature`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function AuthProbe() {
  const { isLoading, isAuthenticated } = useAuth();
  return <div>{isLoading ? "loading" : isAuthenticated ? "authenticated" : "anonymous"}</div>;
}

describe("shared AuthProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "auth_token=; path=/; max-age=0";
    document.cookie = "hypercli_logged_out=; path=/; max-age=0";
  });

  it("restores authentication from the configured local storage token when the cookie is absent", async () => {
    localStorage.setItem("claw_auth_token", createToken(Math.floor(Date.now() / 1000) + 3600));

    render(
      <AuthProvider apiBaseUrl="https://api.example.test" tokenStorageKey="claw_auth_token">
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText("authenticated")).toBeInTheDocument());
  });

  it("does not exchange or persist a Privy token after cancellation", async () => {
    const pendingPrivyToken = deferred<string | null>();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();
    const token = getAppToken(
      "https://api.example.test",
      () => pendingPrivyToken.promise,
      "claw_auth_token",
      "auth_token",
      controller.signal,
    );

    controller.abort();
    await expect(token).rejects.toMatchObject({ name: "AbortError" });
    pendingPrivyToken.resolve("privy-token");
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("claw_auth_token")).toBeNull();
    fetchMock.mockRestore();
  });
});
