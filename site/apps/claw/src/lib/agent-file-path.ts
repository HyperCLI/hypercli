import { OPENCLAW_WORKSPACE_DIR, OPENCLAW_WORKSPACE_PREFIX } from "@/lib/openclaw-config";

export function normalizeAgentFilePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/^\.\//, "");
}

export function normalizeOpenClawWorkspaceFilePath(path: string): string {
  const normalized = normalizeAgentFilePath(path);
  const workspacePrefix = normalizeAgentFilePath(OPENCLAW_WORKSPACE_PREFIX);
  const syncWorkspaceDir = normalizeAgentFilePath(OPENCLAW_WORKSPACE_DIR);

  if (normalized === syncWorkspaceDir) return workspacePrefix;
  if (normalized.startsWith(`${syncWorkspaceDir}/`)) {
    return `${workspacePrefix}/${normalized.slice(syncWorkspaceDir.length + 1)}`;
  }

  if (normalized === "workspace") return workspacePrefix;
  if (normalized.startsWith("workspace/")) {
    return `${workspacePrefix}/${normalized.slice("workspace/".length)}`;
  }

  return normalized;
}
