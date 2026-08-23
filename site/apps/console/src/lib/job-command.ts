export type JobCommand = unknown;

export function formatJobCommandForDisplay(command: JobCommand): string {
  if (Array.isArray(command)) {
    return command.map(String).join(" ").trim();
  }

  if (typeof command !== "string") {
    return "";
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return "";
  }

  const normalizedBase64 = trimmed.replace(/\s+/g, "");
  const looksBase64 =
    normalizedBase64.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(normalizedBase64);

  if (!looksBase64) {
    return trimmed;
  }

  try {
    const decoded = atob(normalizedBase64).trim();
    if (decoded && /^[\t\n\r -~]+$/.test(decoded)) {
      return decoded;
    }
  } catch {
    // Keep the raw value when the backend sends a plain string.
  }

  return trimmed;
}
