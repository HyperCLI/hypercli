import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StreamingIndicator } from "./StreamingIndicator";

const meta: Meta<typeof StreamingIndicator> = {
  title: "Chat/StreamingIndicator",
  component: StreamingIndicator,
  decorators: [
    (Story) => (
      <div className="p-4 bg-[#0a0a0b] relative overflow-hidden rounded-2xl border border-[#2a2a2c] max-w-md min-h-[60px] flex items-center">
        <span className="text-sm text-foreground mr-2">Some streaming text</span>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof StreamingIndicator>;

export const BlinkingCursor: Story = {
  args: { variant: "v1", isStreaming: true, isUser: false },
};

export const PulsingDot: Story = {
  args: { variant: "v2", isStreaming: true, isUser: false },
};

export const ShimmerSweep: Story = {
  args: { variant: "v3", isStreaming: true, isUser: false },
};

export const NotStreaming: Story = {
  args: { variant: "v2", isStreaming: false, isUser: false },
};
