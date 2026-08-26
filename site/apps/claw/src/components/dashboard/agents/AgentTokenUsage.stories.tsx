import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AgentTokenUsage, DailyTokenLimitDialog } from "./AgentTokenUsage";

const noOp = () => undefined;

const meta = {
  title: "Agents/Token Usage",
  component: AgentTokenUsage,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-64 border border-border bg-[var(--agent-panel-background)] p-3 text-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    onUpgrade: noOp,
  },
} satisfies Meta<typeof AgentTokenUsage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Normal: Story = {
  args: {
    tokenUsed: 8_000_000,
    tokenLimit: 25_000_000,
  },
};

export const ApproachingLimit: Story = {
  args: {
    tokenUsed: 20_000_000,
    tokenLimit: 25_000_000,
    capacityActionLabel: "Add capacity",
  },
};

export const LimitReached: Story = {
  args: {
    tokenUsed: 25_000_000,
    tokenLimit: 25_000_000,
    capacityActionLabel: "Add capacity",
  },
};

export const CollapsedApproaching: Story = {
  args: {
    collapsed: true,
    tokenUsed: 20_000_000,
    tokenLimit: 25_000_000,
    capacityActionLabel: "Add capacity",
  },
};

export const CollapsedReached: Story = {
  args: {
    collapsed: true,
    tokenUsed: 25_000_000,
    tokenLimit: 25_000_000,
    capacityActionLabel: "Add capacity",
  },
};

export const MobileReached: Story = {
  args: {
    renderMobile: true,
    tokenUsed: 25_000_000,
    tokenLimit: 25_000_000,
    capacityActionLabel: "Add capacity",
  },
};

export const BlockedAction: Story = {
  args: {
    tokenUsed: 25_000_000,
    tokenLimit: 25_000_000,
    capacityActionLabel: "Add capacity",
  },
  render: (args) => (
    <>
      <AgentTokenUsage {...args} />
      <DailyTokenLimitDialog open actionLabel="Add capacity" onOpenChange={noOp} onAction={noOp} />
    </>
  ),
};
