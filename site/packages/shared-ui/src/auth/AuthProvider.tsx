"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  clearAuthLogoutMarker,
  clearLocalAuthTokens,
  cookieUtils,
  hasAuthLogoutMarker,
  markAuthLogout,
} from "../utils/cookies";

export interface AuthUser {
  id: string;
  email?: string;
  walletAddress?: string;
  name?: string;
  fullName?: string;
  username?: string;
}

export type AuthFlowState = "checking_session" | "idle" | "exchanging" | "complete" | "error";

export interface AuthContextType {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  flowState: AuthFlowState;
  error: string | null;
  login: () => void;
  logout: () => Promise<void>;
  getToken: () => Promise<string>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export interface AuthProviderProps {
  apiBaseUrl: string;
  children: ReactNode;
  tokenStorageKey?: string;
  cookieName?: string;
  privyEnabled?: boolean;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getAuthUrl(apiBaseUrl: string, path: string): string {
  const baseUrl = trimTrailingSlash(apiBaseUrl);
  return `${baseUrl}${path}`;
}

export function getStoredToken(tokenStorageKey = "app_auth_token"): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(tokenStorageKey);
}

function getCookieToken(cookieName = "auth_token"): string | null {
  return cookieUtils.get(cookieName);
}

function getStoredSession(tokenStorageKey = "app_auth_token", cookieName = "auth_token"): string | null {
  if (hasAuthLogoutMarker()) {
    return null;
  }

  const cookieToken = getCookieToken(cookieName);
  if (cookieToken && !isTokenExpired(cookieToken)) {
    setStoredToken(cookieToken, tokenStorageKey);
    return cookieToken;
  }

  const localToken = getStoredToken(tokenStorageKey);
  if (localToken && !isTokenExpired(localToken)) {
    return localToken;
  }

  return null;
}

export function hasStoredSession(tokenStorageKey = "app_auth_token", cookieName = "auth_token"): boolean {
  return Boolean(getStoredSession(tokenStorageKey, cookieName));
}

export function setStoredToken(token: string, tokenStorageKey = "app_auth_token"): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(tokenStorageKey, token);
}

export function clearStoredToken(tokenStorageKey = "app_auth_token"): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(tokenStorageKey);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) {
    throw new Error("JWT payload missing");
  }
  const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

function firstNonEmptyString(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? firstNonEmptyString(field) : undefined;
}

function fullNameFromFirstLast(value: unknown): string | undefined {
  const firstName = stringField(value, "firstName");
  const lastName = stringField(value, "lastName");
  return firstNonEmptyString([firstName, lastName].filter(Boolean).join(" "));
}

function displayNameFromLinkedAccount(value: unknown): string | undefined {
  return firstNonEmptyString(
    stringField(value, "displayName"),
    stringField(value, "name"),
    fullNameFromFirstLast(value),
    stringField(value, "username"),
  );
}

function usernameFromLinkedAccount(value: unknown): string | undefined {
  return firstNonEmptyString(stringField(value, "username"), stringField(value, "vanityName"));
}

function displayNameFromLinkedAccounts(accounts: unknown): string | undefined {
  if (!Array.isArray(accounts)) return undefined;
  for (const account of accounts) {
    const displayName = displayNameFromLinkedAccount(account);
    if (displayName) return displayName;
  }
  return undefined;
}

function usernameFromLinkedAccounts(accounts: unknown): string | undefined {
  if (!Array.isArray(accounts)) return undefined;
  for (const account of accounts) {
    const username = usernameFromLinkedAccount(account);
    if (username) return username;
  }
  return undefined;
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token);
    const exp = payload.exp;
    const expiresAtSeconds = typeof exp === "number" ? exp : Number(exp);
    if (!Number.isFinite(expiresAtSeconds)) return true;
    return Date.now() >= expiresAtSeconds * 1000 - 60000;
  } catch {
    return true;
  }
}

export async function exchangePrivyToken(
  apiBaseUrl: string,
  privyToken: string,
  tokenStorageKey = "app_auth_token",
  cookieName = "auth_token"
): Promise<string> {
  const response = await fetch(getAuthUrl(apiBaseUrl, "/auth/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ privy_token: privyToken }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
  }

  const data: { app_token?: string; token?: string; expires_in?: number } = await response.json();
  const appToken = data.app_token ?? data.token;
  if (!appToken) {
    throw new Error("Token exchange failed: response missing token");
  }

  setStoredToken(appToken, tokenStorageKey);
  const expiresIn = Number(data.expires_in) || parseInt(process.env.NEXT_PUBLIC_COOKIE_VALIDITY || "15", 10) * 24 * 60 * 60;
  cookieUtils.setWithMaxAge(cookieName, appToken, expiresIn);
  clearAuthLogoutMarker();
  return appToken;
}

export async function getAppToken(
  apiBaseUrl: string,
  getPrivyToken: () => Promise<string | null>,
  tokenStorageKey = "app_auth_token",
  cookieName = "auth_token"
): Promise<string> {
  const storedSession = getStoredSession(tokenStorageKey, cookieName);
  if (storedSession) return storedSession;

  const privyToken = await getPrivyToken();
  if (!privyToken) {
    clearStoredToken(tokenStorageKey);
    throw new Error("Not authenticated");
  }

  return exchangePrivyToken(apiBaseUrl, privyToken, tokenStorageKey, cookieName);
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

export function AuthProvider({
  apiBaseUrl,
  children,
  tokenStorageKey = "app_auth_token",
  cookieName = "auth_token",
  privyEnabled = true,
}: AuthProviderProps) {
  if (!privyEnabled) {
    return (
      <StoredSessionAuthProvider
        apiBaseUrl={apiBaseUrl}
        tokenStorageKey={tokenStorageKey}
        cookieName={cookieName}
      >
        {children}
      </StoredSessionAuthProvider>
    );
  }

  return (
    <PrivySessionAuthProvider
      apiBaseUrl={apiBaseUrl}
      tokenStorageKey={tokenStorageKey}
      cookieName={cookieName}
    >
      {children}
    </PrivySessionAuthProvider>
  );
}

function StoredSessionAuthProvider({
  children,
  tokenStorageKey = "app_auth_token",
  cookieName = "auth_token",
}: AuthProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => hasStoredSession(tokenStorageKey, cookieName));
  const [error, setError] = useState<string | null>(null);

  const resetSession = useCallback((nextError: string | null = null) => {
    clearStoredToken(tokenStorageKey);
    setError(nextError);
    setIsAuthenticated(false);
  }, [tokenStorageKey]);

  const syncStoredSession = useCallback(() => {
    const hasSession = hasStoredSession(tokenStorageKey, cookieName);
    setIsAuthenticated(hasSession);
    setError(null);
    return hasSession;
  }, [cookieName, tokenStorageKey]);

  useEffect(() => {
    syncStoredSession();

    const handleCookieChange = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string }>).detail;
      if (detail?.name && detail.name !== cookieName && detail.name !== "hypercli_logged_out") return;
      syncStoredSession();
    };

    window.addEventListener(cookieUtils.AUTH_COOKIE_EVENT, handleCookieChange as EventListener);
    window.addEventListener("focus", syncStoredSession);

    return () => {
      window.removeEventListener(cookieUtils.AUTH_COOKIE_EVENT, handleCookieChange as EventListener);
      window.removeEventListener("focus", syncStoredSession);
    };
  }, [cookieName, syncStoredSession]);

  const login = useCallback(() => {
    clearAuthLogoutMarker();
    syncStoredSession();
  }, [syncStoredSession]);

  const logout = useCallback(async () => {
    markAuthLogout();
    clearStoredToken(tokenStorageKey);
    clearLocalAuthTokens("app_auth_token", "claw_auth_token");
    cookieUtils.remove(cookieName);
    resetSession();
  }, [cookieName, resetSession, tokenStorageKey]);

  const getToken = useCallback(async (): Promise<string> => {
    const storedSession = getStoredSession(tokenStorageKey, cookieName);
    if (!storedSession) {
      resetSession("Not authenticated");
      throw new Error("Not authenticated");
    }
    return storedSession;
  }, [cookieName, resetSession, tokenStorageKey]);

  const flowState: AuthFlowState = isAuthenticated ? "complete" : "idle";

  return (
    <AuthContext.Provider
      value={{
        isLoading: false,
        isAuthenticated,
        user: isAuthenticated ? { id: "stored-session" } : null,
        flowState,
        error,
        login,
        logout,
        getToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function PrivySessionAuthProvider({
  apiBaseUrl,
  children,
  tokenStorageKey = "app_auth_token",
  cookieName = "auth_token",
}: AuthProviderProps) {
  const {
    ready,
    authenticated,
    user: privyUser,
    login: privyLogin,
    logout: privyLogout,
    getAccessToken,
  } = usePrivy();

  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [flowState, setFlowState] = useState<AuthFlowState>("checking_session");
  const [error, setError] = useState<string | null>(null);

  const getUserFromPrivy = useCallback((): AuthUser | null => {
    if (!privyUser) return null;
    const name = firstNonEmptyString(
      stringField(privyUser.customMetadata, "fullName"),
      stringField(privyUser.customMetadata, "displayName"),
      stringField(privyUser.customMetadata, "name"),
      displayNameFromLinkedAccount(privyUser.google),
      displayNameFromLinkedAccount(privyUser.twitter),
      displayNameFromLinkedAccount(privyUser.github),
      displayNameFromLinkedAccount(privyUser.spotify),
      displayNameFromLinkedAccount(privyUser.linkedin),
      displayNameFromLinkedAccount(privyUser.farcaster),
      displayNameFromLinkedAccount(privyUser.telegram),
      displayNameFromLinkedAccounts(privyUser.linkedAccounts),
    );
    const username = firstNonEmptyString(
      stringField(privyUser.customMetadata, "username"),
      usernameFromLinkedAccount(privyUser.twitter),
      usernameFromLinkedAccount(privyUser.github),
      usernameFromLinkedAccount(privyUser.discord),
      usernameFromLinkedAccount(privyUser.farcaster),
      usernameFromLinkedAccount(privyUser.telegram),
      usernameFromLinkedAccounts(privyUser.linkedAccounts),
    );

    return {
      id: privyUser.id,
      email: privyUser.email?.address,
      walletAddress: privyUser.wallet?.address,
      ...(name ? { name, fullName: name } : {}),
      ...(username ? { username } : {}),
    };
  }, [privyUser]);

  const completeSession = useCallback(() => {
    setUser(getUserFromPrivy());
    setError(null);
    setFlowState("complete");
    setIsAuthenticated(true);
    setIsLoading(false);
  }, [getUserFromPrivy]);

  const resetSession = useCallback((nextState: AuthFlowState = "idle", nextError: string | null = null) => {
    clearStoredToken(tokenStorageKey);
    setUser(null);
    setError(nextError);
    setFlowState(nextState);
    setIsAuthenticated(false);
    setIsLoading(false);
  }, [tokenStorageKey]);

  const syncStoredSession = useCallback((): boolean => {
    const storedSession = getStoredSession(tokenStorageKey, cookieName);
    if (!storedSession) return false;
    completeSession();
    return true;
  }, [completeSession, cookieName, tokenStorageKey]);

  useEffect(() => {
    if (syncStoredSession()) {
      return;
    }

    if (hasAuthLogoutMarker()) {
      resetSession("idle");
      return;
    }

    if (!ready) {
      setFlowState("checking_session");
      setIsLoading(true);
      return;
    }

    if (!authenticated) {
      resetSession("idle");
      return;
    }

    let cancelled = false;

    const exchange = async () => {
      try {
        setFlowState("exchanging");
        setIsLoading(true);
        setError(null);
        await getAppToken(apiBaseUrl, getAccessToken, tokenStorageKey, cookieName);
        if (!cancelled) {
          completeSession();
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Token exchange failed";
          console.error("Token exchange failed:", err);
          resetSession("error", message);
        }
      }
    };

    void exchange();

    return () => {
      cancelled = true;
    };
  }, [
    apiBaseUrl,
    authenticated,
    completeSession,
    cookieName,
    getAccessToken,
    ready,
    resetSession,
    syncStoredSession,
    tokenStorageKey,
  ]);

  useEffect(() => {
    const syncFromStorage = () => {
      if (syncStoredSession()) {
        return;
      }

      if (hasAuthLogoutMarker() || !authenticated) {
        resetSession("idle");
        return;
      }

      setFlowState("checking_session");
    };

    const handleCookieChange = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string }>).detail;
      if (detail?.name && detail.name !== cookieName && detail.name !== "hypercli_logged_out") return;
      syncFromStorage();
    };

    window.addEventListener(cookieUtils.AUTH_COOKIE_EVENT, handleCookieChange as EventListener);
    window.addEventListener("focus", syncFromStorage);

    return () => {
      window.removeEventListener(cookieUtils.AUTH_COOKIE_EVENT, handleCookieChange as EventListener);
      window.removeEventListener("focus", syncFromStorage);
    };
  }, [authenticated, cookieName, resetSession, syncStoredSession]);

  const login = useCallback(() => {
    clearAuthLogoutMarker();
    privyLogin();
  }, [privyLogin]);

  const logout = useCallback(async () => {
    markAuthLogout();
    clearStoredToken(tokenStorageKey);
    clearLocalAuthTokens("app_auth_token", "claw_auth_token");
    cookieUtils.remove(cookieName);
    resetSession("idle");
    await privyLogout();
  }, [cookieName, privyLogout, resetSession, tokenStorageKey]);

  const getToken = useCallback(async (): Promise<string> => {
    return getAppToken(apiBaseUrl, getAccessToken, tokenStorageKey, cookieName);
  }, [apiBaseUrl, cookieName, getAccessToken, tokenStorageKey]);

  return (
    <AuthContext.Provider
      value={{ isLoading, isAuthenticated, user, flowState, error, login, logout, getToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}
