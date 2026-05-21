"use client";

import { ApiKeysManager, Footer, Header, getAuthBackendUrl, getAuthCookieToken } from "@hypercli/shared-ui";

function getConsoleToken(): Promise<string> {
  const token = getAuthCookieToken();
  if (!token) {
    return Promise.reject(new Error("No auth token found"));
  }
  return Promise.resolve(token);
}

export default function ApiKeysPage() {
  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-background">
      <Header />
      <main className="flex-1 pt-20 relative">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <ApiKeysManager
            apiBaseUrl={getAuthBackendUrl()}
            getToken={getConsoleToken}
            description="New keys start deny-by-default. Add only the scoped tags you want to allow."
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}
