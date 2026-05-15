import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Menu } from "lucide-react";
import { AgentLayoutAnimation } from "./AgentLayoutAnimation";
import { AgentGatewayLoadingVisual } from "./AgentGatewayLoadingVisual";

const meta: Meta<typeof AgentLayoutAnimation> = {
  title: "Dashboard/AgentLayoutAnimation",
  component: AgentLayoutAnimation,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-[360px] min-w-[420px] items-center justify-center bg-[#0a0a0b] p-8">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AgentLayoutAnimation>;

export const Default: Story = {
  args: {
    className: "h-28 w-28",
  },
};

export const SidebarScale: Story = {
  args: {
    className: "h-8 w-8",
    title: "Agents navigation animation",
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-[180px] min-w-[280px] items-center justify-center bg-[#0a0a0b] p-8">
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#111214] px-3 py-2">
          <Story />
          <span className="text-xs font-semibold uppercase tracking-wider text-white/60">Agents</span>
        </div>
      </div>
    ),
  ],
};

export const ScaleComparison: Story = {
  render: () => (
    <div className="grid min-h-[360px] min-w-[520px] grid-cols-3 items-end gap-8 bg-[#0a0a0b] p-10">
      <div className="flex flex-col items-center gap-3">
        <AgentLayoutAnimation className="h-8 w-8" title="Small agent layout animation" />
        <span className="text-[11px] font-medium text-white/45">32px</span>
      </div>
      <div className="flex flex-col items-center gap-3">
        <AgentLayoutAnimation className="h-16 w-16" title="Medium agent layout animation" />
        <span className="text-[11px] font-medium text-white/45">64px</span>
      </div>
      <div className="flex flex-col items-center gap-3">
        <AgentLayoutAnimation className="h-32 w-32" title="Large agent layout animation" />
        <span className="text-[11px] font-medium text-white/45">128px</span>
      </div>
    </div>
  ),
};

export const LoadingState: Story = {
  render: () => (
    <div className="flex h-[812px] w-[375px] flex-col bg-[#030303] text-white">
      <div className="flex h-[76px] flex-shrink-0 items-center justify-between border-b border-white/10 px-5">
        <span className="text-[17px] font-semibold">Chat</span>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-white/15 bg-white/[0.04] text-white/75"
          aria-label="Open menu"
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center px-5">
        <AgentGatewayLoadingVisual />
      </div>
    </div>
  ),
};
