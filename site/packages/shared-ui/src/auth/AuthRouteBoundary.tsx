"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "./AuthProvider";

interface AuthRouteBoundaryProps {
  children: ReactNode;
  publicPaths?: string[];
  unauthenticatedRedirectTo?: string;
  authenticatedPublicRedirectTo?: string | null;
  loadingFallback?: ReactNode;
}

const DEFAULT_LOADING_FALLBACK = (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="text-foreground text-xl">Loading...</div>
  </div>
);

export function AuthRouteBoundary({
  children,
  publicPaths = ["/"],
  unauthenticatedRedirectTo = "/",
  authenticatedPublicRedirectTo = null,
  loadingFallback = DEFAULT_LOADING_FALLBACK,
}: AuthRouteBoundaryProps) {
  const { isLoading, isAuthenticated, flowState } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const currentPath = pathname || "/";
  const isPublicPath = publicPaths.includes(currentPath);
  const isTerminalUnauthenticated =
    !isLoading && !isAuthenticated && (flowState === "idle" || flowState === "error");

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (isPublicPath) {
      if (isAuthenticated && authenticatedPublicRedirectTo && currentPath !== authenticatedPublicRedirectTo) {
        router.replace(authenticatedPublicRedirectTo);
      }
      return;
    }

    if (isTerminalUnauthenticated && currentPath !== unauthenticatedRedirectTo) {
      router.replace(unauthenticatedRedirectTo);
    }
  }, [
    authenticatedPublicRedirectTo,
    currentPath,
    isAuthenticated,
    isLoading,
    isPublicPath,
    isTerminalUnauthenticated,
    router,
    unauthenticatedRedirectTo,
  ]);

  if (isPublicPath) {
    return <>{children}</>;
  }

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return <>{loadingFallback}</>;
}
