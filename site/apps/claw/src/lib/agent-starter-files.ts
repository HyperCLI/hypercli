import { toSafeAgentFileName } from "@/lib/agent-file-recovery";
import { OPENCLAW_WORKSPACE_PREFIX } from "@/lib/openclaw-config";

export interface AgentStarterFile {
  name: string;
  size: number;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface UploadedAgentStarterFile {
  originalName: string;
  name: string;
  path: string;
  size: number;
  type: string;
}

interface UploadAgentStarterFilesOptions {
  agentId: string;
  files: AgentStarterFile[];
  writeFileBytes: (
    agentId: string,
    path: string,
    content: ArrayBuffer,
  ) => Promise<unknown>;
}

interface StageAgentStarterFilesAndStartOptions extends UploadAgentStarterFilesOptions {
  startAgent: (agentId: string) => Promise<unknown>;
}

const STARTER_FILE_UPLOAD_RETRY_TIMEOUT_MS = 90_000;
const STARTER_FILE_UPLOAD_RETRY_DELAYS_MS = [1_000, 2_000, 5_000] as const;
const RETRYABLE_FILE_UPLOAD_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRetryableFileUploadError(error: unknown): boolean {
  const statusCode = isRecord(error)
    ? typeof error.statusCode === "number"
      ? error.statusCode
      : typeof error.status === "number"
        ? error.status
        : null
    : null;
  if (statusCode !== null) return RETRYABLE_FILE_UPLOAD_STATUS_CODES.has(statusCode);

  const message = error instanceof Error ? error.message : String(error);
  return error instanceof TypeError
    && /failed to fetch|network(?:error| request failed)|load failed/i.test(message);
}

async function writeStarterFileWithRetry(
  write: () => Promise<unknown>,
): Promise<void> {
  const startedAt = Date.now();
  let retryIndex = 0;

  while (true) {
    try {
      await write();
      return;
    } catch (error) {
      if (!isRetryableFileUploadError(error)) throw error;
      const delay = STARTER_FILE_UPLOAD_RETRY_DELAYS_MS[
        Math.min(retryIndex, STARTER_FILE_UPLOAD_RETRY_DELAYS_MS.length - 1)
      ];
      if (Date.now() - startedAt + delay > STARTER_FILE_UPLOAD_RETRY_TIMEOUT_MS) throw error;
      retryIndex += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function appendNameSuffix(name: string, suffix: number): string {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return `${name}-${suffix}`;
  return `${name.slice(0, dotIndex)}-${suffix}${name.slice(dotIndex)}`;
}

export function uniqueStarterFileName(name: string, usedNames: Set<string>): string {
  const safeName = toSafeAgentFileName(name || "file");
  let candidate = safeName;
  let suffix = 1;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = appendNameSuffix(safeName, suffix);
    suffix += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export async function uploadAgentStarterFiles({
  agentId,
  files,
  writeFileBytes,
}: UploadAgentStarterFilesOptions): Promise<UploadedAgentStarterFile[]> {
  const usedNames = new Set<string>();
  const uploaded: UploadedAgentStarterFile[] = [];

  for (const file of files) {
    const name = uniqueStarterFileName(file.name, usedNames);
    const path = `${OPENCLAW_WORKSPACE_PREFIX}/${name}`;
    const content = await file.arrayBuffer();
    await writeStarterFileWithRetry(() => writeFileBytes(agentId, path, content));
    uploaded.push({
      originalName: file.name,
      name,
      path,
      size: file.size,
      type: file.type,
    });
  }

  return uploaded;
}

export async function stageAgentStarterFilesAndStart({
  agentId,
  files,
  writeFileBytes,
  startAgent,
}: StageAgentStarterFilesAndStartOptions): Promise<UploadedAgentStarterFile[]> {
  const uploaded = await uploadAgentStarterFiles({
    agentId,
    files,
    writeFileBytes,
  });
  await startAgent(agentId);
  return uploaded;
}
