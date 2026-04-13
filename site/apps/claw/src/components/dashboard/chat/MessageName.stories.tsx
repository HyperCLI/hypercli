import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MessageName } from "./MessageName";

const meta: Meta<typeof MessageName> = {
  title: "Chat/MessageName",
  component: MessageName,
  decorators: [
    (Story) => (
      <div className="p-4 bg-[#0a0a0b] min-h-[100px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof MessageName>;

export const V1Monogram: Story = {
  args: {
    variant: "v1",
    placement: "above-bubble",
    isUser: false,
    effectiveName: "Claude Agent",
  },
};

export const V2AvatarLeft: Story = {
  args: {
    variant: "v2",
    placement: "avatar-left",
    isUser: false,
    effectiveName: "Claude Agent",
  },
};

export const V2TextAbove: Story = {
  args: {
    variant: "v2",
    placement: "text-above",
    isUser: false,
    effectiveName: "Claude Agent",
  },
};

export const V3SparkleAbove: Story = {
  args: {
    variant: "v3",
    placement: "above-bubble",
    isUser: false,
    effectiveName: "Claude Agent",
  },
};

export const UserNameV1: Story = {
  args: {
    variant: "v1",
    placement: "above-bubble",
    isUser: true,
    effectiveName: "Francisco",
  },
};

export const UserNameV3: Story = {
  args: {
    variant: "v3",
    placement: "above-bubble",
    isUser: true,
    effectiveName: "Francisco",
  },
};
