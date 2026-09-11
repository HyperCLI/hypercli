import { useEffect, useState, useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ArrowUpCircle, X } from "lucide-react";
import { useAppUpdate } from "../useAppUpdate";
import {
  dismissUpdateBanner,
  dismissedUpdateVersion,
  subscribeUpdateBannerDismissals,
  updateBannerVisible,
} from "../lib/update-banner";

/**
 * Info card on the shared issue surface (the ErrorBar overlay) when the
 * updater found a newer release. Same card layout, dismissal X, and
 * action-button pattern as the error cards, but in the accent info tone —
 * errors outrank it, so App.tsx stacks it below ErrorBar.
 */
export function UpdateBannerCard({
  version,
  onUpdate,
  onDismiss,
}: {
  version: string;
  onUpdate: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="error-bar pointer-events-auto flex items-start gap-3 rounded-lg border border-accent/40 bg-accent-tint px-3.5 py-2.5 shadow-sm backdrop-blur-sm"
    >
      <ArrowUpCircle size={15} className="mt-px shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-accent">
          Update available — HyperCLI v{version}
        </div>
        <button
          type="button"
          onClick={onUpdate}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-accent/50 px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10"
        >
          Update and restart
        </button>
      </div>
      <button
        type="button"
        aria-label="Dismiss update"
        onClick={onDismiss}
        className="-mr-1 shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}

/**
 * The action starts the download-and-restart flow from `useAppUpdate`; the ×
 * dismisses the banner for that version (a later release re-shows it). The
 * manual-download case (`status === "manual"`) has no version attached to the
 * check, so it stays in Settings → Updates only.
 */
export default function UpdateBanner() {
  const { state, install } = useAppUpdate();
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const dismissed = useSyncExternalStore(subscribeUpdateBannerDismissals, dismissedUpdateVersion);

  useEffect(() => {
    getVersion()
      .then(setCurrentVersion)
      .catch(() => setCurrentVersion(null));
  }, []);

  const availableVersion = state.status === "available" ? state.version : null;
  if (!updateBannerVisible({ availableVersion, currentVersion, dismissedVersion: dismissed })) {
    return null;
  }

  const version = availableVersion as string;
  return (
    <UpdateBannerCard
      version={version}
      // No dismissal on update: starting the download moves the hook out of
      // "available" so the banner hides itself; on failure the dismissal gate
      // must not suppress the reminder for a version the user never got.
      onUpdate={install}
      onDismiss={() => dismissUpdateBanner(version)}
    />
  );
}
