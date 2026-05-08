import type { FileEntry } from "../files/types";

export type AgentFileSource = "auto" | "pod" | "s3";

export interface WorkspaceSkill {
  id: string;
  name: string;
  description: string;
  path: string;
  directoryPath: string;
  content: string;
  frontmatter: string;
  body: string;
  category: string;
  emoji?: string;
  homepage?: string;
  requiresEnv: string[];
  requiresBins: string[];
  os: string[];
  installHints: string[];
  disabled?: boolean;
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
}

interface WorkspaceSkillSnapshot {
  id: string;
  path: string;
  content: string;
  entries?: FileEntry[];
}

export const SKILLS_DIRECTORY = "/app/skills";

const PLATFORM_SKILLS = new Set([
  "discord",
  "slack",
  "github",
  "gh-issues",
  "trello",
  "notion",
  "bluebubbles",
  "imsg",
]);

const MEDIA_SKILLS = new Set([
  "video-frames",
  "gifgrep",
  "sag",
  "openai-whisper",
  "openai-whisper-api",
  "summarize",
]);

const SYSTEM_SKILLS = new Set([
  "tmux",
  "coding-agent",
  "canvas",
  "healthcheck",
  "node-connect",
  "xurl",
]);

const PRODUCTIVITY_SKILLS = new Set([
  "apple-notes",
  "bear-notes",
  "obsidian",
  "things-mac",
  "apple-reminders",
  "himalaya",
]);

const HARDWARE_SKILLS = new Set([
  "sonoscli",
  "openhue",
  "camsnap",
  "eightctl",
  "mcporter",
]);

const LOOKUP_SKILLS = new Set([
  "weather",
  "goplaces",
  "gemini",
  "oracle",
  "blogwatcher",
]);

const AUTHORING_SKILLS = new Set([
  "skill-creator",
  "taskflow",
  "taskflow-inbox-triage",
  "model-usage",
  "session-logs",
]);

function normalizeWorkspacePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function pathFromListing(entryPath: string, parentPath: string): string {
  const absolute = parentPath.startsWith("/");
  if (entryPath.startsWith("/")) return entryPath.replace(/\/+$/, "");
  const path = normalizeWorkspacePath(entryPath);
  const parent = normalizeWorkspacePath(parentPath);
  const resolved = !parent || path === parent || path.startsWith(`${parent}/`) ? path : `${parent}/${path}`;
  return absolute ? `/${resolved}` : resolved;
}

function titleFromSkillId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function displayNameFromSkillName(value: string | undefined, id: string): string {
  if (!value) return titleFromSkillId(id);
  return value === id ? titleFromSkillId(id) : value;
}

function stripWrappingQuotes(value: string): string {
  let next = value.trim().replace(/,\s*$/, "").trim();
  if (
    (next.startsWith('"') && next.endsWith('"')) ||
    (next.startsWith("'") && next.endsWith("'"))
  ) {
    next = next.slice(1, -1);
  }
  return next.replace(/\\"/g, '"').replace(/\\'/g, "'");
}

function extractFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { frontmatter: "", body: content };
  return {
    frontmatter: match[1] ?? "",
    body: content.slice(match[0].length),
  };
}

function frontmatterScalar(frontmatter: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = frontmatter.match(new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "m"));
  const raw = match?.[1]?.trim();
  if (!raw || raw === "|" || raw === ">") return undefined;
  return stripWrappingQuotes(raw);
}

function frontmatterBoolean(frontmatter: string, key: string): boolean | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = frontmatter.match(new RegExp(`["']?${escaped}["']?\\s*:\\s*(true|false|yes|no|on|off|1|0)`, "i"));
  const normalized = match?.[1]?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") return false;
  return undefined;
}

function arrayFromInlineValue(value: string): string[] {
  const quoted = Array.from(value.matchAll(/["']([^"']+)["']/g)).map((match) => match[1]?.trim()).filter(Boolean) as string[];
  if (quoted.length > 0) return quoted;
  return value
    .split(",")
    .map((part) => stripWrappingQuotes(part))
    .filter(Boolean);
}

function frontmatterArray(frontmatter: string, key: string): string[] {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inline = frontmatter.match(new RegExp(`["']?${escaped}["']?\\s*:\\s*\\[([^\\]]*)\\]`, "m"));
  if (inline?.[1]) return arrayFromInlineValue(inline[1]);

  const lines = frontmatter.split(/\r?\n/);
  const keyPattern = new RegExp(`^(\\s*)["']?${escaped}["']?\\s*:\\s*$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(keyPattern);
    if (!match) continue;

    const baseIndent = match[1]?.length ?? 0;
    const items: string[] = [];
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const line = lines[nextIndex] ?? "";
      if (!line.trim()) continue;
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= baseIndent) break;
      const item = line.trim().match(/^-\s*(.+)$/)?.[1];
      if (item) items.push(stripWrappingQuotes(item));
    }
    return items;
  }

  return [];
}

function openClawEmoji(frontmatter: string): string | undefined {
  const match = frontmatter.match(/["']?emoji["']?\s*:\s*["']?([^"',\n}\]]+)/);
  return match?.[1]?.trim();
}

function skillCategory(id: string): string {
  if (PLATFORM_SKILLS.has(id)) return "Platform";
  if (MEDIA_SKILLS.has(id)) return "Media";
  if (SYSTEM_SKILLS.has(id)) return "System";
  if (PRODUCTIVITY_SKILLS.has(id)) return "Productivity";
  if (HARDWARE_SKILLS.has(id)) return "Hardware";
  if (LOOKUP_SKILLS.has(id)) return "Lookups";
  if (AUTHORING_SKILLS.has(id)) return "Authoring";
  return "General";
}

function firstMarkdownParagraph(body: string): string | undefined {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => (
      line &&
      !line.startsWith("#") &&
      !line.startsWith("```") &&
      !line.startsWith("- ") &&
      !line.startsWith("|")
    ));
}

export function parseSkillFile(
  skillId: string,
  path: string,
  content: string,
  entries: FileEntry[] = [],
): WorkspaceSkill {
  const { frontmatter, body } = extractFrontmatter(content);
  const markdownHeading = body.split(/\r?\n/).find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, "").trim();
  const [headingName, headingDescription] = markdownHeading?.split(/\s+(?:--|-|\u2014)\s+/, 2) ?? [];
  const directoryPath = path.replace(/\/SKILL\.md$/i, "");
  const directoryNames = new Set(
    entries
      .filter((entry) => entry.type === "directory")
      .map((entry) => entry.name.toLowerCase()),
  );
  const installHints = frontmatterArray(frontmatter, "install");
  const hasInstallMetadata = installHints.length > 0 || /["']?install["']?\s*:/.test(frontmatter);
  const requiresEnv = frontmatterArray(frontmatter, "env");
  const primaryEnv = frontmatterScalar(frontmatter, "primaryEnv");

  return {
    id: skillId,
    name: displayNameFromSkillName(frontmatterScalar(frontmatter, "name") || headingName, skillId),
    description:
      frontmatterScalar(frontmatter, "description") ||
      headingDescription ||
      firstMarkdownParagraph(body) ||
      "Workspace skill",
    path,
    directoryPath,
    content,
    frontmatter,
    body,
    category: skillCategory(skillId),
    emoji: openClawEmoji(frontmatter),
    homepage: frontmatterScalar(frontmatter, "homepage"),
    requiresEnv: requiresEnv.length > 0 ? requiresEnv : primaryEnv ? [primaryEnv] : [],
    requiresBins: frontmatterArray(frontmatter, "bins"),
    os: frontmatterArray(frontmatter, "os"),
    installHints: hasInstallMetadata && installHints.length === 0 ? ["install metadata"] : installHints,
    disabled: frontmatterBoolean(frontmatter, "disabled") === true || frontmatterBoolean(frontmatter, "enabled") === false,
    hasScripts: directoryNames.has("scripts"),
    hasReferences: directoryNames.has("references"),
    hasAssets: directoryNames.has("assets"),
  };
}

export async function loadSystemSkills(
  listFiles: (path?: string, source?: AgentFileSource) => Promise<FileEntry[]>,
  readFile: (path: string, source?: AgentFileSource) => Promise<string>,
): Promise<WorkspaceSkill[]> {
  const entries = await listFiles(SKILLS_DIRECTORY, "pod");
  const skillDirs = entries.filter((entry) => entry.type === "directory");
  const skillFiles = entries.filter((entry) => entry.type === "file" && entry.name.toLowerCase() === "skill.md");
  const candidates = [
    ...skillDirs.map((entry) => {
      const dirPath = pathFromListing(entry.path, SKILLS_DIRECTORY);
      const skillId = dirPath.split("/").filter(Boolean).pop() || entry.name;
      return { id: skillId, dirPath, path: `${dirPath}/SKILL.md` };
    }),
    ...skillFiles.map((entry) => {
      const path = pathFromListing(entry.path, SKILLS_DIRECTORY);
      const dirPath = path.replace(/\/SKILL\.md$/i, "");
      const parent = path.split("/").slice(-2, -1)[0] || "workspace";
      return { id: parent, dirPath, path };
    }),
  ];
  const uniqueCandidates = Array.from(new Map(candidates.map((candidate) => [candidate.path, candidate])).values());

  const results = await Promise.allSettled(
    uniqueCandidates.map(async (candidate) => {
      const [contentResult, entriesResult] = await Promise.allSettled([
        readFile(candidate.path, "pod"),
        listFiles(candidate.dirPath, "pod"),
      ]);
      if (contentResult.status !== "fulfilled") throw contentResult.reason;
      const directoryEntries = entriesResult.status === "fulfilled" ? entriesResult.value : [];
      return parseSkillFile(candidate.id, candidate.path, contentResult.value, directoryEntries);
    }),
  );

  return results
    .filter((result): result is PromiseFulfilledResult<WorkspaceSkill> => result.status === "fulfilled")
    .map((result) => result.value)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildSkillsSnapshotCommand(root: string = SKILLS_DIRECTORY): string {
  const script = [
    'const fs=require("fs");',
    'const path=require("path");',
    `const root=${JSON.stringify(root)};`,
    "const out=[];",
    'function skillFileFor(dir){for(const name of ["SKILL.md","skill.md"]){const file=path.join(dir,name);try{if(fs.statSync(file).isFile())return file;}catch{}}return null;}',
    'try{for(const entry of fs.readdirSync(root,{withFileTypes:true})){let skillPath=null;let id=entry.name;if(entry.isDirectory()){skillPath=skillFileFor(path.join(root,entry.name));}else if(entry.isFile()&&entry.name.toLowerCase()==="skill.md"){skillPath=path.join(root,entry.name);id="workspace";}if(!skillPath)continue;const dir=path.dirname(skillPath);let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true}).map((child)=>({name:child.name,path:path.join(dir,child.name),type:child.isDirectory()?"directory":"file"}));}catch{}out.push({id,path:skillPath,content:fs.readFileSync(skillPath,"utf8").slice(0,64000),entries});}}catch{}',
    "process.stdout.write(JSON.stringify(out));",
  ].join("");
  return `node -e ${JSON.stringify(script)}`;
}

function isSnapshotEntry(value: unknown): value is FileEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === "string" &&
    typeof entry.path === "string" &&
    (entry.type === "file" || entry.type === "directory")
  );
}

function isWorkspaceSkillSnapshot(value: unknown): value is WorkspaceSkillSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  return (
    typeof snapshot.id === "string" &&
    typeof snapshot.path === "string" &&
    typeof snapshot.content === "string" &&
    (snapshot.entries === undefined || Array.isArray(snapshot.entries))
  );
}

export function parseSkillSnapshotOutput(output: string): WorkspaceSkill[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error("Skills snapshot did not return JSON.");
  }
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Skills snapshot response was not a list.");
  }

  return parsed
    .filter(isWorkspaceSkillSnapshot)
    .map((snapshot) => parseSkillFile(
      snapshot.id,
      snapshot.path,
      snapshot.content,
      (snapshot.entries ?? []).filter(isSnapshotEntry),
    ))
    .sort((a, b) => a.name.localeCompare(b.name));
}
