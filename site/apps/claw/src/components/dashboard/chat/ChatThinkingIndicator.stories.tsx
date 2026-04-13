import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChatThinkingIndicator } from "./ChatThinkingIndicator";

const meta: Meta<typeof ChatThinkingIndicator> = {
  title: "Chat/ChatThinkingIndicator",
  component: ChatThinkingIndicator,
  decorators: [
    (Story) => (
      <div className="p-4 bg-[#0a0a0b] min-h-[80px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ChatThinkingIndicator>;

export const Default: Story = {
  args: {},
};
