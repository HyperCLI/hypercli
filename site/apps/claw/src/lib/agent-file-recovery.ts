import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { OPENCLAW_WORKSPACE_DIR, OPENCLAW_WORKSPACE_PREFIX } from "@/lib/openclaw-config";

const DEFAULT_RETRY_COUNT = 1;
const DEFAULT_RETRY_DELAY_MS = 400;

export interface AgentFileReadRecoveryResult<T> {
  content: T;
  path: string;
  renamed: boolean;
}

interface AgentFileReadRecoveryOptions<T> {
  path: string;
  read: (path: string) => Promise<T>;
  rename: (fromPath: string, safeCandidatePath: string) => Promise<string>;
  retryCount?: number;
  retryDelayMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (!isRecord(value)) return String(value);
  return [value.message, value.detail, value.error, value.reason]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .join(" ") || String(value);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isPodFileReadFailedError(value: unknown): boolean {
  const statusCode = isRecord(value) && typeof value.statusCode === "number" ? value.statusCode : null;
  const message = errorMessage(value);
  const has502 = statusCode === 502 || /\b(?:API Error|HTTP) 502\b/i.test(message);
  return has502 && /\bPod file read failed\b/i.test(message);
}

export function isSafeAgentFileName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== "." && name !== ".." && !name.includes("..");
}

export function toSafeAgentFileName(name: string): string {
  if (isSafeAgentFileName(name)) return name;

  const lastDot = name.lastIndexOf(".");
  const hasExtension = lastDot > 0 && lastDot < name.length - 1;
  const rawStem = hasExtension ? name.slice(0, lastDot) : name;
  const rawExtension = hasExtension ? name.slice(lastDot + 1) : "";
  const stem = rawStem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "file";
  const extension = rawExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

  return extension ? `${stem}.${extension}` : stem;
}

export function getSafeOpenClawWorkspaceFilePath(path: string): string | null {
  const normalizedPath = normalizeOpenClawWorkspaceFilePath(path);
  if (!normalizedPath.startsWith(`${OPENCLAW_WORKSPACE_PREFIX}/`)) return null;

  const segments = normalizedPath.split("/");
  if (segments.some((segment) => segment === "..")) return null;

  const name = segments.pop();
  if (!name || isSafeAgentFileName(name)) return null;

  segments.push(toSafeAgentFileName(name));
  return segments.join("/");
}

export function openClawWorkspacePathToPodPath(path: string): string | null {
  const normalizedPath = normalizeOpenClawWorkspaceFilePath(path);
  if (normalizedPath === OPENCLAW_WORKSPACE_PREFIX) return OPENCLAW_WORKSPACE_DIR;
  if (!normalizedPath.startsWith(`${OPENCLAW_WORKSPACE_PREFIX}/`)) return null;
  if (normalizedPath.split("/").some((segment) => segment === "..")) return null;
  return `${OPENCLAW_WORKSPACE_DIR}/${normalizedPath.slice(OPENCLAW_WORKSPACE_PREFIX.length + 1)}`;
}

export function podPathToOpenClawWorkspaceFilePath(path: string): string | null {
  const normalizedPath = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedWorkspaceDir = OPENCLAW_WORKSPACE_DIR.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalizedPath === normalizedWorkspaceDir) return OPENCLAW_WORKSPACE_PREFIX;
  if (!normalizedPath.startsWith(`${normalizedWorkspaceDir}/`)) return null;
  return `${OPENCLAW_WORKSPACE_PREFIX}/${normalizedPath.slice(normalizedWorkspaceDir.length + 1)}`;
}

export function buildSafeFileRenameCommand(sourcePodPath: string, candidatePodPath: string): string {
  return [
    "node - <<'NODE'",
    "const fs = require('fs');",
    "const path = require('path');",
    `const source = ${JSON.stringify(sourcePodPath)};`,
    `const candidate = ${JSON.stringify(candidatePodPath)};`,
    "if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {",
    "  console.error(`source is not a file: ${source}`);",
    "  process.exit(1);",
    "}",
    "fs.mkdirSync(path.dirname(candidate), { recursive: true });",
    "const parsed = path.parse(candidate);",
    "let dest = candidate;",
    "let counter = 1;",
    "while (fs.existsSync(dest) && path.resolve(dest) !== path.resolve(source)) {",
    "  dest = path.join(parsed.dir, `${parsed.name}-${counter}${parsed.ext}`);",
    "  counter += 1;",
    "}",
    "fs.renameSync(source, dest);",
    "process.stdout.write(`${dest}\\n`);",
    "NODE",
  ].join("\n");
}

export async function readAgentFileWithRecovery<T>({
  path,
  read,
  rename,
  retryCount = DEFAULT_RETRY_COUNT,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
}: AgentFileReadRecoveryOptions<T>): Promise<AgentFileReadRecoveryResult<T>> {
  const normalizedPath = normalizeOpenClawWorkspaceFilePath(path);

  try {
    return { content: await read(normalizedPath), path: normalizedPath, renamed: false };
  } catch (error) {
    if (!isPodFileReadFailedError(error)) throw error;

    let lastError = error;
    for (let attempt = 0; attempt < retryCount; attempt += 1) {
      await sleep(retryDelayMs);
      try {
        return { content: await read(normalizedPath), path: normalizedPath, renamed: false };
      } catch (retryError) {
        lastError = retryError;
        if (!isPodFileReadFailedError(retryError)) throw retryError;
      }
    }

    const safeCandidatePath = getSafeOpenClawWorkspaceFilePath(normalizedPath);
    if (!safeCandidatePath) throw lastError;

    let renamedPath: string;
    try {
      renamedPath = normalizeOpenClawWorkspaceFilePath(await rename(normalizedPath, safeCandidatePath));
    } catch (renameError) {
      throw new Error(
        `API Error 502: Pod file read failed. Retried the read and tried to rename the file to ${safeCandidatePath}, but rename failed: ${errorMessage(renameError)}`,
      );
    }

    try {
      return { content: await read(renamedPath), path: renamedPath, renamed: true };
    } catch (renamedReadError) {
      throw new Error(
        `API Error 502: Pod file read failed. Retried the read and renamed the file to ${renamedPath}, but reading the renamed file failed: ${errorMessage(renamedReadError)}`,
      );
    }
  }
}
