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
      <div className="shrink-0 border-b border-foreground px-5 py-5">
        <nav
          aria-label="Settings sections"
          className="flex h-7 w-full overflow-hidden rounded-[5px] bg-surface-high p-[1px]"
        >
          {sections.map((section) => {
            const active = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onSectionChange(section.id)}
                className={`flex h-full min-w-0 flex-1 items-center justify-center rounded-[4px] px-1 text-[11px] font-medium leading-none transition-colors ${
                  active
                    ? "bg-background text-foreground shadow-[inset_0_0_0_1px_var(--border-medium)]"
                    : "text-text-muted hover:bg-background/50 hover:text-foreground"
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
