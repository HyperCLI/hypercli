"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  getAppToken,
  clearStoredToken,
  getStoredToken,
  isTokenExpired,
} from "@/lib/api";

export interface ClawUser {
  id: string;
  email?: string;
  walletAddress?: string;
}

export interface ClawAuthContextType {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: ClawUser | null;
  login: () => void;
  logout: () => Promise<void>;
  getToken: () => Promise<string>;
}

export const ClawAuthContext = createContext<ClawAuthContextType | undefined>(
  undefined
);

export function useClawAuth(): ClawAuthContextType {
  const context = useContext(ClawAuthContext);
  if (!context) {
    throw new Error("useClawAuth must be used within ClawAuthProvider");
  }
  return context;
}

/**
 * Full auth provider — only rendered when PrivyProvider is in the tree.
 */
export function ClawAuthProvider({ children }: { children: ReactNode }) {
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
  const [user, setUser] = useState<ClawUser | null>(null);

  // Check for existing token on mount
  useEffect(() => {
    if (!ready) return;

    const storedToken = getStoredToken();
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
  }, [ready, privyUser]);

  // Exchange Privy token for app JWT when user authenticates
  useEffect(() => {
    if (!ready || !authenticated || isAuthenticated) return;

    const exchange = async () => {
      try {
        setIsLoading(true);
        await getAppToken(getAccessToken);
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
  }, [ready, authenticated, isAuthenticated, getAccessToken, privyUser]);

  const login = useCallback(() => {
    privyLogin();
  }, [privyLogin]);

  const logout = useCallback(async () => {
    clearStoredToken();
    setIsAuthenticated(false);
    setUser(null);
    await privyLogout();
  }, [privyLogout]);

  const getToken = useCallback(async (): Promise<string> => {
    return getAppToken(getAccessToken);
  }, [getAccessToken]);

  return (
    <ClawAuthContext.Provider
      value={{ isLoading, isAuthenticated, user, login, logout, getToken }}
    >
      {children}
    </ClawAuthContext.Provider>
  );
}
