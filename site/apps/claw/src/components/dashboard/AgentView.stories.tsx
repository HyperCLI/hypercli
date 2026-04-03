import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, fn } from "storybook/test";
import { AgentView, ConnectionDetail } from "./AgentView";
import type { StyleVariant } from "./AgentView";
import { MessageSquare } from "lucide-react";
import { useState } from "react";

const VARIANT_OPTIONS: StyleVariant[] = ["off", "v1", "v2", "v3"];

function setAll(v: StyleVariant) {
  return {
    connectionRowStyle: v, tabBarStyle: v, skillsVariant: v, activityVariant: v,
    completenessRingVariant: v, quickActionsVariant: v, emptyStatesVariant: v,
    toolDiscoveryVariant: v, connectionRecsVariant: v, capabilityDiffVariant: v,
    agentCardVariant: v, nudgesVariant: v, onboardingVariant: v, whatCanIDoVariant: v,
    modelCapsVariant: v, toolUsageVariant: v, interactionPatternsVariant: v,
    examplePromptsVariant: v, limitsVariant: v, achievementsVariant: v,
    permissionsVariant: v, channelsVariant: v, providersVariant: v,
    execQueueVariant: v, agentUrlsVariant: v, gatewayStatusVariant: v,
    workspaceFilesVariant: v,
  };
}

const meta: Meta<typeof AgentView> = {
  title: "Dashboard/AgentView",
  component: AgentView,
  argTypes: {
    activeTab: { control: "select", options: ["overview", "activity", "skills", "connections", "cron"] },
    tabBarStyle: { control: "select", options: VARIANT_OPTIONS },
    connectionRowStyle: { control: "select", options: VARIANT_OPTIONS },
    skillsVariant: { control: "select", options: VARIANT_OPTIONS },
    activityVariant: { control: "select", options: VARIANT_OPTIONS },
    completenessRingVariant: { control: "select", options: VARIANT_OPTIONS },
    quickActionsVariant: { control: "select", options: VARIANT_OPTIONS },
    modelCapsVariant: { control: "select", options: VARIANT_OPTIONS },
    toolUsageVariant: { control: "select", options: VARIANT_OPTIONS },
    interactionPatternsVariant: { control: "select", options: VARIANT_OPTIONS },
    examplePromptsVariant: { control: "select", options: VARIANT_OPTIONS },
    limitsVariant: { control: "select", options: VARIANT_OPTIONS },
    achievementsVariant: { control: "select", options: VARIANT_OPTIONS },
    permissionsVariant: { control: "select", options: VARIANT_OPTIONS },
    channelsVariant: { control: "select", options: VARIANT_OPTIONS },
    providersVariant: { control: "select", options: VARIANT_OPTIONS },
    execQueueVariant: { control: "select", options: VARIANT_OPTIONS },
    agentUrlsVariant: { control: "select", options: VARIANT_OPTIONS },
    gatewayStatusVariant: { control: "select", options: VARIANT_OPTIONS },
    workspaceFilesVariant: { control: "select", options: VARIANT_OPTIONS },
    onConnectionSelect: { action: "connectionSelected" },
    onTabChange: { action: "tabChanged" },
  },
  args: {
    agentName: "test-agent",
    showStatusCard: true, showConfigQuickView: true, showActiveSessions: true,
    showCronManager: true, showRecentToolCalls: true, showSubAgents: true,
    showSearch: true, showRecommended: true, showMarketplace: true,
    ...setAll("off"),
  },
  decorators: [
    (Story) => (
      <div className="bg-background h-[600px] w-[320px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AgentView>;

// ── Tab navigation ──

export const OverviewDefault: Story = {
  args: { activeTab: "overview" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("RUNNING")).toBeInTheDocument();
    await expect(canvas.getByText("Config")).toBeInTheDocument();
  },
};

export const TabNavigation: Story = {
  args: { activeTab: "overview", ...setAll("off") },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Navigate through all tabs
    await userEvent.click(canvas.getByText("Activity"));
    await expect(canvas.getByText("Message sent")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Skills"));
    await expect(canvas.getByText("Web Search")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Connections"));
    await expect(canvas.getByText("My Connections")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Cron"));
    await expect(canvas.getByText("Morning briefing")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Overview"));
    await expect(canvas.getByText("RUNNING")).toBeInTheDocument();
  },
};

// ── Activity tab interactions ──

export const ActivityFilterInteraction: Story = {
  args: { activeTab: "activity", activityVariant: "off" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Filter by errors
    await userEvent.click(canvas.getByText("Errors"));
    await expect(canvas.getByText("Error")).toBeInTheDocument();
    // Filter by messages
    await userEvent.click(canvas.getByText("Messages"));
    await expect(canvas.getByText("Message sent")).toBeInTheDocument();
    // Reset to all
    await userEvent.click(canvas.getByText("All"));
    await expect(canvas.getByText("Config updated")).toBeInTheDocument();
  },
};

export const ActivityTimeline: Story = {
  args: { activeTab: "activity", activityVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Tools"));
    await expect(canvas.getByText("Tool call")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("All"));
  },
};

export const ActivityCards: Story = {
  args: { activeTab: "activity", activityVariant: "v2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("System"));
    await expect(canvas.getByText("Config updated")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("All"));
  },
};

export const ActivityMinimal: Story = {
  args: { activeTab: "activity", activityVariant: "v3" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Message sent")).toBeInTheDocument();
  },
};

// ── Skills tab interactions ──

export const SkillsDefault: Story = {
  args: { activeTab: "skills", skillsVariant: "off" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Web Search")).toBeInTheDocument();
    await expect(canvas.getByText("Code Execution")).toBeInTheDocument();
    await expect(canvas.getByText("Image Generation")).toBeInTheDocument();
  },
};

export const SkillsCards: Story = {
  args: { activeTab: "skills", skillsVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Web Search")).toBeInTheDocument();
    await expect(canvas.getByText("Search the internet for information")).toBeInTheDocument();
  },
};

export const SkillsPills: Story = {
  args: { activeTab: "skills", skillsVariant: "v2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Web Search")).toBeInTheDocument();
  },
};

export const SkillsMinimal: Story = {
  args: { activeTab: "skills", skillsVariant: "v3" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Web Search")).toBeInTheDocument();
  },
};

// ── Connections tab interactions ──

export const ConnectionsSearch: Story = {
  args: { activeTab: "connections" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const searchInput = canvas.getByPlaceholderText("Search connections...");
    // Type to filter
    await userEvent.type(searchInput, "Telegram");
    await expect(canvas.getByText("Telegram")).toBeInTheDocument();
    // Clear and search something else
    await userEvent.clear(searchInput);
    await userEvent.type(searchInput, "GitHub");
    await expect(canvas.getByText("GitHub")).toBeInTheDocument();
    await userEvent.clear(searchInput);
  },
};

export const ConnectionsCollapse: Story = {
  args: { activeTab: "connections" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Collapse My Connections
    await userEvent.click(canvas.getByText("My Connections"));
    // Telegram should be hidden
    // Expand again
    await userEvent.click(canvas.getByText("My Connections"));
    await expect(canvas.getByText("Telegram")).toBeInTheDocument();
  },
};

export const ConnectionRowCompact: Story = { args: { activeTab: "connections", connectionRowStyle: "v1" } };
export const ConnectionRowCards: Story = { args: { activeTab: "connections", connectionRowStyle: "v2" } };
export const ConnectionRowBadges: Story = { args: { activeTab: "connections", connectionRowStyle: "v3" } };

// ── Cron tab interactions ──

export const CronTab: Story = {
  args: { activeTab: "cron" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Morning briefing")).toBeInTheDocument();
    await expect(canvas.getByText("0 9 * * *")).toBeInTheDocument();
    await expect(canvas.getByText("Health check")).toBeInTheDocument();
    await expect(canvas.getByText("Add Cron Job")).toBeInTheDocument();
  },
};

export const CronDelete: Story = {
  args: { activeTab: "cron" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Should have 3 cron jobs initially
    await expect(canvas.getByText("Morning briefing")).toBeInTheDocument();
    await expect(canvas.getByText("Health check")).toBeInTheDocument();
    await expect(canvas.getByText("Weekly report")).toBeInTheDocument();
  },
};

// ── Tab bar styles ──

export const TabBarPills: Story = {
  args: { activeTab: "overview", tabBarStyle: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Skills"));
    await expect(canvas.getByText("Web Search")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Overview"));
  },
};

export const TabBarSegmented: Story = {
  args: { activeTab: "overview", tabBarStyle: "v2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Activity"));
    await expect(canvas.getByText("Message sent")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Overview"));
  },
};

export const TabBarIcons: Story = {
  args: { activeTab: "overview", tabBarStyle: "v3" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Connections"));
    await expect(canvas.getByText("My Connections")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Overview"));
  },
};

// ── Preset variants ──

export const AllFeaturesV1: Story = { args: { activeTab: "overview", ...setAll("v1") } };
export const AllFeaturesV2: Story = { args: { activeTab: "overview", ...setAll("v2") } };
export const AllFeaturesV3: Story = { args: { activeTab: "overview", ...setAll("v3") } };

export const MinimalFeatures: Story = {
  args: {
    activeTab: "overview",
    showStatusCard: false, showConfigQuickView: false,
    showActiveSessions: false, showCronManager: false,
    showRecentToolCalls: false, showSubAgents: false,
  },
  play: async ({ canvasElement }) => {
    // Overview should be mostly empty with toggles off
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("RUNNING")).toBeNull();
    await expect(canvas.queryByText("Config")).toBeNull();
  },
};

// ── Onboarding interaction ──

export const OnboardingStepThrough: Story = {
  args: { activeTab: "overview", onboardingVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Getting Started")).toBeInTheDocument();
    await expect(canvas.getByText("Agent Status")).toBeInTheDocument();
    // Step through
    await userEvent.click(canvas.getByText("Next"));
    await expect(canvas.getByText("Configuration")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Next"));
    await expect(canvas.getByText("Chat")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Next"));
    await expect(canvas.getByText("Connections")).toBeInTheDocument();
    // Final step says "Done"
    await userEvent.click(canvas.getByText("Done"));
    // Onboarding should be dismissed
    await expect(canvas.queryByText("Getting Started")).toBeNull();
  },
};

export const OnboardingSkip: Story = {
  args: { activeTab: "overview", onboardingVariant: "v2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Welcome to your agent")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Dismiss"));
    await expect(canvas.queryByText("Welcome to your agent")).toBeNull();
  },
};

export const OnboardingTooltip: Story = {
  args: { activeTab: "overview", onboardingVariant: "v3" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Agent Status")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Next →"));
    await expect(canvas.getByText("Configuration")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Skip"));
    await expect(canvas.queryByText("Configuration")).toBeNull();
  },
};

// ── Config tools toggle ──

export const ConfigToolToggle: Story = {
  args: { activeTab: "overview", showConfigQuickView: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("claude-opus-4-6")).toBeInTheDocument();
    // Click a tool chip to toggle it
    await userEvent.click(canvas.getByText("image_gen"));
    // Click again to toggle back
    await userEvent.click(canvas.getByText("image_gen"));
  },
};

// ── Sub-agents collapse ──

export const SubAgentsToggle: Story = {
  args: { activeTab: "overview", showSubAgents: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("research-agent")).toBeInTheDocument();
    // Collapse
    await userEvent.click(canvas.getByText("Sub-agents"));
    // Expand
    await userEvent.click(canvas.getByText("Sub-agents"));
    await expect(canvas.getByText("research-agent")).toBeInTheDocument();
  },
};

// ── Agent Card toggle ──

export const AgentCardToggle: Story = {
  args: { activeTab: "overview", agentCardVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Click to show agent card
    await userEvent.click(canvas.getByText("Show Agent Card"));
    await expect(canvas.getByText("test-agent")).toBeInTheDocument();
    // Click to hide
    await userEvent.click(canvas.getByText("Hide Agent Card"));
  },
};

// ── UX Discovery features ──

export const CompletenessRing: Story = {
  args: { activeTab: "overview", completenessRingVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Agent Readiness")).toBeInTheDocument();
  },
};

export const CompletenessChecklist: Story = {
  args: { activeTab: "overview", completenessRingVariant: "v3" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Setup Checklist")).toBeInTheDocument();
    await expect(canvas.getByText("Model")).toBeInTheDocument();
  },
};

export const QuickActionsChips: Story = {
  args: { activeTab: "overview", quickActionsVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Quick Actions")).toBeInTheDocument();
    await expect(canvas.getByText("Search the web")).toBeInTheDocument();
    await expect(canvas.getByText("Read a file")).toBeInTheDocument();
  },
};

export const QuickActionsGrid: Story = {
  args: { activeTab: "overview", quickActionsVariant: "v2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Try asking")).toBeInTheDocument();
  },
};

export const ModelCapabilities: Story = {
  args: { activeTab: "overview", modelCapsVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Model Capabilities")).toBeInTheDocument();
    await expect(canvas.getByText("Vision")).toBeInTheDocument();
    await expect(canvas.getByText("Extended Thinking")).toBeInTheDocument();
    await expect(canvas.getByText("200k Context")).toBeInTheDocument();
  },
};

export const ToolUsageBars: Story = {
  args: { activeTab: "overview", toolUsageVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Tool Usage")).toBeInTheDocument();
    await expect(canvas.getByText("67")).toBeInTheDocument(); // file_read count
  },
};

export const ToolUsageVertical: Story = {
  args: { activeTab: "overview", toolUsageVariant: "v2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Tool Usage")).toBeInTheDocument();
  },
};

export const InteractionPatternsBars: Story = {
  args: { activeTab: "overview", interactionPatternsVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("What your agent does")).toBeInTheDocument();
    await expect(canvas.getByText("Code review")).toBeInTheDocument();
    await expect(canvas.getByText("34%")).toBeInTheDocument();
  },
};

export const InteractionPatternsDonut: Story = {
  args: { activeTab: "overview", interactionPatternsVariant: "v2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Email triage")).toBeInTheDocument();
  },
};

export const ExamplePromptsGrouped: Story = {
  args: { activeTab: "overview", examplePromptsVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Try These")).toBeInTheDocument();
    await expect(canvas.getByText("Gmail")).toBeInTheDocument();
  },
};

export const Achievements: Story = {
  args: { activeTab: "overview", achievementsVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("This Week")).toBeInTheDocument();
    await expect(canvas.getByText("142")).toBeInTheDocument();
    await expect(canvas.getByText("38")).toBeInTheDocument();
  },
};

export const Permissions: Story = {
  args: { activeTab: "overview", permissionsVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Permissions")).toBeInTheDocument();
    await expect(canvas.getByText("File system")).toBeInTheDocument();
    await expect(canvas.getByText("read/write")).toBeInTheDocument();
    await expect(canvas.getByText("full")).toBeInTheDocument();
  },
};

export const Channels: Story = {
  args: { activeTab: "overview", channelsVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Channels")).toBeInTheDocument();
    await expect(canvas.getByText("@mybot")).toBeInTheDocument();
    // Slack should have a Connect button
    const connectButtons = canvasElement.querySelectorAll("button");
    expect(connectButtons.length).toBeGreaterThan(0);
  },
};

export const ExecQueue: Story = {
  args: { activeTab: "overview", execQueueVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Pending Approval")).toBeInTheDocument();
    await expect(canvas.getByText(/rm -rf/)).toBeInTheDocument();
    // Approve/Deny buttons should be visible
    const approveButtons = canvas.getAllByText("Approve");
    await expect(approveButtons.length).toBeGreaterThan(0);
    const denyButtons = canvas.getAllByText("Deny");
    await expect(denyButtons.length).toBeGreaterThan(0);
  },
};

export const GatewayStatus: Story = {
  args: { activeTab: "overview", gatewayStatusVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Gateway")).toBeInTheDocument();
    await expect(canvas.getByText("v3")).toBeInTheDocument();
  },
};

export const WorkspaceFiles: Story = {
  args: { activeTab: "overview", workspaceFilesVariant: "v1" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Workspace")).toBeInTheDocument();
    await expect(canvas.getByText("openclaw.yaml")).toBeInTheDocument();
    await expect(canvas.getByText("system-prompt.md")).toBeInTheDocument();
  },
};

// ── Interactive variant switcher ──

function AgentViewSwitcher() {
  const [variant, setVariant] = useState<StyleVariant>("off");
  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-2 flex-shrink-0">
        {(["off", "v1", "v2", "v3"] as const).map((v) => (
          <button key={v} onClick={() => setVariant(v)}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${variant === v ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-low text-text-muted"}`}>
            {v}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        <AgentView agentName="test-agent" activeTab="overview" {...setAll(variant)} showStatusCard showConfigQuickView />
      </div>
    </div>
  );
}

export const InteractivePresetSwitcher: Story = {
  render: () => <AgentViewSwitcher />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("v1"));
    await expect(canvas.getByText("RUNNING")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("v2"));
    await userEvent.click(canvas.getByText("v3"));
    await userEvent.click(canvas.getByText("off"));
  },
};

// ── Overview Menu (three-dot) ──

export const OverviewMenuOpen: Story = {
  args: { activeTab: "overview", showStatusCard: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Find and click the three-dot menu button
    const menuBtns = canvasElement.querySelectorAll('[class*="pr-2"] button');
    if (menuBtns.length > 0) {
      await userEvent.click(menuBtns[0] as HTMLElement);
      await expect(canvas.getByText("Modules")).toBeInTheDocument();
      await expect(canvas.getByText("Status Card")).toBeInTheDocument();
      await expect(canvas.getByText("Config")).toBeInTheDocument();
      await expect(canvas.getByText("Sessions")).toBeInTheDocument();
    }
  },
};

export const OverviewMenuHideAll: Story = {
  args: { activeTab: "overview", showStatusCard: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("RUNNING")).toBeInTheDocument();
    const menuBtns = canvasElement.querySelectorAll('[class*="pr-2"] button');
    if (menuBtns.length > 0) {
      await userEvent.click(menuBtns[0] as HTMLElement);
      await userEvent.click(canvas.getByText("None"));
    }
    // Status card should be gone
    await expect(canvas.queryByText("RUNNING")).toBeNull();
  },
};

export const OverviewMenuShowAll: Story = {
  args: { activeTab: "overview", showStatusCard: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Hide all first
    const menuBtns = canvasElement.querySelectorAll('[class*="pr-2"] button');
    if (menuBtns.length > 0) {
      await userEvent.click(menuBtns[0] as HTMLElement);
      await userEvent.click(canvas.getByText("None"));
      await expect(canvas.queryByText("RUNNING")).toBeNull();
      // Show all
      await userEvent.click(menuBtns[0] as HTMLElement);
      await userEvent.click(canvas.getByText("All"));
      await expect(canvas.getByText("RUNNING")).toBeInTheDocument();
    }
  },
};

export const OverviewMenuToggleSingle: Story = {
  args: { activeTab: "overview", showStatusCard: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("RUNNING")).toBeInTheDocument();
    // Open menu, uncheck Status Card
    const menuBtns = canvasElement.querySelectorAll('[class*="pr-2"] button');
    if (menuBtns.length > 0) {
      await userEvent.click(menuBtns[0] as HTMLElement);
      await userEvent.click(canvas.getByText("Status Card"));
      // Close menu
      await userEvent.click(menuBtns[0] as HTMLElement);
      await expect(canvas.queryByText("RUNNING")).toBeNull();
      // Re-enable
      await userEvent.click(menuBtns[0] as HTMLElement);
      await userEvent.click(canvas.getByText("Status Card"));
      await userEvent.click(menuBtns[0] as HTMLElement);
      await expect(canvas.getByText("RUNNING")).toBeInTheDocument();
    }
  },
};

export const OverviewMenuNotOnOtherTabs: Story = {
  args: { activeTab: "skills" },
  play: async ({ canvasElement }) => {
    // Menu button should not appear on non-overview tabs
    const menuBtns = canvasElement.querySelectorAll('[class*="pr-2"] button');
    expect(menuBtns.length).toBe(0);
  },
};

// ── ConnectionDetail Stories ──

const connectedConnection = {
  id: "telegram", name: "Telegram", icon: MessageSquare,
  category: "Communication", connected: true,
  description: "Send and receive messages via Telegram bot",
};

const disconnectedConnection = {
  id: "slack", name: "Slack", icon: MessageSquare,
  category: "Communication", connected: false,
  description: "Team messaging and channels",
};

export const DetailConnected: StoryObj<typeof ConnectionDetail> = {
  render: () => (
    <div className="bg-background h-[400px] w-[320px]">
      <ConnectionDetail connection={connectedConnection} onClose={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Telegram")).toBeInTheDocument();
    await expect(canvas.getByText("Connected")).toBeInTheDocument();
    await expect(canvas.getByText("Disconnect")).toBeInTheDocument();
    await expect(canvas.getByText("Communication")).toBeInTheDocument();
  },
};

export const DetailDisconnected: StoryObj<typeof ConnectionDetail> = {
  render: () => (
    <div className="bg-background h-[400px] w-[320px]">
      <ConnectionDetail connection={disconnectedConnection} onClose={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Slack")).toBeInTheDocument();
    await expect(canvas.getByText("Not connected")).toBeInTheDocument();
    await expect(canvas.getByText("Connect")).toBeInTheDocument();
  },
};

export const DetailCloseAction: StoryObj<typeof ConnectionDetail> = {
  render: () => {
    const onClose = fn();
    return (
      <div className="bg-background h-[400px] w-[320px]">
        <ConnectionDetail connection={connectedConnection} onClose={onClose} />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("Close"));
  },
};

export const DetailNull: StoryObj<typeof ConnectionDetail> = {
  render: () => (
    <div className="bg-background h-[400px] w-[320px]">
      <ConnectionDetail connection={null} onClose={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    // Should render nothing
    await expect(canvasElement.querySelector('[class*="rounded-xl"]')).toBeNull();
  },
};
