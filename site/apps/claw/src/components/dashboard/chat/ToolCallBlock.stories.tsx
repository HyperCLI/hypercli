import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { ToolCallBlock } from "./ToolCallBlock";

const meta: Meta<typeof ToolCallBlock> = {
  title: "Chat/ToolCallBlock",
  component: ToolCallBlock,
  args: {
    onToggle: fn(),
  },
  argTypes: {
    themeVariant: { control: "select", options: ["off", "v1", "v2", "v3"] },
  },
  decorators: [
    (Story) => (
      <div className="max-w-md p-4 bg-[#0a0a0b]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ToolCallBlock>;

export const Completed: Story = {
  args: {
    toolCall: {
      id: "tc-1",
      name: "file_read",
      args: '{"file_path": "/config/openclaw.json"}',
      result: '{"ok": true}',
    },
    index: 0,
    isOpen: false,
    themeVariant: "v2",
  },
};

export const Pending: Story = {
  args: {
    toolCall: {
      id: "tc-2",
      name: "deploy_update",
      args: '{"env": "staging", "version": "2.1.0"}',
    },
    index: 0,
    isOpen: false,
    themeVariant: "v2",
  },
};

export const Expanded: Story = {
  args: {
    toolCall: {
      id: "tc-3",
      name: "shell_exec",
      args: '{"command": "ls -la /app/config/"}',
      result: 'total 24\ndrwxr-xr-x 2 root root 4096 Apr 10 12:00 .\n-rw-r--r-- 1 root root  512 Apr 10 12:00 openclaw.json\n-rw-r--r-- 1 root root  256 Apr 10 12:00 env.json',
    },
    index: 0,
    isOpen: true,
    themeVariant: "v2",
  },
};

export const ThemeDefault: Story = {
  args: {
    ...Completed.args,
    themeVariant: "off",
  },
};

export const ThemeV1: Story = {
  args: {
    ...Completed.args,
    themeVariant: "v1",
  },
};

export const ThemeV3: Story = {
  args: {
    ...Completed.args,
    themeVariant: "v3",
  },
};
