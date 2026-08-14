const MAX_FILE_ERROR_DETAIL_LENGTH = 600;

const SENSITIVE_ASSIGNMENT = /\b(authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|password|passwd|secret|cookie|set-cookie)(\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|(?:bearer\s+)?[^\s,;&]+)/gi;
const SENSITIVE_QUERY_VALUE = /([?&](?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret)=)[^&#\s]+/gi;
const BEARER_TOKEN = /\bbearer\s+[a-z0-9._~+/=-]+/gi;
const URL_CREDENTIALS = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

export function formatFileTechnicalDetails(cause: unknown): string | undefined {
  const message = cause instanceof Error
    ? cause.message
    : typeof cause === "string"
      ? cause
      : "";
  const normalized = message
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
  if (!normalized) return undefined;

  const redacted = normalized
    .replace(SENSITIVE_ASSIGNMENT, (_match, label: string, separator: string) => `${label}${separator}[redacted]`)
    .replace(SENSITIVE_QUERY_VALUE, "$1[redacted]")
    .replace(BEARER_TOKEN, "Bearer [redacted]")
    .replace(URL_CREDENTIALS, "$1[redacted]@");

  if (redacted.length <= MAX_FILE_ERROR_DETAIL_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_FILE_ERROR_DETAIL_LENGTH - 3)}...`;
}
