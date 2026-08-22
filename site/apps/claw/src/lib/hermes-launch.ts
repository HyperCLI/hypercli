import type { HermesAgentCreateOptions } from "@hypercli.com/sdk/agents";

// Literal process.env access: Next.js only inlines NEXT_PUBLIC_* values for
// statically analyzable references.
export function getHermesDefaultImage(): string {
  return process.env.NEXT_PUBLIC_HERMES_AGENT_IMAGE?.trim() || "";
}

export function buildHermesLaunchOptions({
  customImage,
}: {
  customImage?: string | null;
} = {}): Pick<HermesAgentCreateOptions, "image"> {
  const image = customImage?.trim() || getHermesDefaultImage();
  // An unset image lets the SDK default hermes-agent image apply.
  return image ? { image } : {};
}
