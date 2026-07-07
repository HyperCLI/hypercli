import { describe, expect, it } from "vitest";

import {
  attachFileBackupComparisons,
  compareFileBackupEntries,
  summarizeFileBackupComparisons,
  type FileEntry,
} from "@hypercli/shared-ui/files";

function file(overrides: Partial<FileEntry>): FileEntry {
  return {
    name: "README.md",
    path: ".openclaw/README.md",
    type: "file",
    ...overrides,
  };
}

describe("backup file comparison", () => {
  it("marks files synced only when comparable hashes match", () => {
    const comparisons = compareFileBackupEntries(
      [file({ path: ".openclaw/README.md", sha256: "ABC", lastModified: "2026-07-07T10:00:00Z" })],
      [file({ path: ".openclaw/README.md", sha256: "abc", lastModified: "2026-07-07T10:00:00Z" })],
    );

    const comparison = comparisons.get(".openclaw/README.md");
    expect(comparison?.status).toBe("synced");
    expect(comparison?.freshness).toBe("same-time");
    expect(comparison?.hashAlgorithm).toBe("sha256");
    expect(summarizeFileBackupComparisons(comparisons.values())).toEqual({
      total: 1,
      synced: 1,
      modified: 0,
      liveOnly: 0,
      backupOnly: 0,
      unknown: 0,
    });
  });

  it("marks files modified when comparable hashes differ and keeps date freshness", () => {
    const comparisons = compareFileBackupEntries(
      [file({ path: ".openclaw/app.ts", checksum: "new", checksumAlgorithm: "sha256", lastModified: "2026-07-07T11:00:00Z" })],
      [file({ path: ".openclaw/app.ts", checksum: "old", checksumAlgorithm: "sha256", lastModified: "2026-07-07T10:00:00Z" })],
    );

    const comparison = comparisons.get(".openclaw/app.ts");
    expect(comparison?.status).toBe("modified");
    expect(comparison?.freshness).toBe("live-newer");
  });

  it("marks matching timestamp backup copies as unverified when hashes are missing", () => {
    const comparisons = compareFileBackupEntries(
      [file({ path: ".openclaw/notes.md", lastModified: "2026-07-07T10:00:00Z" })],
      [file({ path: ".openclaw/notes.md", lastModified: "2026-07-07T10:00:00Z" })],
    );

    const comparison = comparisons.get(".openclaw/notes.md");
    expect(comparison?.status).toBe("unverified");
    expect(comparison?.freshness).toBe("same-time");
    expect(comparison?.reason).toMatch(/hash verification/i);
  });

  it("marks backup copies stale when live modified time is newer and hashes are missing", () => {
    const comparisons = compareFileBackupEntries(
      [file({ path: ".openclaw/notes.md", lastModified: "2026-07-07T11:00:00Z" })],
      [file({ path: ".openclaw/notes.md", lastModified: "2026-07-07T10:00:00Z" })],
    );

    const comparison = comparisons.get(".openclaw/notes.md");
    expect(comparison?.status).toBe("stale");
    expect(comparison?.freshness).toBe("live-newer");
  });

  it("counts live-only and backup-only files across the union", () => {
    const comparisons = compareFileBackupEntries(
      [file({ path: ".openclaw/live.md", sha256: "live" })],
      [file({ path: ".openclaw/backup.md", sha256: "backup" })],
    );

    expect(summarizeFileBackupComparisons(comparisons.values())).toMatchObject({
      total: 2,
      liveOnly: 1,
      backupOnly: 1,
    });
  });

  it("attaches comparisons without adding peer-only rows to the current source listing", () => {
    const live = [file({ path: ".openclaw/live.md", sha256: "live" })];
    const backup = [file({ path: ".openclaw/backup.md", sha256: "backup" })];
    const comparisons = compareFileBackupEntries(live, backup);

    const attached = attachFileBackupComparisons(live, comparisons);

    expect(attached).toHaveLength(1);
    expect(attached[0].backupComparison?.status).toBe("live-only");
  });
});
