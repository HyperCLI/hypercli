import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, Loader2, User, X } from "lucide-react";
import { logout, planSummary, type PlanSummary } from "../api";
import { useTheme, type Theme } from "../theme";
import { UsagePanel } from "./UsagePanel";
import { RELEASES_URL, useAppUpdate } from "../useAppUpdate";

type Tab = "general" | "billing" | "usage" | "updates";

const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "billing", label: "Usage & billing" },
  { id: "usage", label: "Usage" },
  { id: "updates", label: "Updates" },
];

export function SettingsModal({
  apiBase,
  onClose,
  onSignedOut,
}: {
  apiBase: string;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>("general");

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
    >
      <div
        className={`modal-card ${tab === "usage" ? "modal-card-wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 px-5 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative py-2.5 text-[12px] transition-colors ${
                tab === t.id
                  ? "font-semibold text-foreground"
                  : "text-text-secondary hover:text-foreground"
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />
              )}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="ui-icon-button-sm"
          >
            <X size={15} />
          </button>
        </div>

        <div
          className={`p-5 min-h-[220px] ${
            tab === "usage" ? "max-h-[70vh] overflow-y-auto" : ""
          }`}
        >
          {tab === "general" && (
            <GeneralTab apiBase={apiBase} onSignedOut={onSignedOut} />
          )}
          {tab === "billing" && <BillingTab />}
          {tab === "usage" && <UsagePanel />}
          {tab === "updates" && <UpdatesTab />}
        </div>
      </div>
    </div>
  );
}

function GeneralTab({
  apiBase,
  onSignedOut,
}: {
  apiBase: string;
  onSignedOut: () => void;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-full bg-active-row flex items-center justify-center text-text-secondary shrink-0">
            <User size={16} />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium">Signed in</div>
            <div className="text-[11px] text-text-secondary">
              API key stored on this device
            </div>
          </div>
        </div>
        <button
          onClick={async () => {
            await logout();
            onSignedOut();
          }}
          className="ui-secondary-button shrink-0"
        >
          Sign out
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <span className="text-[13px]">Theme</span>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-[12px] outline-none"
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <span className="text-[13px]">Backend</span>
        <span className="text-[11px] font-mono text-text-secondary truncate">
          {apiBase}
        </span>
      </div>
    </div>
  );
}

function BillingTab() {
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    planSummary()
      .then(setPlan)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <div className="pt-8 text-center">
        <div className="text-[13px] font-medium mb-1">Plan details unavailable</div>
        <p className="text-[12px] text-text-secondary leading-relaxed">
          We couldn't load your plan right now. Try again later.
        </p>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="pt-8 text-center text-[12px] text-text-secondary">
        Loading plan…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="soft-card bg-surface px-4 py-3.5">
        <div className="text-[13px] font-semibold">{plan.name}</div>
        <div className="mt-0.5 text-[11px] text-text-secondary">
          {plan.agents === 1 ? "1 agent" : `Up to ${plan.agents} agents`}
          {plan.renews_at &&
            ` · Renews ${new Date(plan.renews_at).toLocaleDateString([], {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}`}
        </div>
      </div>
      <p className="text-[11px] text-text-secondary leading-relaxed">
        Plans and billing are managed from your account on the web.
      </p>
    </div>
  );
}

function UpdatesTab() {
  const [version, setVersion] = useState<string | null>(null);
  const { state, checkNow, install } = useAppUpdate();

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  const openReleases = async () => {
    try {
      await openUrl(RELEASES_URL);
    } catch {
      window.open(RELEASES_URL, "_blank");
    }
  };

  const downloadPercent =
    state.status === "downloading" && state.total
      ? Math.min(100, Math.round((state.downloaded / state.total) * 100))
      : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px]">Version</span>
        <span className="text-[12px] font-mono text-text-secondary">
          {version ?? "—"}
        </span>
      </div>
      <div className="border-t border-border pt-4 space-y-3">
        {state.status === "checking" && (
          <div className="flex items-center gap-2 text-[12px] text-text-secondary">
            <Loader2 size={13} className="animate-spin" />
            Checking for updates…
          </div>
        )}

        {state.status === "up-to-date" && (
          <div className="flex items-center justify-between gap-4">
            <span className="text-[12px] text-text-secondary">
              You're up to date.
            </span>
            <button onClick={checkNow} className="ui-secondary-button shrink-0">
              Check again
            </button>
          </div>
        )}

        {state.status === "available" && (
          <>
            <div className="text-[13px] font-medium">
              HyperCLI {state.version} is available
            </div>
            {state.notes && (
              <div className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] text-text-secondary leading-relaxed">
                {state.notes}
              </div>
            )}
            <div>
              <button onClick={install} className="ui-secondary-button">
                Update and restart
              </button>
            </div>
          </>
        )}

        {state.status === "downloading" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
              <Loader2 size={13} className="animate-spin" />
              Downloading update{downloadPercent !== null ? ` — ${downloadPercent}%` : "…"}
            </div>
            <div className="h-1 rounded-full bg-active-row overflow-hidden">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${downloadPercent ?? 100}%` }}
              />
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="space-y-2">
            <div className="text-[12px] text-text-secondary">
              Update check failed{state.error ? `: ${state.error}` : "."}
            </div>
            <button onClick={checkNow} className="ui-secondary-button">
              Try again
            </button>
          </div>
        )}

        {state.status === "manual" && (
          <div className="space-y-2">
            <div className="text-[12px] text-text-secondary leading-relaxed">
              This install can't update itself. Download the latest release to
              get the newest version.
            </div>
            <button onClick={openReleases} className="ui-secondary-button">
              <Download size={12} className="mr-1.5 inline-block" />
              Download from GitHub
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
