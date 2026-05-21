"use client";

import { AuthLandingPage } from "@hypercli/shared-ui";

export default function ConsolePage() {
  return (
    <AuthLandingPage
      title="Welcome to HyperCLI Console"
      description="Please sign in to continue"
      redirectingText="Redirecting to dashboard..."
    />
  );
}
