import { fireEvent, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Agent } from "@/app/dashboard/agents/types";
import { renderWithClient } from "@/test/utils";
import { AgentWorkspaceSidebar } from "./AgentWorkspaceSidebar";

vi.mock("@hypercli/shared-ui", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/HyperClawLogoLink", () => ({
  HyperClawLogoLink: () => <div>HyperClaw</div>,
}));

const agent: Agent = {
  id: "agent-1",
  name: "Test Agent",
  user_id: "user-1",
  pod_id: "pod-1",
  pod_name: "agent-1",
  state: "RUNNING",
  cpu_millicores: 4000,
  memory_mib: 4096,
  hostname: "agent.example.com",
  started_at: "2026-05-05T00:00:00Z",
  stopped_at: null,
  last_error: null,
  created_at: "2026-05-05T00:00:00Z",
  updated_at: "2026-05-05T00:00:00Z",
  gatewayToken: null,
  meta: null,
};

function renderAgentWorkspaceSidebar(overrides: Partial<ComponentProps<typeof AgentWorkspaceSidebar>> = {}) {
  const props: ComponentProps<typeof AgentWorkspaceSidebar> = {
    selectedAgent: agent,
    activeTab: "chat",
    isDesktopViewport: true,
    onSelectChat: vi.fn(),
    onOpenFiles: vi.fn(),
    onOpenIntegrations: vi.fn(),
    onOpenSkills: vi.fn(),
    onOpenScheduled: vi.fn(),
    onOpenLogs: vi.fn(),
    onOpenShell: vi.fn(),
    onOpenOpenClaw: vi.fn(),
    onOpenSettings: vi.fn(),
    onUpgrade: vi.fn(),
    ...overrides,
  };

  renderWithClient(<AgentWorkspaceSidebar {...props} />);
  return props;
}

describe("AgentWorkspaceSidebar", () => {
  it("disables the advanced dropdown while the workspace is in the empty state", () => {
    const props = renderAgentWorkspaceSidebar({ selectedAgent: null });

    const advanced = screen.getByRole("button", { name: /advanced/i });
    expect(advanced).toBeDisabled();

    fireEvent.click(advanced);
    expect(props.onOpenSettings).not.toHaveBeenCalled();
    expect(props.onOpenOpenClaw).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /settings/i })).not.toBeInTheDocument();
  });
});
