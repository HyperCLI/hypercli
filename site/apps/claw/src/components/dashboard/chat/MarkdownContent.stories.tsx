import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MarkdownContent } from "./MarkdownContent";

const meta: Meta<typeof MarkdownContent> = {
  title: "Chat/MarkdownContent",
  component: MarkdownContent,
  decorators: [
    (Story) => (
      <div className="max-w-lg p-4 bg-[#0d0d0f] rounded-2xl border border-[#2a2a2c] text-sm text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof MarkdownContent>;

export const PlainText: Story = {
  args: {
    content: "This is a simple plain text message from the assistant.",
  },
};

export const RichMarkdown: Story = {
  args: {
    content: `# Deployment Guide

Here's how to deploy your agent:

## Prerequisites

You'll need the following:

- **Node.js 20+** installed
- Access to the *HyperClaw dashboard*
- A valid API key

## Steps

1. Configure your agent settings
2. Push to staging
3. Verify the deployment

> **Note:** Always test in staging before promoting to production.

For more info, visit [HyperCLI docs](https://docs.hypercli.com).

---

That's all you need to get started!`,
  },
};

export const CodeBlocks: Story = {
  args: {
    content: `Here's a sample configuration:

\`\`\`json
{
  "name": "my-agent",
  "runtime": "node-20",
  "memory": "4Gi",
  "cpu": "2000m"
}
\`\`\`

And the deployment command:

\`\`\`bash
hyper deploy --env production --config ./openclaw.json
\`\`\``,
  },
};

export const InlineCode: Story = {
  args: {
    content: "Use the \`clawFetch()\` function to make authenticated API calls. The token is stored in \`localStorage\` under the key \`claw_auth_token\`.",
  },
};
