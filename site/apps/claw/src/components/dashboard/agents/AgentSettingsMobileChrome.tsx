"use client";

export interface AgentSettingsMobileSection {
  id: string;
  label: string;
}

interface AgentSettingsMobileChromeProps {
  activeSection: string;
  onSectionChange: (sectionId: string) => void;
  sections: AgentSettingsMobileSection[];
}

export function AgentSettingsMobileChrome({
  activeSection,
  onSectionChange,
  sections,
}: AgentSettingsMobileChromeProps) {
  return (
    <div className="flex shrink-0 flex-col bg-background">
      <h1 className="sr-only">Settings</h1>
      <div className="shrink-0 border-b border-border px-4 py-4 sm:px-5">
        <nav
          aria-label="Settings sections"
          className="flex h-11 w-full overflow-hidden rounded-xl border border-border bg-surface-low p-1"
        >
          {sections.map((section) => {
            const active = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSectionChange(section.id)}
                className={`flex h-full min-w-0 flex-1 items-center justify-center rounded-lg px-1 text-xs font-medium leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  active
                    ? "bg-surface-high text-foreground"
                    : "text-text-muted hover:bg-surface-medium hover:text-foreground"
                }`}
              >
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
