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
}

export interface AuthContextType {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
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

export function setStoredToken(token: string, tokenStorageKey = "app_auth_token"): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(tokenStorageKey, token);
}

export function clearStoredToken(tokenStorageKey = "app_auth_token"): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(tokenStorageKey);
}

export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const exp = payload.exp;
    if (!exp) return true;
    return Date.now() >= exp * 1000 - 60000;
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
  const cookieToken = getCookieToken(cookieName);
  if (cookieToken && !isTokenExpired(cookieToken)) {
    setStoredToken(cookieToken, tokenStorageKey);
    return cookieToken;
  }

  clearStoredToken(tokenStorageKey);

  if (hasAuthLogoutMarker()) {
    throw new Error("Not authenticated");
  }

  const privyToken = await getPrivyToken();
  if (!privyToken) {
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

  useEffect(() => {
    const cookieToken = getCookieToken(cookieName);
    const logoutMarked = hasAuthLogoutMarker();
    const activeToken =
      !logoutMarked && cookieToken && !isTokenExpired(cookieToken)
        ? cookieToken
        : null;

    if (activeToken) {
      setStoredToken(activeToken, tokenStorageKey);
      setIsAuthenticated(true);
      setIsLoading(false);
      if (privyUser) {
        setUser({
          id: privyUser.id,
          email: privyUser.email?.address,
          walletAddress: privyUser.wallet?.address,
        });
      }
      return;
    }

    if (ready) {
      clearStoredToken(tokenStorageKey);
      setIsAuthenticated(false);
      setUser(null);
      setIsLoading(false);
    }
  }, [cookieName, privyUser, ready, tokenStorageKey]);

  useEffect(() => {
    if (!ready || !authenticated || isAuthenticated || hasAuthLogoutMarker()) return;

    const exchange = async () => {
      try {
        setIsLoading(true);
        await getAppToken(apiBaseUrl, getAccessToken, tokenStorageKey, cookieName);
        setIsAuthenticated(true);
        if (privyUser) {
          setUser({
            id: privyUser.id,
            email: privyUser.email?.address,
            walletAddress: privyUser.wallet?.address,
          });
        }
      } catch (err) {
        console.error("Token exchange failed:", err);
      } finally {
        setIsLoading(false);
      }
    };

    exchange();
  }, [apiBaseUrl, authenticated, cookieName, getAccessToken, isAuthenticated, privyUser, ready, tokenStorageKey]);

  useEffect(() => {
    const syncFromCookie = () => {
      const logoutMarked = hasAuthLogoutMarker();
      const cookieToken = getCookieToken(cookieName);
      if (!cookieToken || isTokenExpired(cookieToken)) {
        clearStoredToken(tokenStorageKey);
        setIsAuthenticated(false);
        setUser(null);
        setIsLoading(false);
        return;
      }

      if (logoutMarked) {
        clearStoredToken(tokenStorageKey);
        setIsAuthenticated(false);
        setUser(null);
        setIsLoading(false);
        return;
      }

      setStoredToken(cookieToken, tokenStorageKey);
      setIsAuthenticated(true);
      if (privyUser) {
        setUser({
          id: privyUser.id,
          email: privyUser.email?.address,
          walletAddress: privyUser.wallet?.address,
        });
      }
      setIsLoading(false);
    };

    const handleCookieChange = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string }>).detail;
      if (detail?.name && detail.name !== cookieName && detail.name !== "hypercli_logged_out") return;
      syncFromCookie();
    };

    window.addEventListener(cookieUtils.AUTH_COOKIE_EVENT, handleCookieChange as EventListener);
    window.addEventListener("focus", syncFromCookie);

    return () => {
      window.removeEventListener(cookieUtils.AUTH_COOKIE_EVENT, handleCookieChange as EventListener);
      window.removeEventListener("focus", syncFromCookie);
    };
  }, [cookieName, privyUser, tokenStorageKey]);

  const login = useCallback(() => {
    clearAuthLogoutMarker();
    privyLogin();
  }, [privyLogin]);

  const logout = useCallback(async () => {
    markAuthLogout();
    clearStoredToken(tokenStorageKey);
    clearLocalAuthTokens("app_auth_token", "claw_auth_token");
    cookieUtils.remove(cookieName);
    setIsAuthenticated(false);
    setUser(null);
    await privyLogout();
  }, [cookieName, privyLogout, tokenStorageKey]);

  const getToken = useCallback(async (): Promise<string> => {
    return getAppToken(apiBaseUrl, getAccessToken, tokenStorageKey, cookieName);
  }, [apiBaseUrl, cookieName, getAccessToken, tokenStorageKey]);

  return (
    <AuthContext.Provider
      value={{ isLoading, isAuthenticated, user, login, logout, getToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}
