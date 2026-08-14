const SECRET_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*[^\s,;]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /([?&](?:code|key|secret|token)=)[^&#\s]+/gi,
];

const STACK_LINE = /^\s*at\s+\S+/gm;
const MAX_DIAGNOSTIC_LENGTH = 1_200;

export interface ClawErrorPresentation {
  title: string;
  description: string;
  technicalDetails?: string;
}

export function redactClawDiagnostic(value: unknown): string | undefined {
  const source = value instanceof Error
    ? value.message
    : typeof value === "string"
      ? value
      : "";
  let detail = source.trim().replace(STACK_LINE, "").trim();
  if (!detail) return undefined;

  for (const pattern of SECRET_PATTERNS) {
    detail = detail.replace(pattern, (match, prefix?: string) => prefix ? `${prefix}[hidden]` : "[hidden]");
  }

  if (detail.length > MAX_DIAGNOSTIC_LENGTH) {
    detail = `${detail.slice(0, MAX_DIAGNOSTIC_LENGTH).trimEnd()}\n...`;
  }
  return detail;
}

export function presentClawError(
  cause: unknown,
  fallback: Pick<ClawErrorPresentation, "title" | "description">,
): ClawErrorPresentation {
  return {
    ...fallback,
    technicalDetails: redactClawDiagnostic(cause),
  };
}

export function warmErrorTitle(action: string): string {
  return `Try again to ${action}`;
}
