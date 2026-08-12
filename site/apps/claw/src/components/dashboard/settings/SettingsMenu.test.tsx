import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  SettingsMenu,
  SettingsSectionHeader,
  resolveSettingsSectionId,
  type SettingsSectionId,
} from "./SettingsMenu";

function SettingsMenuHarness() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("profile");

  return (
    <SettingsMenu
      activeSection={activeSection}
      backHref="/dashboard/agents?agentId=agent-1"
      onSectionChange={setActiveSection}
    />
  );
}

describe("SettingsMenu", () => {
  it("resolves URL-backed settings sections", () => {
    expect(resolveSettingsSectionId("members")).toBe("members");
    expect(resolveSettingsSectionId("api-keys")).toBe("api-keys");
    expect(resolveSettingsSectionId(" memory-index ")).toBe("memory-index");
    expect(resolveSettingsSectionId("unknown")).toBeNull();
  });

  it("renders the unified settings groups and returns to the app", () => {
    render(<SettingsMenuHarness />);

    expect(screen.getByRole("link", { name: "Back to app" })).toHaveAttribute(
      "href",
      "/dashboard/agents?agentId=agent-1",
    );
    expect(screen.getByRole("heading", { name: "Personal" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Administration" })).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Profile",
      "Preferences",
      "Agents",
      "Collections",
      "Members",
      "API Keys",
      "Billing",
      "Plans",
      "Memory index",
    ]);
    expect(screen.getByRole("button", { name: "Profile" })).toHaveAttribute("aria-current", "page");
  });

  it("moves the active state when a section is selected", () => {
    render(<SettingsMenuHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Preferences" }));

    expect(screen.getByRole("button", { name: "Preferences" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Profile" })).not.toHaveAttribute("aria-current");
  });

  it("reports Administration selections to the owning settings flow", () => {
    const onSectionChange = vi.fn();
    render(
      <SettingsMenu
        activeSection="profile"
        backHref="/dashboard/agents"
        onSectionChange={onSectionChange}
      />,
    );

    ["Collections", "Members", "API Keys", "Billing", "Plans", "Memory index"].forEach((label) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
    });

    expect(onSectionChange.mock.calls.map(([section]) => section)).toEqual([
      "workspace",
      "members",
      "api-keys",
      "billing",
      "plans",
      "memory-index",
    ]);
  });
});

describe("SettingsSectionHeader", () => {
  it.each([
    ["profile", "Profile"],
    ["preferences", "Preferences"],
    ["agent", "Agents"],
    ["workspace", "Collections"],
    ["members", "Members"],
    ["memory-index", "Memory index"],
  ] satisfies Array<[SettingsSectionId, string]>) (
    "renders the Settings breadcrumb for %s",
    (activeSection, label) => {
      render(<SettingsSectionHeader activeSection={activeSection} />);

      const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(breadcrumb).toHaveTextContent(`Settings${label}`);
      expect(screen.getByRole("heading", { name: label, level: 1 })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Feedback" })).toHaveAttribute(
        "href",
        "mailto:support@hypercli.com?subject=HyperCLI%20Claw%20feedback",
      );
    },
  );

  it.each([
    ["api-keys", "API Keys"],
    ["billing", "Billing"],
    ["plans", "Plans"],
  ] satisfies Array<[SettingsSectionId, string]>) ("renders %s as a standalone section title", (activeSection, label) => {
    render(<SettingsSectionHeader activeSection={activeSection} />);

    expect(screen.getByRole("heading", { name: label, level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
  });

  it("matches the chat header height", () => {
    render(<SettingsSectionHeader activeSection="profile" />);

    expect(screen.getByRole("banner")).toHaveClass("h-[calc(3.5rem+env(safe-area-inset-top))]");
  });

  it("returns mobile detail views to the settings menu", () => {
    const onBackToSettings = vi.fn();
    render(<SettingsSectionHeader activeSection="billing" onBackToSettings={onBackToSettings} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to settings" }));

    expect(onBackToSettings).toHaveBeenCalledOnce();
  });

  it("returns scoped agent settings to the agents list", () => {
    const onBackToAgents = vi.fn();
    render(
      <SettingsSectionHeader
        activeSection="agent"
        agentName="Research"
        onBackToAgents={onBackToAgents}
      />,
    );

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveTextContent("SettingsAgentsResearch");
    expect(screen.getByRole("heading", { name: "Research", level: 1 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to agents" }));
    expect(onBackToAgents).toHaveBeenCalledOnce();
  });
});
