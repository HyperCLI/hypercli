"use client";

import { useMemo } from "react";
import {
  File,
  FileCode2,
  FileArchive,
  FileAudio,
  FileVideo,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderTree,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { formatFileSize, resolveFileType } from "@hypercli/shared-ui/files";

export type DirectoryVisualizationEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  missing?: boolean;
  children?: DirectoryVisualizationEntry[];
};

export interface DirectoryVisualizationData {
  rootPath?: string;
  entries: DirectoryVisualizationEntry[];
  truncated?: boolean;
}

interface DirectoryVisualizationProps extends DirectoryVisualizationData {
  title?: string;
  maxRows?: number;
}

type TreeNode = DirectoryVisualizationEntry & {
  children: TreeNode[];
};

type FlatRow = TreeNode & {
  depth: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  return normalized.split("/").filter(Boolean).pop() || path || "workspace";
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function pathRelativeToRoot(path: string, rootPath?: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(rootPath ?? "");
  if (!normalizedRoot) return normalizedPath;
  if (normalizedPath === normalizedRoot) return basename(normalizedRoot);
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function readSize(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function readEntryType(record: Record<string, unknown>, path: string): "file" | "directory" | null {
  const rawType = typeof record.type === "string" ? record.type.toLowerCase() : "";
  if (rawType === "directory" || rawType === "dir" || rawType === "folder") return "directory";
  if (rawType === "file") return "file";
  if (record.isDirectory === true || record.directory === true) return "directory";
  if (Array.isArray(record.children) || Array.isArray(record.files) || Array.isArray(record.directories)) return "directory";
  if (path.endsWith("/")) return "directory";
  if (typeof record.name === "string" || typeof record.path === "string") return "file";
  return null;
}

function normalizeEntry(value: unknown, fallbackRoot = ""): DirectoryVisualizationEntry | null {
  if (!isRecord(value)) return null;

  const rawPath =
    (typeof value.path === "string" && value.path.trim()) ||
    (typeof value.fullPath === "string" && value.fullPath.trim()) ||
    (typeof value.file_path === "string" && value.file_path.trim()) ||
    (typeof value.name === "string" && value.name.trim()) ||
    "";
  if (!rawPath) return null;

  const normalizedPath = normalizePath(rawPath);
  const type = readEntryType(value, rawPath);
  if (!type) return null;

  const rawName = typeof value.name === "string" && value.name.trim()
    ? value.name.trim().replace(/\/+$/, "")
    : basename(normalizedPath);
  const name = rawName || basename(normalizedPath);
  const path = normalizedPath || normalizePath(`${fallbackRoot}/${name}`);
  const nestedEntries = [
    ...(Array.isArray(value.directories) ? value.directories : []),
    ...(Array.isArray(value.files) ? value.files : []),
    ...(Array.isArray(value.children) ? value.children : []),
  ].map((entry) => normalizeEntry(entry, path)).filter((entry): entry is DirectoryVisualizationEntry => Boolean(entry));

  return {
    name,
    path,
    type,
    ...(readSize(value.size) !== undefined ? { size: readSize(value.size) } : {}),
    ...(value.missing === true ? { missing: true } : {}),
    ...(nestedEntries.length > 0 ? { children: nestedEntries } : {}),
  };
}

function normalizeEntries(values: unknown[], fallbackRoot = ""): DirectoryVisualizationEntry[] {
  return values
    .map((value) => normalizeEntry(value, fallbackRoot))
    .filter((entry): entry is DirectoryVisualizationEntry => Boolean(entry));
}

function stripMarkdownFence(raw: string): string {
  const trimmed = raw.trim();
  const match = /^```(?:json|text)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

function parseUnknownJson(raw: string): unknown | null {
  const candidate = stripMarkdownFence(raw);
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function rootPathFromRecord(record: Record<string, unknown>): string | undefined {
  const raw =
    (typeof record.path === "string" && record.path.trim()) ||
    (typeof record.prefix === "string" && record.prefix.trim()) ||
    (typeof record.root === "string" && record.root.trim()) ||
    (typeof record.rootPath === "string" && record.rootPath.trim()) ||
    "";
  return raw ? normalizePath(raw) : undefined;
}

export function parseDirectoryVisualization(value: unknown): DirectoryVisualizationData | null {
  const parsed = typeof value === "string" ? parseUnknownJson(value) : value;
  if (!parsed) return null;

  if (Array.isArray(parsed)) {
    const entries = normalizeEntries(parsed);
    const hasExplicitFileTypes = parsed.some((entry) => isRecord(entry) && typeof entry.type === "string");
    return entries.length > 0 && hasExplicitFileTypes ? { entries } : null;
  }

  if (!isRecord(parsed)) return null;

  const directories = Array.isArray(parsed.directories) ? parsed.directories : [];
  const files = Array.isArray(parsed.files) ? parsed.files : [];
  const entries = Array.isArray(parsed.entries)
    ? parsed.entries
    : Array.isArray(parsed.items)
      ? parsed.items
      : [];
  const rootPath = rootPathFromRecord(parsed);

  if (directories.length > 0 || files.length > 0) {
    return {
      rootPath,
      entries: normalizeEntries([...directories, ...files], rootPath),
      truncated: parsed.truncated === true,
    };
  }

  if (entries.length > 0) {
    const normalizedEntries = normalizeEntries(entries, rootPath);
    if (normalizedEntries.length === 0) return null;
    return {
      rootPath,
      entries: normalizedEntries,
      truncated: parsed.truncated === true,
    };
  }

  if (parsed.type === "directory") {
    const normalized = normalizeEntry(parsed);
    if (!normalized) return null;
    return {
      rootPath: normalized.path,
      entries: normalized.children ?? [],
      truncated: parsed.truncated === true,
    };
  }

  return null;
}

function flattenEntries(entries: DirectoryVisualizationEntry[]): DirectoryVisualizationEntry[] {
  const result: DirectoryVisualizationEntry[] = [];
  for (const entry of entries) {
    result.push(entry);
    if (entry.children?.length) result.push(...flattenEntries(entry.children));
  }
  return result;
}

function ensureDirectory(map: Map<string, TreeNode>, path: string): TreeNode {
  const normalized = normalizePath(path);
  const existing = map.get(normalized);
  if (existing) return existing;

  const node: TreeNode = {
    name: basename(normalized),
    path: normalized,
    type: "directory",
    children: [],
  };
  map.set(normalized, node);
  const parentPath = dirname(normalized);
  if (parentPath && parentPath !== normalized) {
    ensureDirectory(map, parentPath).children.push(node);
  }
  return node;
}

function buildTree(entries: DirectoryVisualizationEntry[], rootPath?: string): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const allEntries = flattenEntries(entries).map((entry) => ({
    ...entry,
    path: pathRelativeToRoot(entry.path || entry.name, rootPath),
  }));

  for (const entry of allEntries) {
    const path = normalizePath(entry.path || entry.name);
    const node: TreeNode = {
      ...entry,
      path,
      name: entry.name || basename(path),
      children: [],
    };
    nodes.set(path, node);
  }

  for (const entry of allEntries) {
    const path = normalizePath(entry.path || entry.name);
    const node = nodes.get(path);
    if (!node) continue;
    const parentPath = dirname(path);
    if (parentPath) {
      ensureDirectory(nodes, parentPath).children.push(node);
    }
  }

  const childPaths = new Set<string>();
  for (const node of nodes.values()) {
    node.children = dedupeAndSort(node.children);
    for (const child of node.children) childPaths.add(child.path);
  }

  return dedupeAndSort(Array.from(nodes.values()).filter((node) => !childPaths.has(node.path)));
}

function dedupeAndSort(nodes: TreeNode[]): TreeNode[] {
  const byPath = new Map<string, TreeNode>();
  for (const node of nodes) byPath.set(node.path, node);
  return Array.from(byPath.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function flattenTree(nodes: TreeNode[], depth = 0): FlatRow[] {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flattenTree(node.children, depth + 1),
  ]);
}

function entryCounts(entries: DirectoryVisualizationEntry[]): { files: number; directories: number } {
  return flattenEntries(entries).reduce((counts, entry) => {
    if (entry.type === "directory") counts.directories += 1;
    else counts.files += 1;
    return counts;
  }, { files: 0, directories: 0 });
}

function iconForEntry(entry: DirectoryVisualizationEntry): { icon: LucideIcon; className: string } {
  if (entry.type === "directory") return { icon: Folder, className: "text-chart-2" };
  const fileType = resolveFileType(entry.name || entry.path);
  switch (fileType.iconKind) {
    case "archive": return { icon: FileArchive, className: "text-warning" };
    case "audio": return { icon: FileAudio, className: "text-chart-2" };
    case "code": return { icon: FileCode2, className: "text-chart-2" };
    case "image": return { icon: FileImage, className: "text-primary" };
    case "json": return { icon: FileJson, className: "text-chart-2" };
    case "settings": return { icon: Settings, className: "text-warning" };
    case "text": return { icon: FileText, className: "text-text-secondary" };
    case "video": return { icon: FileVideo, className: "text-chart-4" };
    case "document":
    case "presentation":
    case "spreadsheet": return { icon: FileText, className: "text-text-secondary" };
    default: return { icon: File, className: "text-text-muted" };
  }
}

export function DirectoryVisualization({
  title = "Directory",
  rootPath,
  entries,
  truncated = false,
  maxRows = 80,
}: DirectoryVisualizationProps) {
  const { rows, hiddenCount, counts } = useMemo(() => {
    const tree = buildTree(entries, rootPath);
    const flatRows = flattenTree(tree);
    return {
      rows: flatRows.slice(0, maxRows),
      hiddenCount: Math.max(flatRows.length - maxRows, 0),
      counts: entryCounts(entries),
    };
  }, [entries, maxRows, rootPath]);

  if (entries.length === 0) return null;

  return (
    <section
      aria-label={rootPath ? `Directory ${rootPath}` : "Directory listing"}
      className="mb-2 w-full min-w-0 overflow-hidden rounded-lg border border-border bg-background/55 text-xs shadow-lg"
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface-low/40 px-3 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/70 text-chart-2">
          <FolderTree className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">{title}</p>
          {rootPath && <p className="truncate font-mono text-[10px] text-text-muted">{rootPath}</p>}
        </div>
        <div className="hidden shrink-0 items-center gap-1.5 text-[10px] text-text-muted sm:flex">
          <span>{counts.directories} dirs</span>
          <span className="text-border">/</span>
          <span>{counts.files} files</span>
        </div>
      </div>

      <div role="tree" className="max-h-72 overflow-y-auto px-2 py-2">
        {rows.map((entry) => {
          const EntryIcon = iconForEntry(entry).icon;
          const iconClassName = iconForEntry(entry).className;
          return (
            <div
              key={`${entry.path}-${entry.depth}`}
              role="treeitem"
              aria-level={entry.depth + 1}
              aria-selected={false}
              className="flex min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-text-secondary"
              style={{ paddingLeft: 6 + entry.depth * 14 }}
            >
              <EntryIcon className={`h-3.5 w-3.5 shrink-0 ${iconClassName}`} />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-5 text-foreground">
                {entry.name}
              </span>
              {entry.missing && (
                <span className="shrink-0 rounded border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[9px] uppercase text-destructive">
                  Missing
                </span>
              )}
              {entry.type === "file" && entry.size !== undefined && (
                <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
                  {formatFileSize(entry.size)}
                </span>
              )}
            </div>
          );
        })}
        {(hiddenCount > 0 || truncated) && (
          <div className="px-2 pb-1 pt-1 text-[10px] text-text-muted">
            {hiddenCount > 0 ? `${hiddenCount} more hidden` : "Listing truncated"}
          </div>
        )}
      </div>
    </section>
  );
}
