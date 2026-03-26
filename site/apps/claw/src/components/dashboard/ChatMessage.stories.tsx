import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect } from "storybook/test";
import { ChatMessageBubble, ChatThinkingIndicator } from "./ChatMessage";
import type { ChatMessage } from "@/hooks/useGatewayChat";
import type { FeatureVariant } from "./ChatMessage";
import { useState } from "react";

// ── Fixtures ──

const USER_MSG: ChatMessage = {
  role: "user",
  content: "Can you help me set up a Next.js project with Tailwind CSS?",
  timestamp: Date.now() - 120_000,
};

const ASSISTANT_MSG: ChatMessage = {
  role: "assistant",
  content:
    "Sure! Here's how:\n\n1. Create the project:\n```bash\nnpx create-next-app@latest my-app --tailwind\n```\n\n2. Start the dev server:\n```bash\nnpm run dev\n```\n\nThe `--tailwind` flag automatically configures Tailwind CSS.",
  timestamp: Date.now() - 60_000,
};

const THINKING_MSG: ChatMessage = {
  role: "assistant",
  content: "The bottleneck is in the `useGatewayChat` hook. The WebSocket reconnection logic creates a new closure on every retry.",
  thinking:
    "Let me analyze the gateway disconnection issue.\n\nThe user mentioned disconnection after ~5 minutes. This is a common pattern with WebSocket connections lacking keep-alive.\n\nI should check:\n1. Cleanup in useEffect\n2. The `cancelled` flag\n3. Stale closures",
  timestamp: Date.now() - 90_000,
};

const TOOLCALL_MSG: ChatMessage = {
  role: "assistant",
  content: "I found the issue. The file `gateway-client.ts` has a missing null check on line 142.",
  toolCalls: [
    {
      id: "call_1",
      name: "Read",
      args: '{"file_path": "src/gateway-client.ts", "offset": 130, "limit": 20}',
      result: "140: async connect() {\n141:   const ws = new WebSocket(this.url);\n142:   ws.onmessage = (ev) => this.handleMessage(ev.data);\n143: }",
    },
  ],
  timestamp: Date.now() - 45_000,
};

const MULTI_TOOL_MSG: ChatMessage = {
  role: "assistant",
  content: "I've updated both files.",
  toolCalls: [
    { id: "call_3", name: "Edit", args: '{"file_path": "src/hooks/useGatewayChat.ts"}', result: "File edited successfully." },
    { id: "call_4", name: "Edit", args: '{"file_path": "src/gateway-client.ts"}', result: "File edited successfully." },
    { id: "call_5", name: "Bash", args: '{"command": "npm run typecheck"}' },
  ],
  timestamp: Date.now() - 35_000,
};

const TOOLCALL_PENDING_MSG: ChatMessage = {
  role: "assistant",
  content: "",
  toolCalls: [{ id: "call_2", name: "Bash", args: '{"command": "npm run build"}' }],
  timestamp: Date.now() - 40_000,
};

const SYSTEM_MSG: ChatMessage = {
  role: "system",
  content: "Error: WebSocket connection closed unexpectedly (code 1006)",
  timestamp: Date.now() - 30_000,
};

const FILE_MSG: ChatMessage = {
  role: "user",
  content: "Can you check these files?",
  files: [
    { name: "gateway-client.ts", path: "/src/gateway-client.ts", type: "text/typescript" },
    { name: "useGatewayChat.ts", path: "/src/hooks/useGatewayChat.ts", type: "text/typescript" },
  ],
  timestamp: Date.now() - 20_000,
};

const VARIANT_OPTIONS = ["off", "v1", "v2", "v3"] as const;

// ── ChatMessageBubble Stories ──

const meta: Meta<typeof ChatMessageBubble> = {
  title: "Dashboard/ChatMessageBubble",
  component: ChatMessageBubble,
  argTypes: {
    bubblesVariant: { control: "select", options: VARIANT_OPTIONS },
    themeVariant: { control: "select", options: VARIANT_OPTIONS },
    nameVariant: { control: "select", options: VARIANT_OPTIONS },
    timestampVariant: { control: "select", options: VARIANT_OPTIONS },
    animationVariant: { control: "select", options: VARIANT_OPTIONS },
    streamingVariant: { control: "select", options: VARIANT_OPTIONS },
    isStreaming: { control: "boolean" },
    agentName: { control: "text" },
  },
  args: {
    bubblesVariant: "off",
    themeVariant: "off",
    nameVariant: "off",
    timestampVariant: "off",
    animationVariant: "off",
    streamingVariant: "off",
    isStreaming: false,
    agentName: "TestBot",
  },
  decorators: [
    (Story) => (
      <div className="bg-background p-6 space-y-4 max-w-xl">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ChatMessageBubble>;

// ── Basic rendering ──

export const UserMessage: Story = {
  args: { message: USER_MSG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Can you help me/)).toBeInTheDocument();
  },
};

export const AssistantMessage: Story = {
  args: { message: ASSISTANT_MSG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/npm run dev/)).toBeInTheDocument();
    await expect(canvas.getByText(/--tailwind/)).toBeInTheDocument();
  },
};

export const SystemError: Story = {
  args: { message: SYSTEM_MSG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/WebSocket connection closed/)).toBeInTheDocument();
  },
};

export const WithFiles: Story = {
  args: { message: FILE_MSG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("gateway-client.ts")).toBeInTheDocument();
    await expect(canvas.getByText("useGatewayChat.ts")).toBeInTheDocument();
  },
};

// ── Thinking interaction ──

export const WithThinking: Story = {
  args: { message: THINKING_MSG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Should start collapsed
    await expect(canvas.getByText("Show reasoning")).toBeInTheDocument();
    // Expand
    await userEvent.click(canvas.getByText("Show reasoning"));
    await expect(canvas.getByText("Hide reasoning")).toBeInTheDocument();
    await expect(canvas.getByText(/race condition/)).toBeInTheDocument();
    // Collapse again
    await userEvent.click(canvas.getByText("Hide reasoning"));
    await expect(canvas.getByText("Show reasoning")).toBeInTheDocument();
  },
};

// ── Tool call interactions ──

export const WithToolCall: Story = {
  args: { message: TOOLCALL_MSG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Tool name visible in collapsed state
    await expect(canvas.getByText("Read")).toBeInTheDocument();
    // Expand tool call to see details
    await userEvent.click(canvas.getByText("Read"));
    await expect(canvas.getByText(/gateway-client\.ts/)).toBeInTheDocument();
    // Collapse
    await userEvent.click(canvas.getByText("Read"));
  },
};

export const ToolCallPending: Story = {
  args: { message: TOOLCALL_PENDING_MSG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Bash")).toBeInTheDocument();
    // Expand to see pending args
    await userEvent.click(canvas.getByText("Bash"));
    await expect(canvas.getByText(/npm run build/)).toBeInTheDocument();
  },
};

export const MultiToolCalls: Story = {
  args: { message: MULTI_TOOL_MSG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // All three tool names visible
    const editButtons = canvas.getAllByText("Edit");
    await expect(editButtons).toHaveLength(2);
    await expect(canvas.getByText("Bash")).toBeInTheDocument();
    // Expand first tool call
    await userEvent.click(editButtons[0]);
    await expect(canvas.getByText(/useGatewayChat/)).toBeInTheDocument();
    // Expand second
    await userEvent.click(editButtons[1]);
    await expect(canvas.getByText(/gateway-client\.ts/)).toBeInTheDocument();
  },
};

// ── Streaming ──

export const Streaming: Story = {
  args: { message: ASSISTANT_MSG, isStreaming: true, streamingVariant: "v2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/npm run dev/)).toBeInTheDocument();
    // Streaming indicator should be visible (pulsing dot)
  },
};

// ── Variant presets with interaction ──

export const AllVariantsV1: Story = {
  args: {
    message: THINKING_MSG,
    bubblesVariant: "v1",
    themeVariant: "v1",
    nameVariant: "v1",
    timestampVariant: "v1",
    animationVariant: "v1",
    agentName: "TestBot",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Name should be visible (v1 = monogram + label)
    await expect(canvas.getByText("TestBot")).toBeInTheDocument();
    await expect(canvas.getByText("T")).toBeInTheDocument();
    // Thinking toggle should work
    await userEvent.click(canvas.getByText("Show reasoning"));
    await expect(canvas.getByText(/race condition/)).toBeInTheDocument();
  },
};

export const AllVariantsV2: Story = {
  args: {
    message: TOOLCALL_MSG,
    bubblesVariant: "v2",
    themeVariant: "v2",
    nameVariant: "v2",
    timestampVariant: "v2",
    animationVariant: "v2",
    agentName: "TestBot",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // v2 name = avatar circle + name label
    await expect(canvas.getByText("TestBot")).toBeInTheDocument();
    // Tool call interaction
    await userEvent.click(canvas.getByText("Read"));
    await expect(canvas.getByText(/async connect/)).toBeInTheDocument();
  },
};

export const AllVariantsV3: Story = {
  args: {
    message: THINKING_MSG,
    bubblesVariant: "v3",
    themeVariant: "v3",
    nameVariant: "v3",
    timestampVariant: "v3",
    animationVariant: "v3",
    agentName: "TestBot",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // v3 name = sparkle + bold name
    await expect(canvas.getByText("TestBot")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Show reasoning"));
    await expect(canvas.getByText("Hide reasoning")).toBeInTheDocument();
  },
};

// ── Variant matrix ──

export const VariantMatrix: Story = {
  render: (args) => (
    <div className="grid grid-cols-2 gap-4">
      {(["off", "v1", "v2", "v3"] as const).map((v) => (
        <div key={v} className="space-y-2">
          <p className="text-xs text-text-muted font-mono">{v}</p>
          <ChatMessageBubble
            {...args}
            message={ASSISTANT_MSG}
            bubblesVariant={v}
            themeVariant={v}
            nameVariant={v}
            timestampVariant={v}
            agentName="TestBot"
          />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // All 4 variant labels should be visible
    for (const v of ["off", "v1", "v2", "v3"]) {
      await expect(canvas.getByText(v)).toBeInTheDocument();
    }
  },
};

// ── Conversation thread with interactions ──

export const ConversationThread: Story = {
  render: (args) => (
    <div className="space-y-4">
      <ChatMessageBubble {...args} message={USER_MSG} />
      <ChatMessageBubble {...args} message={THINKING_MSG} agentName="TestBot" />
      <ChatMessageBubble {...args} message={TOOLCALL_MSG} agentName="TestBot" />
      <ChatMessageBubble {...args} message={FILE_MSG} />
      <ChatMessageBubble {...args} message={SYSTEM_MSG} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Expand thinking in second message
    await userEvent.click(canvas.getByText("Show reasoning"));
    await expect(canvas.getByText(/race condition/)).toBeInTheDocument();
    // Expand tool call in third message
    await userEvent.click(canvas.getByText("Read"));
    await expect(canvas.getByText(/async connect/)).toBeInTheDocument();
  },
};

// ── Interactive variant switcher ──

function VariantSwitcher() {
  const [variant, setVariant] = useState<FeatureVariant>("off");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["off", "v1", "v2", "v3"] as const).map((v) => (
          <button key={v} onClick={() => setVariant(v)}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${variant === v ? "bg-[#38D39F]/15 text-[#38D39F]" : "bg-surface-low text-text-muted"}`}>
            {v}
          </button>
        ))}
      </div>
      <ChatMessageBubble
        message={THINKING_MSG}
        bubblesVariant={variant}
        themeVariant={variant}
        nameVariant={variant}
        timestampVariant={variant}
        animationVariant={variant}
        agentName="TestBot"
      />
      <ChatMessageBubble message={USER_MSG} bubblesVariant={variant} themeVariant={variant} />
    </div>
  );
}

export const InteractiveVariantSwitcher: Story = {
  render: () => <VariantSwitcher />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Click through each variant
    await userEvent.click(canvas.getByText("v1"));
    await expect(canvas.getByText("TestBot")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("v2"));
    await expect(canvas.getByText("TestBot")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("v3"));
    await expect(canvas.getByText("TestBot")).toBeInTheDocument();
    await userEvent.click(canvas.getByText("off"));
  },
};

// ── ChatThinkingIndicator Stories ──

export const ThinkingOff: StoryObj<typeof ChatThinkingIndicator> = {
  render: () => <ChatThinkingIndicator variant="off" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Thinking")).toBeInTheDocument();
  },
};

export const ThinkingV1: StoryObj<typeof ChatThinkingIndicator> = {
  render: () => <ChatThinkingIndicator variant="v1" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Thinking...")).toBeInTheDocument();
  },
};

export const ThinkingV2: StoryObj<typeof ChatThinkingIndicator> = {
  render: () => <ChatThinkingIndicator variant="v2" />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[class*="rounded-3xl"]')).not.toBeNull();
  },
};

export const ThinkingV3: StoryObj<typeof ChatThinkingIndicator> = {
  render: () => <ChatThinkingIndicator variant="v3" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Working...")).toBeInTheDocument();
  },
};

export const ThinkingAllVariants: StoryObj<typeof ChatThinkingIndicator> = {
  render: () => (
    <div className="space-y-4">
      {(["off", "v1", "v2", "v3"] as const).map((v) => (
        <div key={v}>
          <p className="text-xs text-text-muted font-mono mb-1">{v}</p>
          <ChatThinkingIndicator variant={v} />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Thinking")).toBeInTheDocument();
    await expect(canvas.getByText("Thinking...")).toBeInTheDocument();
    await expect(canvas.getByText("Working...")).toBeInTheDocument();
  },
};
