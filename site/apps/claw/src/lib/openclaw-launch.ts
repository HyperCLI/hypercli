import type { OpenClawCreateAgentOptions, OpenClawStartAgentOptions } from "@hypercli.com/sdk/agents";

const OPENCLAW_IMAGE_ENV = "NEXT_PUBLIC_OPENCLAW_IMAGE";
const OPENCLAW_PRO_IMAGE_ENV = "NEXT_PUBLIC_OPENCLAW_PRO_IMAGE";

type OpenClawMemoryIndexOptions = {
  enabled?: boolean | null;
  onSessionStart?: boolean | null;
  onSearch?: boolean | null;
  watch?: boolean | null;
  watchDebounceMs?: number | null;
  intervalMinutes?: number | null;
};

type OpenClawLaunchOptions = Pick<OpenClawCreateAgentOptions & OpenClawStartAgentOptions, "image" | "env" | "openClawRoutes"> & {
  memoryIndex: OpenClawMemoryIndexOptions | null;
};

const OPENCLAW_MEMORY_SEARCH_ENV_DEFAULTS = {
  OPENCLAW_MEMORY_SEARCH_ENABLED: "1",
  OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START: "0",
  OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH: "0",
  OPENCLAW_MEMORY_SEARCH_SYNC_WATCH: "0",
  OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS: "30000",
  OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES: "0",
};

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function envBool(value: unknown): string {
  return value ? "1" : "0";
}

function envNonNegativeInteger(name: string, value: unknown): string {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return String(integer);
}

function buildOpenClawMemoryIndexEnv(memoryIndex: OpenClawMemoryIndexOptions | null = null): Record<string, string> {
  if (!memoryIndex) return {};
  const env: Record<string, string> = { ...OPENCLAW_MEMORY_SEARCH_ENV_DEFAULTS };
  if (memoryIndex.enabled !== undefined && memoryIndex.enabled !== null) {
    env.OPENCLAW_MEMORY_SEARCH_ENABLED = envBool(memoryIndex.enabled);
  }
  if (memoryIndex.onSessionStart !== undefined && memoryIndex.onSessionStart !== null) {
    env.OPENCLAW_MEMORY_SEARCH_SYNC_ON_SESSION_START = envBool(memoryIndex.onSessionStart);
  }
  if (memoryIndex.onSearch !== undefined && memoryIndex.onSearch !== null) {
    env.OPENCLAW_MEMORY_SEARCH_SYNC_ON_SEARCH = envBool(memoryIndex.onSearch);
  }
  if (memoryIndex.watch !== undefined && memoryIndex.watch !== null) {
    env.OPENCLAW_MEMORY_SEARCH_SYNC_WATCH = envBool(memoryIndex.watch);
  }
  if (memoryIndex.watchDebounceMs !== undefined && memoryIndex.watchDebounceMs !== null) {
    env.OPENCLAW_MEMORY_SEARCH_SYNC_WATCH_DEBOUNCE_MS = envNonNegativeInteger(
      "watchDebounceMs",
      memoryIndex.watchDebounceMs,
    );
  }
  if (memoryIndex.intervalMinutes !== undefined && memoryIndex.intervalMinutes !== null) {
    env.OPENCLAW_MEMORY_SEARCH_SYNC_INTERVAL_MINUTES = envNonNegativeInteger(
      "intervalMinutes",
      memoryIndex.intervalMinutes,
    );
  }
  return env;
}

export function buildOpenClawLaunchOptions({
  desktopEnabled,
  memoryIndex,
}: {
  desktopEnabled: boolean;
  memoryIndex?: OpenClawMemoryIndexOptions | null;
}): OpenClawLaunchOptions {
  const baseImage = envValue(OPENCLAW_IMAGE_ENV);
  const proImage = envValue(OPENCLAW_PRO_IMAGE_ENV);

  if (desktopEnabled && !proImage) {
    throw new Error(`${OPENCLAW_PRO_IMAGE_ENV} is required to launch desktop agents.`);
  }

  return {
    image: desktopEnabled ? proImage : baseImage,
    env: {
      ...buildOpenClawMemoryIndexEnv(memoryIndex ?? null),
      OPENCLAW_DESKTOP_ENABLED: desktopEnabled ? "1" : "0",
    },
    memoryIndex: memoryIndex ?? null,
    openClawRoutes: {
      includeDesktop: desktopEnabled,
    },
  };
}
