import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AttachmentSection } from "./AttachmentSection";

const meta: Meta<typeof AttachmentSection> = {
  title: "Chat/AttachmentSection",
  component: AttachmentSection,
  decorators: [
    (Story) => (
      <div className="max-w-md p-4 bg-[#0d0d0f] rounded-2xl border border-[#2a2a2c] text-sm text-foreground">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AttachmentSection>;

export const FileAttachments: Story = {
  args: {
    files: [
      { name: "openclaw.json", path: "/workspace/openclaw.json", type: "application/json" },
      { name: "deployment-notes.md", path: "/workspace/deployment-notes.md", type: "text/markdown" },
      { name: "agent-config.yaml", path: "/workspace/agent-config.yaml", type: "application/yaml" },
    ],
  },
};

export const MediaUrls: Story = {
  args: {
    mediaUrls: [
      "https://via.placeholder.com/300x200/141416/38D39F?text=Chart+1",
      "https://via.placeholder.com/300x200/141416/f0c56c?text=Chart+2",
    ],
  },
};

export const NonImageLinks: Story = {
  args: {
    mediaUrls: [
      "https://example.com/report.pdf",
      "https://example.com/data.csv",
    ],
  },
};

export const Mixed: Story = {
  args: {
    files: [
      { name: "config.json", path: "/workspace/config.json", type: "application/json" },
    ],
    mediaUrls: [
      "https://via.placeholder.com/200x150/141416/38D39F?text=Preview",
      "https://example.com/logs.txt",
    ],
  },
};
