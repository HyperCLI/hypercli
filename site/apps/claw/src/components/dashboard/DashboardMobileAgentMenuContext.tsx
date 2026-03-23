"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type AgentMainTab = "chat" | "logs" | "shell" | "files" | "workspace" | "openclaw" | "integrations" | "settings";

export interface DashboardMobileAgentMenuConfig {
  selectedAgentId: string;
  activeTab: AgentMainTab;
  onSelectTab: (tab: AgentMainTab) => void;
  onDelete: () => void;
  deleting: boolean;
}

interface DashboardMobileAgentMenuContextValue {
  agentMenu: DashboardMobileAgentMenuConfig | null;
  setAgentMenu: (menu: DashboardMobileAgentMenuConfig | null) => void;
}

const DashboardMobileAgentMenuContext = createContext<DashboardMobileAgentMenuContextValue | null>(null);

export function DashboardMobileAgentMenuProvider({ children }: { children: ReactNode }) {
  const [agentMenu, setAgentMenu] = useState<DashboardMobileAgentMenuConfig | null>(null);
  const value = useMemo(() => ({ agentMenu, setAgentMenu }), [agentMenu]);
  return (
    <DashboardMobileAgentMenuContext.Provider value={value}>
      {children}
    </DashboardMobileAgentMenuContext.Provider>
  );
}

export function useDashboardMobileAgentMenu() {
  const context = useContext(DashboardMobileAgentMenuContext);
  if (!context) {
    throw new Error("useDashboardMobileAgentMenu must be used within DashboardMobileAgentMenuProvider");
  }
  return context;
}
