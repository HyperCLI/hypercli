/**
 * Update-available banner state.
 *
 * The updater plugin answer ("there is a new version") comes from
 * `src/useAppUpdate.ts`; this module owns the one user decision layered on
 * top of it: dismissal, persisted per version under the app's `desktop-ng-*`
 * localStorage convention. Dismissing v0.3.0 hides the banner until v0.3.1
 * exists; the banner never reappears for the version the user dismissed.
 *
 * Versions are compared numerically so the banner cannot fire on a stale or
 * older manifest entry, and cannot be hidden by a dismissal that merely
 * *looks* like the available version string without being one.
 */

/** Same naming convention as the pane and theme prefs (`desktop-ng-*`). */
export const UPDATE_DISMISS_KEY = "desktop-ng-update-dismissed";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage can throw on access (blocked cookies in a webview). The banner
    // then simply becomes session-dismissible rather than crashing the app.
    return null;
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

/** The version the user dismissed, or null. */
export function dismissedUpdateVersion(storage?: StorageLike | null): string | null {
  const store = storage === undefined ? defaultStorage() : storage;
  try {
    return store?.getItem(UPDATE_DISMISS_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Persist dismissal of `version`; a later, newer release re-shows the banner. */
export function dismissUpdateBanner(version: string, storage?: StorageLike | null) {
  const store = storage === undefined ? defaultStorage() : storage;
  try {
    store?.setItem(UPDATE_DISMISS_KEY, version);
  } catch {
    // See defaultStorage: an unwritable store degrades to a no-op.
  }
  emit();
}

/** Test and component seam: subscribe to dismissal changes. */
export function subscribeUpdateBannerDismissals(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Strictly-greater numeric version compare. Returns false when either side is
 * unparseable — an equality check is the only safe read of exotic strings —
 * unless the strings differ, in which case "different from the running build"
 * is treated as newer rather than hiding a real release.
 */
export function isNewerVersion(available: string, current: string): boolean {
  const parse = (v: string) => {
    const parts = v.trim().split(/[.+-]/).map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
    return parts.length > 0 && parts.every((part) => Number.isFinite(part)) ? parts : null;
  };
  const a = parse(available);
  const c = parse(current);
  if (!a || !c) return available !== current;
  for (let i = 0; i < Math.max(a.length, c.length); i++) {
    const diff = (a[i] ?? 0) - (c[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export interface UpdateBannerInput {
  /** Version the update check reported, or null when nothing is available. */
  availableVersion: string | null;
  /** Running build's version; null while it is still being resolved. */
  currentVersion: string | null;
  dismissedVersion: string | null;
}

/** The banner shows exactly when all three gates pass. */
export function updateBannerVisible(input: UpdateBannerInput): boolean {
  const { availableVersion, currentVersion, dismissedVersion } = input;
  if (!availableVersion) return false;
  if (availableVersion === dismissedVersion) return false;
  if (currentVersion && !isNewerVersion(availableVersion, currentVersion)) return false;
  return true;
}
