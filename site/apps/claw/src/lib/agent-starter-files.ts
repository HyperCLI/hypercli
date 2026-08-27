import { toSafeAgentFileName } from "@/lib/agent-file-recovery";
import { OPENCLAW_WORKSPACE_PREFIX } from "@/lib/openclaw-config";
import {
  OPENCLAW_BOOTSTRAP_OPTIONAL_FILES,
  OPENCLAW_BOOTSTRAP_REQUIRED_FILES,
  validateOpenClawBootstrapPack,
  type OpenClawBootstrapFileName,
} from "@/lib/openclaw-bootstrap-pack";

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
  readFileBytes?: (
    agentId: string,
    path: string,
  ) => Promise<ArrayBuffer | Uint8Array>;
  /** Total budget shared by every file's retries. */
  retryTimeoutMs?: number;
  shouldAbort?: () => boolean;
}

interface StageAgentStarterFilesAndStartOptions extends Omit<UploadAgentStarterFilesOptions, "readFileBytes"> {
  readFileBytes: NonNullable<UploadAgentStarterFilesOptions["readFileBytes"]>;
  startAgent: (agentId: string) => Promise<unknown>;
}

export const OPENCLAW_PRESEEDED_CONFIG_PATH = ".openclaw/openclaw.json";

// This suppresses OpenClaw's generated templates only. Existing workspace
// files, including BOOTSTRAP.md, still enter the first turn's Project Context.
const OPENCLAW_PRESEEDED_CONFIG = `${JSON.stringify({
  agents: {
    defaults: {
      skipBootstrap: true,
    },
  },
}, null, 2)}\n`;

// Retained Reef is expected to serve STOPPED agents, but token, DNS, and route
// propagation can briefly lag storage materialization. Each operation mints a
// fresh token and writes are idempotent, so these transient states are safe to
// retry before START.
const STARTER_FILE_UPLOAD_RETRY_TIMEOUT_MS = 420_000;
const STARTER_FILE_UPLOAD_RETRY_DELAYS_MS = [1_000, 2_000, 3_000, 5_000] as const;
const RETRYABLE_FILE_UPLOAD_STATUS_CODES = new Set([
  404, 408, 409, 425, 429, 500, 502, 503, 504,
]);

class AgentStarterFileStagingCancelledError extends Error {
  constructor() {
    super("Workspace setup was cancelled before launch. The agent remains stopped.");
    this.name = "AgentStarterFileStagingCancelledError";
  }
}

function throwIfStarterFileStagingCancelled(shouldAbort?: () => boolean): void {
  if (shouldAbort?.()) throw new AgentStarterFileStagingCancelledError();
}

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

async function runStarterFileOperationWithRetry(
  operation: () => Promise<unknown>,
  { deadline, shouldAbort }: { deadline: number; shouldAbort?: () => boolean },
): Promise<void> {
  let retryIndex = 0;

  while (true) {
    throwIfStarterFileStagingCancelled(shouldAbort);
    try {
      await operation();
      throwIfStarterFileStagingCancelled(shouldAbort);
      return;
    } catch (error) {
      if (!isRetryableFileUploadError(error)) throw error;
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
  return `Workspace setup is incomplete because ${failures.length === 1 ? "one required file" : `${failures.length} required files`} `
    + `could not be staged and verified (${names}): ${failures[0].message}. `
    + "The agent remains stopped; retry setup before starting it.";
}

export class AgentStarterFileStagingError extends Error {
  readonly result: AgentStarterFileUploadResult;

  constructor(result: AgentStarterFileUploadResult) {
    super(describeStarterFileFailures(result.failures));
    this.name = "AgentStarterFileStagingError";
    this.result = result;
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

export function validateOpenClawStarterFiles(files: readonly AgentStarterFile[]): void {
  const allowed = new Set<string>([
    ...OPENCLAW_BOOTSTRAP_REQUIRED_FILES,
    ...OPENCLAW_BOOTSTRAP_OPTIONAL_FILES,
  ]);
  const seen = new Set<string>();

  for (const file of files) {
    if (!allowed.has(file.name)) {
      throw new Error(`Unsupported OpenClaw starter file: ${file.name || "<unnamed>"}`);
    }
    const key = file.name.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate OpenClaw starter file: ${file.name}`);
    seen.add(key);
  }

  for (const required of OPENCLAW_BOOTSTRAP_REQUIRED_FILES) {
    if (!seen.has(required.toLowerCase())) {
      throw new Error(`Missing required OpenClaw starter file: ${required}`);
    }
  }
}

/**
 * Read and validate the exact Markdown bytes before an Agent consumes capacity.
 * The returned files replay the same in-memory bytes during Reef staging.
 */
export async function prepareOpenClawStarterFiles(
  files: readonly AgentStarterFile[],
): Promise<AgentStarterFile[]> {
  validateOpenClawStarterFiles(files);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const prepared: Array<{
    name: OpenClawBootstrapFileName;
    type: string;
    bytes: Uint8Array;
    content: string;
  }> = [];

  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer()).slice();
      prepared.push({
        name: file.name as OpenClawBootstrapFileName,
        type: file.type,
        bytes,
        content: decoder.decode(bytes),
      });
    } catch (error) {
      throw new Error(
        `${file.name || "Workspace file"} could not be read as UTF-8 Markdown: ${starterFileErrorMessage(error)}`,
      );
    }
  }

  validateOpenClawBootstrapPack(prepared.map(({ name, content }) => ({ name, content })));
  return prepared.map(({ name, type, bytes }) => ({
    name,
    size: bytes.byteLength,
    type,
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
  }));
}

function asBytes(content: ArrayBuffer | Uint8Array): Uint8Array {
  return content instanceof Uint8Array
    ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
    : new Uint8Array(content);
}

function equalBytes(left: ArrayBuffer | Uint8Array, right: ArrayBuffer | Uint8Array): boolean {
  const leftBytes = asBytes(left);
  const rightBytes = asBytes(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  return leftBytes.every((value, index) => value === rightBytes[index]);
}

async function writeAndVerifyStarterFile({
  agentId,
  path,
  content,
  writeFileBytes,
  readFileBytes,
  deadline,
  shouldAbort,
}: {
  agentId: string;
  path: string;
  content: ArrayBuffer;
  writeFileBytes: UploadAgentStarterFilesOptions["writeFileBytes"];
  readFileBytes?: UploadAgentStarterFilesOptions["readFileBytes"];
  deadline: number;
  shouldAbort?: UploadAgentStarterFilesOptions["shouldAbort"];
}): Promise<void> {
  await runStarterFileOperationWithRetry(async () => {
    throwIfStarterFileStagingCancelled(shouldAbort);
    await writeFileBytes(agentId, path, content);
    throwIfStarterFileStagingCancelled(shouldAbort);
    if (!readFileBytes) return;
    const persisted = await readFileBytes(agentId, path);
    throwIfStarterFileStagingCancelled(shouldAbort);
    if (!equalBytes(content, persisted)) {
      throw new Error(`Workspace file verification failed for ${path}`);
    }
  }, { deadline, shouldAbort });
}

export async function uploadAgentStarterFiles({
  agentId,
  files,
  writeFileBytes,
  readFileBytes,
  retryTimeoutMs = STARTER_FILE_UPLOAD_RETRY_TIMEOUT_MS,
  shouldAbort,
}: UploadAgentStarterFilesOptions): Promise<AgentStarterFileUploadResult> {
  const usedNames = new Set<string>();
  const uploaded: UploadedAgentStarterFile[] = [];
  const failures: FailedAgentStarterFile[] = [];
  const deadline = Date.now() + retryTimeoutMs;

  for (const file of files) {
    throwIfStarterFileStagingCancelled(shouldAbort);
    const name = uniqueStarterFileName(file.name, usedNames);
    const path = `${OPENCLAW_WORKSPACE_PREFIX}/${name}`;
    let contentSize = file.size;
    try {
      const content = await file.arrayBuffer();
      if (content.byteLength === 0) throw new Error(`${file.name || name} cannot be empty`);
      contentSize = content.byteLength;
      await writeAndVerifyStarterFile({
        agentId,
        path,
        content,
        writeFileBytes,
        readFileBytes,
        deadline,
        shouldAbort,
      });
    } catch (error) {
      if (error instanceof AgentStarterFileStagingCancelledError) throw error;
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
      size: contentSize,
      type: file.type,
    });
  }

  return { uploaded, failures };
}

/**
 * Stage and verify a complete OpenClaw workspace while the Agent is STOPPED,
 * then issue START. Any missing, unwritable, or mismatched file fails closed.
 */
export async function stageAgentStarterFilesAndStart({
  agentId,
  files,
  writeFileBytes,
  readFileBytes,
  startAgent,
  retryTimeoutMs = STARTER_FILE_UPLOAD_RETRY_TIMEOUT_MS,
  shouldAbort,
}: StageAgentStarterFilesAndStartOptions): Promise<AgentStarterFileUploadResult> {
  throwIfStarterFileStagingCancelled(shouldAbort);
  const preparedFiles = await prepareOpenClawStarterFiles(files);
  throwIfStarterFileStagingCancelled(shouldAbort);
  const deadline = Date.now() + retryTimeoutMs;
  const configContent = new TextEncoder().encode(OPENCLAW_PRESEEDED_CONFIG).buffer as ArrayBuffer;

  try {
    await writeAndVerifyStarterFile({
      agentId,
      path: OPENCLAW_PRESEEDED_CONFIG_PATH,
      content: configContent,
      writeFileBytes,
      readFileBytes,
      deadline,
      shouldAbort,
    });
  } catch (error) {
    if (error instanceof AgentStarterFileStagingCancelledError) throw error;
    const detail = starterFileErrorMessage(error);
    throw new Error(`OpenClaw setup could not be staged and verified: ${detail}. The agent remains stopped.`);
  }

  const result = await uploadAgentStarterFiles({
    agentId,
    files: preparedFiles,
    writeFileBytes,
    readFileBytes,
    retryTimeoutMs: Math.max(deadline - Date.now(), 0),
    shouldAbort,
  });

  if (result.failures.length > 0) throw new AgentStarterFileStagingError(result);
  throwIfStarterFileStagingCancelled(shouldAbort);
  await startAgent(agentId);
  return result;
}
