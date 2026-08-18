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

export interface FailedAgentStarterFile {
  originalName: string;
  name: string;
  path: string;
  message: string;
  error: unknown;
}

export interface AgentStarterFileUploadResult {
  uploaded: UploadedAgentStarterFile[];
  failures: FailedAgentStarterFile[];
}

interface UploadAgentStarterFilesOptions {
  agentId: string;
  files: AgentStarterFile[];
  writeFileBytes: (
    agentId: string,
    path: string,
    content: ArrayBuffer,
  ) => Promise<unknown>;
  /** Total budget shared by every file's retries. */
  retryTimeoutMs?: number;
  /** Stop retrying early — used to abandon staging once the launch itself failed. */
  shouldAbort?: () => boolean;
}

interface StageAgentStarterFilesAndStartOptions extends UploadAgentStarterFilesOptions {
  startAgent: (agentId: string) => Promise<unknown>;
}

// Reef only answers on the agent hostname once the deployment's pod is ready:
// while the Agent is CREATING/STARTING the file-token endpoint replies 409, and
// while it is STOPPED the agent hostname's edge replies 404. Both clear on their
// own within a launch, so the write is retried until the route exists. Every
// attempt re-mints its own short-lived token and the write is idempotent, so
// retrying is always safe.
const STARTER_FILE_UPLOAD_RETRY_TIMEOUT_MS = 420_000;
const STARTER_FILE_UPLOAD_RETRY_DELAYS_MS = [1_000, 2_000, 3_000, 5_000] as const;
const RETRYABLE_FILE_UPLOAD_STATUS_CODES = new Set([
  404, 408, 409, 425, 429, 500, 502, 503, 504,
]);

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
  { deadline, shouldAbort }: { deadline: number; shouldAbort?: () => boolean },
): Promise<void> {
  let retryIndex = 0;

  while (true) {
    try {
      await write();
      return;
    } catch (error) {
      if (!isRetryableFileUploadError(error)) throw error;
      if (shouldAbort?.()) throw error;
      const delay = STARTER_FILE_UPLOAD_RETRY_DELAYS_MS[
        Math.min(retryIndex, STARTER_FILE_UPLOAD_RETRY_DELAYS_MS.length - 1)
      ];
      if (Date.now() + delay > deadline) throw error;
      retryIndex += 1;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function starterFileErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  const text = String(error ?? "").trim();
  return text || "The workspace file route was unavailable.";
}

export function describeStarterFileFailures(failures: FailedAgentStarterFile[]): string {
  if (failures.length === 0) return "";
  const names = failures.map((failure) => failure.originalName || failure.name).join(", ");
  return `Agent started, but ${failures.length === 1 ? "one starter file" : `${failures.length} starter files`} `
    + `could not be uploaded (${names}): ${failures[0].message}. `
    + "Add them from the agent's Files tab.";
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
  retryTimeoutMs = STARTER_FILE_UPLOAD_RETRY_TIMEOUT_MS,
  shouldAbort,
}: UploadAgentStarterFilesOptions): Promise<AgentStarterFileUploadResult> {
  const usedNames = new Set<string>();
  const uploaded: UploadedAgentStarterFile[] = [];
  const failures: FailedAgentStarterFile[] = [];
  const deadline = Date.now() + retryTimeoutMs;

  for (const file of files) {
    const name = uniqueStarterFileName(file.name, usedNames);
    const path = `${OPENCLAW_WORKSPACE_PREFIX}/${name}`;
    try {
      const content = await file.arrayBuffer();
      await writeStarterFileWithRetry(
        () => writeFileBytes(agentId, path, content),
        { deadline, shouldAbort },
      );
    } catch (error) {
      // One unwritable file must never strand the rest of the pack.
      failures.push({
        originalName: file.name,
        name,
        path,
        message: starterFileErrorMessage(error),
        error,
      });
      continue;
    }
    uploaded.push({
      originalName: file.name,
      name,
      path,
      size: file.size,
      type: file.type,
    });
  }

  return { uploaded, failures };
}

/**
 * Start the Agent and stage its starter files together.
 *
 * The write route only exists once the deployment's pod is ready, so the upload
 * cannot precede the start; it runs alongside it and retries until the route
 * answers. A file that never lands is reported through `failures` — it never
 * cancels or fails the launch.
 */
export async function stageAgentStarterFilesAndStart({
  agentId,
  files,
  writeFileBytes,
  startAgent,
  retryTimeoutMs,
}: StageAgentStarterFilesAndStartOptions): Promise<AgentStarterFileUploadResult> {
  let startFailed = false;
  const startOutcome = startAgent(agentId).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => {
      startFailed = true;
      return { ok: false as const, error };
    },
  );

  const result = await uploadAgentStarterFiles({
    agentId,
    files,
    writeFileBytes,
    retryTimeoutMs,
    shouldAbort: () => startFailed,
  });

  const started = await startOutcome;
  if (!started.ok) throw started.error;
  return result;
}
