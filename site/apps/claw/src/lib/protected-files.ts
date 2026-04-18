// Core agent files that are read-only in the file editor. Edits to these can
// silently break the agent (identity drift, lost memory, broken bootstrap), so
// the UI funnels users into download → edit locally → re-upload instead.
//
// Match is case-insensitive and against the file's basename only — a file at
// `subdir/SOUL.MD` is still protected.
export const PROTECTED_FILES = [
  "AGENTS.MD",
  "BOOTSTRAP.MD",
  "SOUL.MD",
  "HEARTBEAT.MD",
  "MEMORY.MD",
] as const;

const PROTECTED_SET = new Set(PROTECTED_FILES.map((n) => n.toUpperCase()));

export function isProtectedFile(path: string): boolean {
  const basename = path.split(/[/\\]/).pop() ?? path;
  return PROTECTED_SET.has(basename.toUpperCase());
}
