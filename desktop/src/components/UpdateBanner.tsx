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
 * Strip at the top of the app shell when the updater found a newer release.
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
  const onUpdate = () => {
    // No dismissal here: starting the download moves the hook out of
    // "available" so the banner hides itself; on failure the dismissal gate
    // must not suppress the reminder for a version the user never got.
    install();
  };
  const onDismiss = () => dismissUpdateBanner(version);

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-accent/30 bg-accent-tint px-4 py-1.5 text-[11px] text-foreground">
      <ArrowUpCircle size={13} className="shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        Update available — HyperCLI v{version}
      </span>
      <button
        type="button"
        onClick={onUpdate}
        className="shrink-0 rounded-md border border-accent/50 px-2 py-0.5 font-medium text-accent transition-colors hover:bg-accent/10"
      >
        Update and restart
      </button>
      <button
        type="button"
        aria-label="Dismiss update"
        onClick={onDismiss}
        className="shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}
