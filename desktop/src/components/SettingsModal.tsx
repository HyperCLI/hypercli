import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { User, X } from "lucide-react";
import { logout, planSummary, type PlanSummary } from "../api";
import { useTheme, type Theme } from "../theme";

type Tab = "general" | "billing" | "updates";

const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "billing", label: "Usage & billing" },
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
        className="modal-card"
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

        <div className="p-5 min-h-[220px]">
          {tab === "general" && (
            <GeneralTab apiBase={apiBase} onSignedOut={onSignedOut} />
          )}
          {tab === "billing" && <BillingTab />}
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

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px]">Version</span>
        <span className="text-[12px] font-mono text-text-secondary">
          {version ?? "—"}
        </span>
      </div>
      <div className="border-t border-border pt-4 text-[12px] text-text-secondary">
        You're up to date.
      </div>
    </div>
  );
}
