"use client";

import { ApiKeysManager, Footer, Header, useAuth, getAuthBackendUrl } from "@hypercli/shared-ui";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

function getConsoleToken(): Promise<string> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("No auth token found"));
  }
  const token =
    document.cookie
      .split("; ")
      .find((row) => row.startsWith("auth_token="))
      ?.split("=")[1] ?? null;
  if (!token) {
    return Promise.reject(new Error("No auth token found"));
  }
  return Promise.resolve(token);
}

export default function ApiKeysPage() {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-foreground text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-background">
      <Header />
      <main className="flex-1 pt-20 relative">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <ApiKeysManager
            apiBaseUrl={getAuthBackendUrl()}
            getToken={getConsoleToken}
            description="Create full-access API keys by default with `*:*`, or switch to scoped tags for narrower app access."
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}
