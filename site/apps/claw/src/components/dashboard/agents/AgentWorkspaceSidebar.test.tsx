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
  it("disables the scheduled section when it is not enabled", () => {
    const props = renderAgentWorkspaceSidebar({
      scheduledDisabled: true,
      scheduledDisabledReason: "Scheduled workflows are not available yet.",
    });

    const scheduled = screen.getByRole("button", { name: /scheduled/i });
    expect(scheduled).toBeDisabled();

    fireEvent.click(scheduled);
    expect(props.onOpenScheduled).not.toHaveBeenCalled();
  });

  it("disables the advanced dropdown while the workspace is in the empty state", () => {
    const props = renderAgentWorkspaceSidebar({ selectedAgent: null });

    expect(screen.getByRole("button", { name: /chat/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /files/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /integrations/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /skills/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /scheduled/i })).toBeDisabled();

    const advanced = screen.getByRole("button", { name: /advanced/i });
    expect(advanced).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /chat/i }));
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    fireEvent.click(screen.getByRole("button", { name: /integrations/i }));
    fireEvent.click(screen.getByRole("button", { name: /skills/i }));
    fireEvent.click(screen.getByRole("button", { name: /scheduled/i }));
    fireEvent.click(advanced);
    expect(props.onSelectChat).not.toHaveBeenCalled();
    expect(props.onOpenFiles).not.toHaveBeenCalled();
    expect(props.onOpenIntegrations).not.toHaveBeenCalled();
    expect(props.onOpenSkills).not.toHaveBeenCalled();
    expect(props.onOpenScheduled).not.toHaveBeenCalled();
    expect(props.onOpenSettings).not.toHaveBeenCalled();
    expect(props.onOpenOpenClaw).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /settings/i })).not.toBeInTheDocument();
  });

  it("keeps workspace sections enabled for a selected stopped agent", () => {
    const props = renderAgentWorkspaceSidebar({
      selectedAgent: {
        ...agent,
        state: "STOPPED",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /chat/i }));
    fireEvent.click(screen.getByRole("button", { name: /files/i }));
    fireEvent.click(screen.getByRole("button", { name: /integrations/i }));
    fireEvent.click(screen.getByRole("button", { name: /skills/i }));
    fireEvent.click(screen.getByRole("button", { name: /scheduled/i }));

    expect(props.onSelectChat).toHaveBeenCalledTimes(1);
    expect(props.onOpenFiles).toHaveBeenCalledTimes(1);
    expect(props.onOpenIntegrations).toHaveBeenCalledTimes(1);
    expect(props.onOpenSkills).toHaveBeenCalledTimes(1);
    expect(props.onOpenScheduled).toHaveBeenCalledTimes(1);
  });

  it("keeps the upgrade action available while the workspace is disabled", () => {
    const props = renderAgentWorkspaceSidebar({
      disabled: true,
      disabledReason: "Fetching messages, files, and config.",
    });

    const upgrade = screen.getByRole("button", { name: /upgrade/i });
    expect(upgrade).not.toBeDisabled();

    fireEvent.click(upgrade);
    expect(props.onUpgrade).toHaveBeenCalledTimes(1);
  });
});
