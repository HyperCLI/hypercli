"use client";

import { useEffect } from "react";
import { Header, Footer } from "@hypercli/shared-ui";

export default function SuccessPage() {
  useEffect(() => {
    // Redirect to console after 3 seconds
    const timer = setTimeout(() => {
      window.location.href = "https://console.hypercli.com";
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center px-4">
          <div className="mb-6">
            <svg
              className="w-20 h-20 mx-auto text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-4">
            Payment Successful!
          </h1>
          <p className="text-muted-foreground mb-6">
            Your account has been topped up. Redirecting to console...
          </p>
          <a
            href="https://console.hypercli.com"
            className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Go to Console
          </a>
        </div>
      </main>
      <Footer />
    </div>
  );
}
