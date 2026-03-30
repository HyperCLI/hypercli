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

const rawApiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const rawAgentModelsUrl = process.env.NEXT_PUBLIC_HYPER_AGENT_MODELS_URL || "";

const normalizedApiBase = stripApiSuffix(rawApiBase || "");
const normalizedAgentModelsUrl = trimTrailingSlash(rawAgentModelsUrl || "");

export const API_BASE_URL = normalizedApiBase ? `${normalizedApiBase}/agents` : "/agents";
export const AUTH_BASE_URL = normalizedApiBase ? `${normalizedApiBase}/api` : "/api";
export const X402_BASE_URL = API_BASE_URL;
export const VOICE_API_URL = normalizedApiBase ? `${normalizedApiBase}/voice` : "/voice";
export const HYPER_AGENT_MODELS_URL = normalizedAgentModelsUrl || `${API_BASE_URL}/models`;

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
  return exchangePrivyToken(AUTH_BASE_URL, privyToken, TOKEN_KEY);
}

// Get valid app token (from storage or exchange new one)
export async function getAppToken(
  getPrivyToken: () => Promise<string | null>
): Promise<string> {
  return getSharedAppToken(AUTH_BASE_URL, getPrivyToken, TOKEN_KEY);
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

  const url = `${API_BASE_URL}${endpoint}`;
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

export const agentApiFetch = clawFetch;
