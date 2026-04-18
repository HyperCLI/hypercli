import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ChatMessageBubble } from "./ChatMessageBubble";

const meta: Meta<typeof ChatMessageBubble> = {
  title: "Chat/ChatMessageBubble",
  component: ChatMessageBubble,
  argTypes: {
    bubblesVariant: { control: "select", options: ["off", "v1", "v2", "v3"] },
    themeVariant: { control: "select", options: ["off", "v1", "v2", "v3"] },
    nameVariant: { control: "select", options: ["off", "v1", "v2", "v3"] },
    timestampVariant: { control: "select", options: ["off", "v1", "v2", "v3"] },
    animationVariant: { control: "select", options: ["off", "v1", "v2", "v3"] },
    streamingVariant: { control: "select", options: ["off", "v1", "v2", "v3"] },
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl mx-auto p-4 space-y-4 bg-[#0a0a0b] min-h-[200px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ChatMessageBubble>;

// ── Basic message types ──

export const UserMessage: Story = {
  args: {
    message: {
      role: "user",
      content: "Can you help me deploy my agent to production?",
      timestamp: Date.now() - 60_000,
    },
    bubblesVariant: "v2",
    themeVariant: "v2",
    timestampVariant: "v2",
  },
};

export const AssistantMessage: Story = {
  args: {
    message: {
      role: "assistant",
      content: "Sure! I'll guide you through the deployment process. First, make sure your agent configuration is correct, then we can start the deployment pipeline.\n\nHere are the steps:\n\n1. **Verify your config** — check `openclaw.json`\n2. **Push to staging** — test in the staging environment\n3. **Deploy to production** — once verified, promote to prod",
      timestamp: Date.now() - 30_000,
    },
    agentName: "Claude",
    bubblesVariant: "v2",
    themeVariant: "v2",
    nameVariant: "v2",
    timestampVariant: "v2",
  },
};

export const SystemMessage: Story = {
  args: {
    message: {
      role: "system",
      content: "Agent connection lost. Attempting to reconnect...",
      timestamp: Date.now(),
    },
  },
};

// ── Rich content ──

export const AssistantWithToolCalls: Story = {
  args: {
    message: {
      role: "assistant",
      content: "I've read the configuration file and updated the deployment settings.",
      toolCalls: [
        {
          id: "tc-1",
          name: "file_read",
          args: '{"file_path": "/config/openclaw.json"}',
          result: '{"ok": true}',
        },
        {
          id: "tc-2",
          name: "deploy_update",
          args: '{"env": "staging", "version": "2.1.0"}',
        },
      ],
      timestamp: Date.now() - 15_000,
    },
    agentName: "Claude",
    bubblesVariant: "v2",
    themeVariant: "v2",
    nameVariant: "v2",
    timestampVariant: "v2",
  },
};

export const AssistantWithThinking: Story = {
  args: {
    message: {
      role: "assistant",
      content: "Based on my analysis, the optimal configuration would use 2 CPU cores and 4GB of memory.",
      thinking: "Let me analyze the resource requirements...\nThe agent processes approximately 100 requests per minute.\nEach request uses about 50MB of memory peak.\nWith connection pooling, we need roughly 2 cores for optimal throughput.",
      timestamp: Date.now() - 45_000,
    },
    agentName: "Claude",
    bubblesVariant: "v2",
    themeVariant: "v2",
    nameVariant: "v2",
  },
};

export const LongCodeBlock: Story = {
  args: {
    message: {
      role: "assistant",
      content: 'Here\'s the updated configuration:\n\n```json\n{\n  "name": "my-agent",\n  "runtime": "node-20",\n  "memory": "4Gi",\n  "cpu": "2000m",\n  "env": {\n    "NODE_ENV": "production",\n    "LOG_LEVEL": "info"\n  }\n}\n```\n\nMake sure to update the `memory` field based on your workload.',
      timestamp: Date.now() - 20_000,
    },
    agentName: "Claude",
    bubblesVariant: "v2",
    themeVariant: "v2",
    nameVariant: "v2",
  },
};

export const AssistantWithMediaUrls: Story = {
  args: {
    message: {
      role: "assistant",
      content: "Here's the architecture diagram I generated:",
      mediaUrls: [
        "https://via.placeholder.com/400x300/141416/38D39F?text=Architecture+Diagram",
      ],
      timestamp: Date.now() - 10_000,
    },
    agentName: "Claude",
    bubblesVariant: "v2",
    themeVariant: "v2",
    nameVariant: "v2",
  },
};

// ── Streaming ──

export const StreamingMessage: Story = {
  args: {
    message: {
      role: "assistant",
      content: "I'm currently analyzing your deployment configuration and checking for any potential issues...",
      timestamp: Date.now(),
    },
    isStreaming: true,
    agentName: "Claude",
    bubblesVariant: "v2",
    themeVariant: "v2",
    nameVariant: "v2",
    streamingVariant: "v2",
  },
};

// ── Variant presets ──

const presetMessage = {
  role: "assistant" as const,
  content: "This is how the **Alt preset** looks with all variants applied.\n\nIt includes:\n- Bubble shape and colors\n- Name display\n- Timestamp rendering\n- Entrance animation\n- Streaming indicator style",
  toolCalls: [
    { id: "tc-demo", name: "config_read", args: '{"path": "/etc/agent.json"}', result: '{"ok": true}' },
  ],
  timestamp: Date.now() - 120_000,
};

export const AllVariantsV1: Story = {
  args: {
    message: presetMessage,
    agentName: "Agent Alpha",
    bubblesVariant: "v1",
    themeVariant: "v1",
    nameVariant: "v1",
    timestampVariant: "v1",
    animationVariant: "v1",
    streamingVariant: "v1",
  },
};

export const AllVariantsV2: Story = {
  args: {
    message: presetMessage,
    agentName: "Agent Beta",
    bubblesVariant: "v2",
    themeVariant: "v2",
    nameVariant: "v2",
    timestampVariant: "v2",
    animationVariant: "v2",
    streamingVariant: "v2",
  },
};

export const AllVariantsV3: Story = {
  args: {
    message: presetMessage,
    agentName: "Agent Gamma",
    bubblesVariant: "v3",
    themeVariant: "v3",
    nameVariant: "v3",
    timestampVariant: "v3",
    animationVariant: "v3",
    streamingVariant: "v3",
  },
};
