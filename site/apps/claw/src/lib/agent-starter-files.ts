import { toSafeAgentFileName } from "@/lib/agent-file-recovery";
import { OPENCLAW_WORKSPACE_PREFIX } from "@/lib/openclaw-config";

type StarterFileDestination = "auto" | "pod" | "s3";

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
    destination: StarterFileDestination,
  ) => Promise<unknown>;
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
    await writeFileBytes(agentId, path, await file.arrayBuffer(), "s3");
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
