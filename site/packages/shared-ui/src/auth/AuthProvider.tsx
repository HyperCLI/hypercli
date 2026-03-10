"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";

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
  tokenStorageKey = "app_auth_token"
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

  const data: { app_token?: string; token?: string } = await response.json();
  const appToken = data.app_token ?? data.token;
  if (!appToken) {
    throw new Error("Token exchange failed: response missing token");
  }

  setStoredToken(appToken, tokenStorageKey);
  return appToken;
}

export async function getAppToken(
  apiBaseUrl: string,
  getPrivyToken: () => Promise<string | null>,
  tokenStorageKey = "app_auth_token"
): Promise<string> {
  const storedToken = getStoredToken(tokenStorageKey);
  if (storedToken && !isTokenExpired(storedToken)) {
    return storedToken;
  }

  const privyToken = await getPrivyToken();
  if (!privyToken) {
    throw new Error("Not authenticated");
  }

  return exchangePrivyToken(apiBaseUrl, privyToken, tokenStorageKey);
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
    if (!ready) return;

    const storedToken = getStoredToken(tokenStorageKey);
    if (storedToken && !isTokenExpired(storedToken)) {
      setIsAuthenticated(true);
      if (privyUser) {
        setUser({
          id: privyUser.id,
          email: privyUser.email?.address,
          walletAddress: privyUser.wallet?.address,
        });
      }
    }

    setIsLoading(false);
  }, [privyUser, ready, tokenStorageKey]);

  useEffect(() => {
    if (!ready || !authenticated || isAuthenticated) return;

    const exchange = async () => {
      try {
        setIsLoading(true);
        await getAppToken(apiBaseUrl, getAccessToken, tokenStorageKey);
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
  }, [apiBaseUrl, authenticated, getAccessToken, isAuthenticated, privyUser, ready, tokenStorageKey]);

  const login = useCallback(() => {
    privyLogin();
  }, [privyLogin]);

  const logout = useCallback(async () => {
    clearStoredToken(tokenStorageKey);
    setIsAuthenticated(false);
    setUser(null);
    await privyLogout();
  }, [privyLogout, tokenStorageKey]);

  const getToken = useCallback(async (): Promise<string> => {
    return getAppToken(apiBaseUrl, getAccessToken, tokenStorageKey);
  }, [apiBaseUrl, getAccessToken, tokenStorageKey]);

  return (
    <AuthContext.Provider
      value={{ isLoading, isAuthenticated, user, login, logout, getToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}
