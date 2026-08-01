import { OPENCLAW_WORKSPACE_DIR, OPENCLAW_WORKSPACE_PREFIX } from "@/lib/openclaw-config";

export function launchConfigSyncRoot(launchConfig: unknown): string {
  if (!launchConfig || typeof launchConfig !== "object" || Array.isArray(launchConfig)) return "";
  const configured = (launchConfig as Record<string, unknown>).sync_root;
  if (typeof configured !== "string" || !configured.trim().startsWith("/")) return "";
  return normalizeAgentBrowserFilePath(configured);
}

export function normalizeAgentFilePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/^\.\//, "");
}

export function normalizeAgentBrowserFilePath(path: string): string {
  const replaced = path.trim().replace(/\\/g, "/");
  const absolute = replaced.startsWith("/");
  const segments: string[] = [];
  for (const segment of replaced.replace(/^\.\//, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else if (!absolute) segments.push(segment);
      continue;
    }
    segments.push(segment);
  }
  const normalized = segments.join("/");
  return absolute ? (normalized ? `/${normalized}` : "/") : normalized;
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

export function normalizeOpenClawMediaDisplayPath(path: string): string {
  const trimmed = path.trim().replace(/^MEDIA:\s*/i, "");
  const normalized = normalizeAgentFilePath(trimmed);
  const workspacePrefix = normalizeAgentFilePath(OPENCLAW_WORKSPACE_PREFIX);
  const syncWorkspaceDir = normalizeAgentFilePath(OPENCLAW_WORKSPACE_DIR);

  if (normalized === syncWorkspaceDir || normalized === workspacePrefix || normalized === "workspace") {
    return "/home";
  }
  if (normalized.startsWith(`${syncWorkspaceDir}/`)) {
    return `/home/${normalized.slice(syncWorkspaceDir.length + 1)}`;
  }
  if (normalized.startsWith(`${workspacePrefix}/`)) {
    return `/home/${normalized.slice(workspacePrefix.length + 1)}`;
  }
  if (normalized.startsWith("workspace/")) {
    return `/home/${normalized.slice("workspace/".length)}`;
  }

  return trimmed.startsWith("/") ? trimmed : `/${normalized}`;
}

export function normalizeOpenClawMediaFilePath(path: string): string {
  const trimmed = path.trim().replace(/^MEDIA:\s*/i, "");
  const normalized = normalizeAgentFilePath(trimmed);
  const workspacePrefix = normalizeAgentFilePath(OPENCLAW_WORKSPACE_PREFIX);
  const syncWorkspaceDir = normalizeAgentFilePath(OPENCLAW_WORKSPACE_DIR);

  if (normalized === syncWorkspaceDir || normalized.startsWith(`${syncWorkspaceDir}/`)) {
    return normalizeOpenClawWorkspaceFilePath(trimmed);
  }
  if (normalized === workspacePrefix || normalized.startsWith(`${workspacePrefix}/`)) {
    return normalizeOpenClawWorkspaceFilePath(trimmed);
  }
  if (normalized === "workspace" || normalized.startsWith("workspace/")) {
    return normalizeOpenClawWorkspaceFilePath(trimmed);
  }

  if (normalized === "home") return workspacePrefix;
  if (normalized.startsWith("home/")) {
    return `${workspacePrefix}/${normalized.slice("home/".length)}`;
  }

  return normalizeOpenClawWorkspaceFilePath(trimmed);
}
