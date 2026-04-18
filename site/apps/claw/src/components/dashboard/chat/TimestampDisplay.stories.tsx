import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TimestampDisplay } from "./TimestampDisplay";

const meta: Meta<typeof TimestampDisplay> = {
  title: "Chat/TimestampDisplay",
  component: TimestampDisplay,
  argTypes: {
    variant: { control: "select", options: ["off", "v1", "v2", "v3"] },
    placement: { control: "select", options: ["inside", "outside"] },
  },
  decorators: [
    (Story) => (
      <div className="p-4 bg-[#0a0a0b] max-w-md group" style={{ minHeight: 60 }}>
        <p className="text-xs text-text-muted mb-2">Hover to reveal &quot;off&quot; variant</p>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TimestampDisplay>;

export const HoverOnly: Story = {
  args: { timestamp: Date.now() - 60_000, variant: "off", placement: "outside", isUser: false },
};

export const AlwaysVisible: Story = {
  args: { timestamp: Date.now() - 60_000, variant: "v1", placement: "outside", isUser: false },
};

export const InsideBubble: Story = {
  args: { timestamp: Date.now() - 60_000, variant: "v2", placement: "inside", isUser: false },
};

export const RelativeTime: Story = {
  args: { timestamp: Date.now() - 300_000, variant: "v3", placement: "outside", isUser: false },
};

export const UserTimestamp: Story = {
  args: { timestamp: Date.now() - 120_000, variant: "v2", placement: "inside", isUser: true },
};
