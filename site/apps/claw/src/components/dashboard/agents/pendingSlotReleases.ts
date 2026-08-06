export interface PendingSlotRelease {
  tier: string;
  reconcileAfterSnapshot: number | null;
}

export type PendingSlotReleaseMap = Map<string, PendingSlotRelease>;

export function registerPendingSlotRelease(
  pending: PendingSlotReleaseMap,
  releaseId: string,
  tier: string,
): void {
  pending.set(releaseId, { tier, reconcileAfterSnapshot: null });
}

export function markPendingSlotReleaseComplete(
  pending: PendingSlotReleaseMap,
  releaseId: string,
  reconcileAfterSnapshot: number,
): boolean {
  const current = pending.get(releaseId);
  if (!current) return false;
  pending.set(releaseId, {
    ...current,
    reconcileAfterSnapshot: Math.max(0, reconcileAfterSnapshot),
  });
  return true;
}

/**
 * Clear releases only after both the mutation response and a later
 * authoritative billing snapshot. This is intentionally identity-based:
 * aggregate used/available deltas are ambiguous when another launch claims a
 * slot at the same time.
 */
export function reconcileCompletedSlotReleases(
  pending: PendingSlotReleaseMap,
  snapshot: number,
): boolean {
  let changed = false;
  for (const [releaseId, release] of pending) {
    if (release.reconcileAfterSnapshot === null || snapshot < release.reconcileAfterSnapshot) continue;
    pending.delete(releaseId);
    changed = true;
  }
  return changed;
}

export function countPendingSlotReleasesByTier(
  pending: PendingSlotReleaseMap,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { tier } of pending.values()) {
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  return counts;
}
