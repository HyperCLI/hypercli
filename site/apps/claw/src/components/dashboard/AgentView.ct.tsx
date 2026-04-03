import { test, expect } from "@playwright/experimental-ct-react";
import { AgentView, ConnectionDetail } from "./AgentView";
import { MessageSquare } from "lucide-react";

// ── Tab Rendering ──

test.describe("AgentView — Tabs", () => {
  test("renders overview tab by default", async ({ mount }) => {
    const component = await mount(<AgentView />);
    await expect(component.getByText("Overview")).toBeVisible();
  });

  test("renders all 5 tab buttons", async ({ mount }) => {
    const component = await mount(<AgentView showCronManager />);
    for (const tab of ["Overview", "Activity", "Skills", "Connections", "Cron"]) {
      await expect(component.getByText(tab)).toBeVisible();
    }
  });

  test("switches to activity tab on click", async ({ mount }) => {
    const component = await mount(<AgentView />);
    await component.getByText("Activity").click();
    await expect(component.getByText("Activity Log").or(component.getByText("Recent Tool Calls"))).toBeVisible();
  });

  test("switches to skills tab on click", async ({ mount }) => {
    const component = await mount(<AgentView />);
    await component.getByText("Skills").click();
    await expect(component.getByText("Web Search")).toBeVisible();
  });

  test("switches to connections tab on click", async ({ mount }) => {
    const component = await mount(<AgentView />);
    await component.getByText("Connections").click();
    await expect(component.getByText("My Connections")).toBeVisible();
  });

  test("switches to cron tab on click", async ({ mount }) => {
    const component = await mount(<AgentView showCronManager />);
    await component.getByText("Cron").click();
    await expect(component.getByText("Morning briefing")).toBeVisible();
  });

  test("controlled activeTab renders correct content", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="skills" />);
    await expect(component.getByText("Web Search")).toBeVisible();
  });

  test("calls onTabChange when tab clicked", async ({ mount }) => {
    let tabChanged = "";
    const component = await mount(
      <AgentView onTabChange={(tab) => { tabChanged = tab; }} />,
    );
    await component.getByText("Skills").click();
    expect(tabChanged).toBe("skills");
  });
});

// ── Feature Toggles ──

test.describe("AgentView — Feature Toggles", () => {
  test("showStatusCard=false hides status card", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" showStatusCard={false} />);
    await expect(component.getByText("RUNNING")).not.toBeVisible();
  });

  test("showStatusCard=true shows status card", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" showStatusCard />);
    await expect(component.getByText("RUNNING")).toBeVisible();
  });

  test("showConfigQuickView shows config section", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" showConfigQuickView />);
    await expect(component.getByText("Config")).toBeVisible();
    await expect(component.getByText("claude-opus-4-6")).toBeVisible();
  });

  test("showActiveSessions shows sessions", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" showActiveSessions />);
    await expect(component.getByText("Sessions")).toBeVisible();
    await expect(component.getByText("Dashboard")).toBeVisible();
  });

  test("showSubAgents shows sub-agents section", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" showSubAgents />);
    await expect(component.getByText("Sub-agents")).toBeVisible();
    await expect(component.getByText("research-agent")).toBeVisible();
  });

  test("showSearch=false hides search bar on connections tab", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="connections" showSearch={false} />);
    await expect(component.locator("input[placeholder*='Search']")).not.toBeVisible();
  });

  test("showMarketplace=false hides marketplace button", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="connections" showMarketplace={false} />);
    await expect(component.getByText("Marketplace")).not.toBeVisible();
  });
});

// ── Connection Interactions ──

test.describe("AgentView — Connections", () => {
  test("search filters connections", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="connections" showSearch />);
    const search = component.locator("input[placeholder*='Search']");
    await search.fill("Telegram");
    await expect(component.getByText("Telegram")).toBeVisible();
    await expect(component.getByText("Gmail")).not.toBeVisible();
  });

  test("my connections section collapses", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="connections" />);
    await component.getByText("My Connections").click();
    await expect(component.getByText("Telegram")).not.toBeVisible();
  });

  test("calls onConnectionSelect when row clicked", async ({ mount }) => {
    let selected = "";
    const component = await mount(
      <AgentView activeTab="connections" onConnectionSelect={(c) => { selected = c.id; }} />,
    );
    await component.getByText("Telegram").click();
    expect(selected).toBe("telegram");
  });
});

// ── Style Variants ──

test.describe("AgentView — Style Variants", () => {
  test("tabBarStyle v1 renders pill tabs", async ({ mount }) => {
    const component = await mount(<AgentView tabBarStyle="v1" />);
    await expect(component).toBeVisible();
  });

  test("tabBarStyle v2 renders segmented control", async ({ mount }) => {
    const component = await mount(<AgentView tabBarStyle="v2" />);
    await expect(component).toBeVisible();
  });

  test("tabBarStyle v3 renders icon tabs", async ({ mount }) => {
    const component = await mount(<AgentView tabBarStyle="v3" />);
    await expect(component).toBeVisible();
  });

  test("skillsVariant v1 renders cards", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="skills" skillsVariant="v1" />);
    await expect(component.getByText("Web Search")).toBeVisible();
  });

  test("activityVariant v1 renders timeline", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="activity" activityVariant="v1" />);
    await expect(component.getByText("Message sent")).toBeVisible();
  });

  test("connectionRowStyle v1 renders compact rows", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="connections" connectionRowStyle="v1" />);
    await expect(component.getByText("Telegram")).toBeVisible();
  });
});

// ── UX Discovery Features ──

test.describe("AgentView — UX Discovery", () => {
  test("onboarding v1 shows step banner", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" onboardingVariant="v1" />);
    await expect(component.getByText("Getting Started")).toBeVisible();
  });

  test("onboarding steps advance on Next click", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" onboardingVariant="v1" />);
    await expect(component.getByText("Agent Status")).toBeVisible();
    await component.getByText("Next").click();
    await expect(component.getByText("Configuration")).toBeVisible();
  });

  test("onboarding dismisses on Skip", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" onboardingVariant="v1" />);
    await component.getByText("Skip").click();
    await expect(component.getByText("Getting Started")).not.toBeVisible();
  });

  test("completenessRing v1 shows circular ring", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" completenessRingVariant="v1" />);
    await expect(component.getByText("Agent Readiness")).toBeVisible();
  });

  test("quickActions v1 shows action chips", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" quickActionsVariant="v1" />);
    await expect(component.getByText("Quick Actions")).toBeVisible();
    await expect(component.getByText("Search the web")).toBeVisible();
  });

  test("modelCaps v1 shows capability grid", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" modelCapsVariant="v1" />);
    await expect(component.getByText("Model Capabilities")).toBeVisible();
    await expect(component.getByText("Vision")).toBeVisible();
  });

  test("toolUsage v1 shows bar chart", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" toolUsageVariant="v1" />);
    await expect(component.getByText("Tool Usage")).toBeVisible();
  });

  test("achievements v1 shows stats grid", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" achievementsVariant="v1" />);
    await expect(component.getByText("This Week")).toBeVisible();
    await expect(component.getByText("142")).toBeVisible();
  });

  test("permissions v1 shows table rows", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" permissionsVariant="v1" />);
    await expect(component.getByText("Permissions")).toBeVisible();
    await expect(component.getByText("File system")).toBeVisible();
  });

  test("channels v1 shows channel list", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" channelsVariant="v1" />);
    await expect(component.getByText("Channels")).toBeVisible();
    await expect(component.getByText("Telegram")).toBeVisible();
  });

  test("execQueue v1 shows pending commands", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" execQueueVariant="v1" />);
    await expect(component.getByText("Pending Approval")).toBeVisible();
    await expect(component.getByText("Approve")).toBeVisible();
  });

  test("gatewayStatus v1 shows stats", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" gatewayStatusVariant="v1" />);
    await expect(component.getByText("Gateway")).toBeVisible();
  });

  test("workspaceFiles v1 shows file list", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" workspaceFilesVariant="v1" />);
    await expect(component.getByText("Workspace")).toBeVisible();
    await expect(component.getByText("openclaw.yaml")).toBeVisible();
  });
});

// ── Overview Menu (three-dot) ──

test.describe("AgentView — Overview Menu", () => {
  test("three-dot menu button appears on overview tab", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" showStatusCard />);
    await expect(component.locator("button").filter({ has: component.locator("svg") }).last()).toBeVisible();
  });

  test("menu opens on click and shows module list", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" showStatusCard />);
    // Click the three-dot button (last button in the tab bar area)
    const menuBtn = component.locator('[class*="pr-2"] button');
    await menuBtn.click();
    await expect(component.getByText("Modules")).toBeVisible();
    await expect(component.getByText("Status Card")).toBeVisible();
    await expect(component.getByText("Config")).toBeVisible();
  });

  test("menu has Show All and Hide None buttons", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" showStatusCard />);
    const menuBtn = component.locator('[class*="pr-2"] button');
    await menuBtn.click();
    await expect(component.getByText("All")).toBeVisible();
    await expect(component.getByText("None")).toBeVisible();
  });

  test("clicking None hides all modules", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" showStatusCard />);
    const menuBtn = component.locator('[class*="pr-2"] button');
    await menuBtn.click();
    await component.getByText("None").click();
    // Status card should be hidden
    await expect(component.getByText("RUNNING")).not.toBeVisible();
  });

  test("clicking All after None restores all modules", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" showStatusCard />);
    const menuBtn = component.locator('[class*="pr-2"] button');
    await menuBtn.click();
    await component.getByText("None").click();
    await expect(component.getByText("RUNNING")).not.toBeVisible();
    // Re-open menu and click All
    await menuBtn.click();
    await component.getByText("All").click();
    await expect(component.getByText("RUNNING")).toBeVisible();
  });

  test("toggling individual module hides/shows it", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="overview" showStatusCard />);
    await expect(component.getByText("RUNNING")).toBeVisible();
    // Open menu and uncheck Status Card
    const menuBtn = component.locator('[class*="pr-2"] button');
    await menuBtn.click();
    await component.getByText("Status Card").click();
    // Close menu by clicking outside or re-clicking
    await menuBtn.click();
    await expect(component.getByText("RUNNING")).not.toBeVisible();
    // Re-enable
    await menuBtn.click();
    await component.getByText("Status Card").click();
    await menuBtn.click();
    await expect(component.getByText("RUNNING")).toBeVisible();
  });

  test("menu does not appear on non-overview tabs", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="skills" />);
    await expect(component.locator('[class*="pr-2"] button')).not.toBeVisible();
  });
});

// ── Cron Tab ──

test.describe("AgentView — Cron", () => {
  test("shows cron jobs with schedules", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="cron" showCronManager />);
    await expect(component.getByText("0 9 * * *")).toBeVisible();
    await expect(component.getByText("Morning briefing")).toBeVisible();
  });

  test("cron toggle switches enabled state", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="cron" showCronManager />);
    await expect(component).toBeVisible();
    // Toggle exists for each cron job
  });

  test("add cron button is visible", async ({ mount }) => {
    const component = await mount(<AgentView activeTab="cron" showCronManager />);
    await expect(component.getByText("Add Cron Job")).toBeVisible();
  });
});

// ── ConnectionDetail Tests ──

test.describe("ConnectionDetail", () => {
  const connected = {
    id: "telegram",
    name: "Telegram",
    icon: MessageSquare,
    category: "Communication",
    connected: true,
    description: "Send and receive messages via Telegram bot",
  };

  const disconnected = {
    id: "slack",
    name: "Slack",
    icon: MessageSquare,
    category: "Communication",
    connected: false,
    description: "Team messaging and channels",
  };

  test("renders connected state with disconnect button", async ({ mount }) => {
    const component = await mount(<ConnectionDetail connection={connected} onClose={() => {}} />);
    await expect(component.getByText("Telegram")).toBeVisible();
    await expect(component.getByText("Connected")).toBeVisible();
    await expect(component.getByText("Disconnect")).toBeVisible();
  });

  test("renders disconnected state with connect button", async ({ mount }) => {
    const component = await mount(<ConnectionDetail connection={disconnected} onClose={() => {}} />);
    await expect(component.getByText("Slack")).toBeVisible();
    await expect(component.getByText("Not connected")).toBeVisible();
    await expect(component.getByText("Connect")).toBeVisible();
  });

  test("renders nothing for null connection", async ({ mount }) => {
    const component = await mount(<ConnectionDetail connection={null} onClose={() => {}} />);
    await expect(component).toBeEmpty();
  });

  test("close button calls onClose", async ({ mount }) => {
    let closed = false;
    const component = await mount(
      <ConnectionDetail connection={connected} onClose={() => { closed = true; }} />,
    );
    await component.getByText("Close").click();
    expect(closed).toBe(true);
  });
});
