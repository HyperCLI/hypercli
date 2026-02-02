export const CLAW_API_BASE = process.env.NEXT_PUBLIC_CLAW_API_URL || "";

const TOKEN_KEY = "claw_auth_token";

// Token management
export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const exp = payload.exp;
    if (!exp) return true;
    // 60 second buffer before expiry
    return Date.now() >= exp * 1000 - 60000;
  } catch {
    return true;
  }
}

// Exchange Privy access token for HyperClaw app JWT
export async function exchangeToken(privyToken: string): Promise<string> {
  const response = await fetch(`${CLAW_API_BASE}/auth/privy/login`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${privyToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }

  const data: { access_token: string; token_type: string } =
    await response.json();
  setStoredToken(data.access_token);
  return data.access_token;
}

// Get valid app token (from storage or exchange new one)
export async function getAppToken(
  getPrivyToken: () => Promise<string | null>
): Promise<string> {
  const storedToken = getStoredToken();
  if (storedToken && !isTokenExpired(storedToken)) {
    return storedToken;
  }

  const privyToken = await getPrivyToken();
  if (!privyToken) {
    throw new Error("Not authenticated");
  }

  return exchangeToken(privyToken);
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
