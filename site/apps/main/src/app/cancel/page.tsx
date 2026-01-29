"use client";

import { Header, Footer } from "@hypercli/shared-ui";

export default function CancelPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center pt-24">
        <div className="text-center px-4">
          <div className="mb-6">
            <svg
              className="w-20 h-20 mx-auto"
              style={{ color: "var(--muted-foreground)" }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-4">
            Payment Cancelled
          </h1>
          <p className="text-muted-foreground mb-6">
            Your payment was cancelled. No charges were made.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://console.hypercli.com"
              className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Back to Console
            </a>
            <a
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 bg-secondary text-secondary-foreground rounded-lg font-medium hover:bg-secondary/90 transition-colors"
            >
              Go to Homepage
            </a>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
