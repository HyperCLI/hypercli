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

function escapesAbsoluteFilesystemRoot(path: string): boolean {
  const replaced = path.trim().replace(/\\/g, "/");
  if (!replaced.startsWith("/")) return false;

  let depth = 0;
  for (const segment of replaced.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (depth === 0) return true;
      depth -= 1;
    } else {
      depth += 1;
    }
  }
  return false;
}

export function resolveAgentFileSourcePath(path: string, syncRoot: string): string {
  if (escapesAbsoluteFilesystemRoot(path)) {
    throw new Error("This location is browse-only.");
  }
  const normalizedPath = normalizeAgentBrowserFilePath(path);
  if (!normalizedPath.startsWith("/")) {
    if (normalizedPath === ".." || normalizedPath.startsWith("../")) {
      throw new Error("This location is browse-only.");
    }
    return normalizedPath;
  }

  const normalizedRoot = normalizeAgentBrowserFilePath(syncRoot);
  if (!normalizedRoot.startsWith("/")) {
    throw new Error("The synchronized filesystem root is unavailable.");
  }
  if (normalizedPath === normalizedRoot) return "";
  if (normalizedRoot === "/") return normalizedPath.slice(1);
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  throw new Error("This location is browse-only.");
}

export function resolveAgentFileReadPath(path: string, syncRoot: string): string {
  return syncRoot
    ? resolveAgentFileSourcePath(path, syncRoot)
    : normalizeOpenClawWorkspaceFilePath(path);
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

export function normalizeOpenClawMediaFilePath(path: string, syncRoot = ""): string {
  const trimmed = path.trim().replace(/^MEDIA:\s*/i, "");
  const browserPath = normalizeAgentBrowserFilePath(trimmed);
  if (browserPath.startsWith("/") && syncRoot) {
    try {
      resolveAgentFileSourcePath(browserPath, syncRoot);
      // Keep source-root paths absolute until the shared Files adapter resolves
      // them. This avoids confusing a real `workspace/` directory with the
      // legacy OpenClaw workspace shorthand below.
      return browserPath;
    } catch {
      // Preserve the existing display-alias handling for paths outside the root.
    }
  }
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
