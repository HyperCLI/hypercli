"use client";

import { useAuth } from "../providers/AuthProvider";
import { PrivyLoginPanel } from "./PrivyLogin";

interface AuthLandingPageProps {
  title: string;
  description: string;
  loadingText?: string;
  redirectingText?: string;
  tryAgainLabel?: string;
}

export function AuthLandingPage({
  title,
  description,
  loadingText = "Loading...",
  redirectingText = "Redirecting...",
  tryAgainLabel = "Try Again",
}: AuthLandingPageProps) {
  const { isLoading, isAuthenticated, error, flowState } = useAuth();

  if (flowState === "error" && error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="bg-surface-low border border-border rounded-2xl p-8 text-center shadow-lg max-w-md">
          <div className="text-error mb-4">
            <svg
              className="w-12 h-12 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Login Failed</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-primary text-primary-foreground font-semibold py-2 px-6 rounded-lg hover:bg-primary-hover transition-colors"
          >
            {tryAgainLabel}
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        {isLoading ? (
          <div className="bg-surface-low border border-border rounded-2xl p-8 text-center shadow-lg max-w-md">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-foreground">{loadingText}</p>
          </div>
        ) : (
          <div className="bg-surface-low border border-border rounded-2xl p-8 shadow-lg">
            <PrivyLoginPanel
              showTitle={true}
              title={title}
              description={description}
              showTurnkeyFallback={true}
              onSuccess={() => window.location.reload()}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="bg-surface-low border border-border rounded-2xl p-8 text-center shadow-lg max-w-md">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-foreground">{redirectingText}</p>
      </div>
    </div>
  );
}
