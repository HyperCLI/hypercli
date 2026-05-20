import { getPlugin } from "@/components/dashboard/integrations/plugin-registry";

const BUILT_IN_ALIASES = new Map<string, string>([
  ["cli", "CLI"],
  ["terminal", "CLI"],
  ["dashboard", "Dashboard"],
  ["web", "Web"],
  ["browser", "Browser"],
]);

function firstNonEmptyString(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function normalizeLookupKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^integration[:/]/, "")
    .replace(/^integrations\./, "")
    .replace(/^channels\./, "")
    .replace(/^plugins\.entries\./, "")
    .replace(/^plugin[:/]/, "")
    .replace(/^builtin[:/]/, "builtin-");
}

function humanizeIntegrationId(value: string) {
  return value
    .replace(/^integration[:/]/i, "")
    .replace(/^integrations\./i, "")
    .replace(/^channels\./i, "")
    .replace(/^plugins\.entries\./i, "")
    .replace(/^plugin[:/]/i, "")
    .split(/[\s._:/-]+/)
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase();
      if (["AI", "API", "CLI", "IRC", "SMS", "TTS", "STT", "URL"].includes(upper)) return upper;
      const lower = part.toLowerCase();
      return `${lower[0]?.toUpperCase() ?? ""}${lower.slice(1)}`;
    })
    .join(" ");
}

function lookupIntegrationDisplayName(value: string | null | undefined): string | undefined {
  const raw = firstNonEmptyString(value);
  if (!raw) return undefined;

  const key = normalizeLookupKey(raw);
  return BUILT_IN_ALIASES.get(key) ?? getPlugin(key)?.displayName;
}

export function integrationDisplayName(name: string | null | undefined, id: string | null | undefined): string {
  const rawName = firstNonEmptyString(name);
  const rawId = firstNonEmptyString(id);

  return (
    lookupIntegrationDisplayName(rawName) ??
    lookupIntegrationDisplayName(rawId) ??
    (rawName ? humanizeIntegrationId(rawName) : undefined) ??
    (rawId ? humanizeIntegrationId(rawId) : undefined) ??
    "Unknown"
  );
}
