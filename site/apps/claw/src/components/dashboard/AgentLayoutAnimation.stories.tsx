import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { Menu } from "lucide-react";
import { AgentLayoutAnimation } from "./AgentLayoutAnimation";
import { AgentGatewayLoadingVisual } from "./AgentGatewayLoadingVisual";
import { AgentEmptyHistory } from "./agents/AgentEmptyHistory";

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

const emptyHistoryActions = {
  onOpenFiles: () => {},
  onOpenIntegrations: () => {},
  onOpenIntegrationChatCard: () => {},
  onOpenSkills: () => {},
  onOpenScheduled: () => {},
};

function MobileChatFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[812px] w-[375px] flex-col overflow-hidden bg-[#030303] text-white">
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
      {children}
    </div>
  );
}

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
    <MobileChatFrame>
      <div className="flex flex-1 items-center justify-center px-5">
        <AgentGatewayLoadingVisual />
      </div>
    </MobileChatFrame>
  ),
};

export const BootStages: Story = {
  render: () => (
    <div className="grid min-h-[720px] min-w-[760px] grid-cols-2 gap-6 bg-[#030303] p-8">
      {[
        ["Provisioning runtime", "Reserving compute and preparing the workspace.", "loading" as const],
        ["Booting agent", "Starting the container and OpenClaw services.", "loading" as const],
        ["Connecting gateway", "Opening the agent session.", "loading" as const],
        ["Retrying connection", "Attempt 1 of 3.", "loading" as const],
        ["Loading workspace", "Fetching messages, files, and config.", "loading" as const],
        ["Could not connect", "Gateway handshake failed.", "error" as const],
      ].map(([title, detail, status]) => (
        <div key={title} className="flex min-h-[260px] items-center justify-center rounded-lg border border-white/10 bg-black px-5">
          <AgentGatewayLoadingVisual
            title={title}
            detail={detail}
            status={status}
            actionLabel={status === "error" ? "Retry" : undefined}
            onAction={status === "error" ? () => {} : undefined}
          />
        </div>
      ))}
    </div>
  ),
};

export const ReadyEmptyChat: Story = {
  render: () => (
    <MobileChatFrame>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3">
        <AgentEmptyHistory onPromptSelect={() => {}} actions={emptyHistoryActions} />
      </div>
      <div className="flex-shrink-0 px-3 pb-3 pt-2">
        <textarea
          aria-label="Message agent"
          rows={1}
          placeholder="Message agent..."
          className="w-full resize-none rounded-3xl border border-white/10 bg-[#232323] px-5 py-3 text-sm text-white outline-none placeholder:text-white/35"
        />
      </div>
    </MobileChatFrame>
  ),
};

export const ReadyEmptyChatDesktop: Story = {
  render: () => (
    <div className="flex h-[720px] w-[960px] flex-col overflow-hidden bg-[#030303] text-white">
      <div className="flex h-14 flex-shrink-0 items-center justify-center border-b border-white/10 px-5">
        <span className="text-sm font-semibold">Agent</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4">
        <div className="flex max-h-full min-h-0 w-full items-center justify-center overflow-y-auto">
          <AgentEmptyHistory onPromptSelect={() => {}} actions={emptyHistoryActions} />
        </div>
      </div>
      <div className="flex-shrink-0 px-4 pb-4 pt-2">
        <textarea
          aria-label="Message agent"
          rows={1}
          placeholder="Message agent..."
          className="mx-auto block w-full max-w-5xl resize-none rounded-3xl border border-white/10 bg-[#232323] px-5 py-3 text-sm text-white outline-none placeholder:text-white/35"
        />
      </div>
    </div>
  ),
};

export const ReconnectWithDraft: Story = {
  render: () => (
    <MobileChatFrame>
      <div className="flex min-h-0 flex-1 items-center justify-center px-5">
        <AgentGatewayLoadingVisual
          title="Waiting for gateway"
          detail="The runtime is up. Reconnecting to the agent session."
        />
      </div>
      <div className="flex-shrink-0 px-3 pb-3 pt-2">
        <textarea
          aria-label="Message draft"
          rows={1}
          value="Summarize the changes in the workspace"
          readOnly
          disabled
          className="w-full resize-none rounded-3xl border border-white/10 bg-[#232323] px-5 py-3 text-sm text-white opacity-50 outline-none"
        />
      </div>
    </MobileChatFrame>
  ),
};
