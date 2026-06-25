import type { OpenClawCreateAgentOptions, OpenClawStartAgentOptions } from "@hypercli.com/sdk/agents";

const OPENCLAW_IMAGE_ENV = "NEXT_PUBLIC_OPENCLAW_IMAGE";
const OPENCLAW_PRO_IMAGE_ENV = "NEXT_PUBLIC_OPENCLAW_PRO_IMAGE";

type OpenClawLaunchOptions = Pick<OpenClawCreateAgentOptions & OpenClawStartAgentOptions, "image" | "env" | "openClawRoutes">;

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function buildOpenClawLaunchOptions({ desktopEnabled }: { desktopEnabled: boolean }): OpenClawLaunchOptions {
  const baseImage = envValue(OPENCLAW_IMAGE_ENV);
  const proImage = envValue(OPENCLAW_PRO_IMAGE_ENV);

  if (desktopEnabled && !proImage) {
    throw new Error(`${OPENCLAW_PRO_IMAGE_ENV} is required to launch desktop agents.`);
  }

  return {
    image: desktopEnabled ? proImage : baseImage,
    env: {
      OPENCLAW_DESKTOP_ENABLED: desktopEnabled ? "1" : "0",
    },
    openClawRoutes: {
      includeDesktop: desktopEnabled,
    },
  };
}
