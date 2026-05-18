import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { AuthProvider, useAuth } from "../../../../packages/shared-ui/src/auth/AuthProvider";

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
});
