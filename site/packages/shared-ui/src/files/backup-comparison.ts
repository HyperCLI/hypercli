import type {
  FileBackupComparison,
  FileBackupFreshness,
  FileBackupSnapshot,
  FileBackupSummary,
  FileEntry,
} from "./types";

type HashCandidate = {
  value: string;
  field: string;
  algorithm: string;
};

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function cleanHash(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^W\//i, "").replace(/^\"|\"$/g, "").toLowerCase();
}

function normalizedAlgorithm(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalized || fallback;
}

function hashCandidate(entry: FileEntry): HashCandidate | null {
  const checksum = cleanHash(entry.checksum);
  if (checksum) {
    return {
      value: checksum,
      field: "checksum",
      algorithm: normalizedAlgorithm(entry.checksumAlgorithm, "checksum"),
    };
  }

  const sha256 = cleanHash(entry.sha256);
  if (sha256) return { value: sha256, field: "sha256", algorithm: "sha256" };

  const md5 = cleanHash(entry.md5);
  if (md5) return { value: md5, field: "md5", algorithm: "md5" };

  const hash = cleanHash(entry.hash);
  if (hash) {
    return {
      value: hash,
      field: "hash",
      algorithm: normalizedAlgorithm(entry.hashAlgorithm, "hash"),
    };
  }

  const etag = cleanHash(entry.etag);
  if (etag) return { value: etag, field: "etag", algorithm: "etag" };

  return null;
}

function comparableHash(live: FileEntry, backup: FileEntry): { live: HashCandidate; backup: HashCandidate } | null {
  const liveHash = hashCandidate(live);
  const backupHash = hashCandidate(backup);
  if (!liveHash || !backupHash) return null;
  if (liveHash.algorithm === backupHash.algorithm || liveHash.field === backupHash.field) {
    return { live: liveHash, backup: backupHash };
  }
  return null;
}

function parseTime(value: string | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function compareFreshness(live: FileEntry | undefined, backup: FileEntry | undefined): FileBackupFreshness {
  const liveTime = parseTime(live?.lastModified);
  const backupTime = parseTime(backup?.lastModified);
  if (liveTime === null || backupTime === null) return "unknown";
  if (Math.abs(liveTime - backupTime) < 1000) return "same-time";
  return liveTime > backupTime ? "live-newer" : "backup-newer";
}

function snapshot(entry: FileEntry): FileBackupSnapshot {
  return {
    path: normalizePath(entry.path),
    type: entry.type,
    size: entry.size,
    lastModified: entry.lastModified,
    checksum: entry.checksum,
    checksumAlgorithm: entry.checksumAlgorithm,
    hash: entry.hash,
    hashAlgorithm: entry.hashAlgorithm,
    sha256: entry.sha256,
    md5: entry.md5,
    etag: entry.etag,
    versionId: entry.versionId,
  };
}

function isFileComparison(comparison: FileBackupComparison): boolean {
  return comparison.live?.type === "file" || comparison.backup?.type === "file";
}

export function compareFileBackupEntries(
  liveEntries: FileEntry[],
  backupEntries: FileEntry[],
): Map<string, FileBackupComparison> {
  const liveByPath = new Map(liveEntries.map((entry) => [normalizePath(entry.path), entry]));
  const backupByPath = new Map(backupEntries.map((entry) => [normalizePath(entry.path), entry]));
  const paths = new Set([...liveByPath.keys(), ...backupByPath.keys()]);
  const comparisons = new Map<string, FileBackupComparison>();

  for (const path of paths) {
    const live = liveByPath.get(path);
    const backup = backupByPath.get(path);

    if (!live) {
      comparisons.set(path, {
        status: "backup-only",
        freshness: "unknown",
        backup: backup ? snapshot(backup) : undefined,
        reason: "Only present in the backup source.",
      });
      continue;
    }

    if (!backup) {
      comparisons.set(path, {
        status: "live-only",
        freshness: "unknown",
        live: snapshot(live),
        reason: "Not present in the latest backup listing.",
      });
      continue;
    }

    const freshness = compareFreshness(live, backup);
    if (live.type !== backup.type) {
      comparisons.set(path, {
        status: "modified",
        freshness,
        live: snapshot(live),
        backup: snapshot(backup),
        reason: "The live and backup entries have different types.",
      });
      continue;
    }

    if (live.type === "directory") {
      comparisons.set(path, {
        status: "unknown",
        freshness,
        live: snapshot(live),
        backup: snapshot(backup),
        reason: "Folder listings do not include file hashes.",
      });
      continue;
    }

    const hashes = comparableHash(live, backup);
    if (!hashes) {
      comparisons.set(path, {
        status: freshness === "live-newer" ? "stale" : "unverified",
        freshness,
        live: snapshot(live),
        backup: snapshot(backup),
        reason: "Hash verification is unavailable for this backup copy.",
      });
      continue;
    }

    comparisons.set(path, {
      status: hashes.live.value === hashes.backup.value ? "synced" : "modified",
      freshness,
      live: snapshot(live),
      backup: snapshot(backup),
      hashField: hashes.live.field === hashes.backup.field ? hashes.live.field : undefined,
      hashAlgorithm: hashes.live.algorithm === hashes.backup.algorithm ? hashes.live.algorithm : undefined,
    });
  }

  return comparisons;
}

export function attachFileBackupComparisons(
  entries: FileEntry[],
  comparisons: Map<string, FileBackupComparison>,
): FileEntry[] {
  return entries.map((entry) => ({
    ...entry,
    backupComparison: comparisons.get(normalizePath(entry.path)),
  }));
}

export function markFileBackupComparisonUnavailable(
  entries: FileEntry[],
  side: "live" | "backup",
  reason: string,
): FileEntry[] {
  return entries.map((entry) => ({
    ...entry,
    backupComparison: {
      status: side === "backup" ? "backup-copy" : "unknown",
      freshness: "unknown",
      live: side === "live" ? snapshot(entry) : undefined,
      backup: side === "backup" ? snapshot(entry) : undefined,
      reason,
    },
  }));
}

export function summarizeFileBackupComparisons(
  comparisons: Iterable<FileBackupComparison>,
): FileBackupSummary {
  const summary: FileBackupSummary = {
    total: 0,
    synced: 0,
    modified: 0,
    liveOnly: 0,
    backupOnly: 0,
    unknown: 0,
  };

  for (const comparison of comparisons) {
    if (!isFileComparison(comparison)) continue;
    summary.total += 1;
    if (comparison.status === "synced") summary.synced += 1;
    else if (comparison.status === "modified") summary.modified += 1;
    else if (comparison.status === "live-only") summary.liveOnly += 1;
    else if (comparison.status === "backup-only") summary.backupOnly += 1;
    else summary.unknown += 1;
  }

  return summary;
}

export function emptyFileBackupSummary(): FileBackupSummary {
  return {
    total: 0,
    synced: 0,
    modified: 0,
    liveOnly: 0,
    backupOnly: 0,
    unknown: 0,
  };
}
