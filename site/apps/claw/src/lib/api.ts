import {
  clearStoredToken as clearSharedStoredToken,
  exchangePrivyToken,
  getAppToken as getSharedAppToken,
  getStoredToken as getSharedStoredToken,
  isTokenExpired as isSharedTokenExpired,
  setStoredToken as setSharedStoredToken,
} from "@hypercli/shared-ui";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function stripApiSuffix(value: string): string {
  const trimmed = trimTrailingSlash(value);
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
}

const rawClawApiBase = process.env.NEXT_PUBLIC_CLAW_API_URL || "";
const rawAuthApiBase = process.env.NEXT_PUBLIC_AUTH_BACKEND || "";
const rawHyperclawApiBase = process.env.NEXT_PUBLIC_HYPERCLAW_API_URL || "";
const rawHyperclawModelsUrl = process.env.NEXT_PUBLIC_HYPERCLAW_MODELS_URL || "";

export const CLAW_API_BASE = trimTrailingSlash(rawClawApiBase);
export const AUTH_API_BASE = trimTrailingSlash(rawAuthApiBase || rawClawApiBase);

export const HYPERCLAW_MODELS_ENDPOINT = rawHyperclawModelsUrl
  ? trimTrailingSlash(rawHyperclawModelsUrl)
  : rawHyperclawApiBase
    ? `${trimTrailingSlash(rawHyperclawApiBase)}/models`
    : rawClawApiBase
      ? `${stripApiSuffix(rawClawApiBase)}/models`
      : "/models";

const TOKEN_KEY = "claw_auth_token";

// Token management
export function getStoredToken(): string | null {
  return getSharedStoredToken(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  setSharedStoredToken(token, TOKEN_KEY);
}

export function clearStoredToken(): void {
  clearSharedStoredToken(TOKEN_KEY);
}

export function isTokenExpired(token: string): boolean {
  return isSharedTokenExpired(token);
}

// Exchange Privy access token for HyperClaw app JWT
export async function exchangeToken(privyToken: string): Promise<string> {
  return exchangePrivyToken(CLAW_API_BASE, privyToken, TOKEN_KEY);
}

// Get valid app token (from storage or exchange new one)
export async function getAppToken(
  getPrivyToken: () => Promise<string | null>
): Promise<string> {
  return getSharedAppToken(CLAW_API_BASE, getPrivyToken, TOKEN_KEY);
}

// Authenticated fetch wrapper for HyperClaw API
export async function clawFetch<T>(
  endpoint: string,
  token: string,
  options?: RequestInit
): Promise<T> {
  const headers: HeadersInit = {
    ...options?.headers,
    Authorization: `Bearer ${token}`,
  };

  if (!(options?.body instanceof FormData)) {
    (headers as Record<string, string>)["Content-Type"] = "application/json";
  }

  const url = `${CLAW_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}
