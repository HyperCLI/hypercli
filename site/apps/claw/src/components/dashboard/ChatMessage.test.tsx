import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getStoredToken } from "@/lib/api";
import { createAgentClient } from "@/lib/agent-client";
import { normalizeHistoryMessage } from "@/lib/openclaw-chat";
import { ChatMessageBubble } from "./ChatMessage";
import { parseDirectoryVisualization } from "./chat/DirectoryVisualization";

vi.mock("@/lib/api", () => ({
  getStoredToken: vi.fn(() => null),
}));

vi.mock("@/lib/agent-client", () => ({
  createAgentClient: vi.fn(() => ({
    fileReadBytes: vi.fn(),
  })),
}));

const THINKING_LEAK_SENTINEL = "DO_NOT_RENDER_THINKING_SENTINEL";
const TOOL_ARG_LEAK_SENTINEL = "DO_NOT_RENDER_TOOL_ARG_SENTINEL";
const TOOL_RESULT_LEAK_SENTINEL = "DO_NOT_RENDER_TOOL_RESULT_SENTINEL";
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function expectNoLeakSentinels(markup: string): void {
  expect(markup).not.toContain(THINKING_LEAK_SENTINEL);
  expect(markup).not.toContain(TOOL_ARG_LEAK_SENTINEL);
  expect(markup).not.toContain(TOOL_RESULT_LEAK_SENTINEL);
}

describe("ChatMessageBubble", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStoredToken).mockReturnValue(null);
    vi.mocked(createAgentClient).mockReturnValue({
      fileReadBytes: vi.fn(),
    } as ReturnType<typeof createAgentClient>);
    if (originalCreateObjectURL) {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    } else {
      Reflect.deleteProperty(URL, "createObjectURL");
    }
    if (originalRevokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
    } else {
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
    document.body.style.overflow = "";
  });

  it("renders hydrated history text without internal thinking or tool-call sentinels", () => {
    const message = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: `Internal planning: ${THINKING_LEAK_SENTINEL}`,
        },
        {
          type: "tool_call",
          name: "read",
          args: {
            path: "/workspace/app/page.tsx",
            marker: TOOL_ARG_LEAK_SENTINEL,
          },
        },
        {
          type: "tool_result",
          name: "read",
          text: `Internal tool result: ${TOOL_RESULT_LEAK_SENTINEL}`,
        },
        {
          type: "text",
          text: "Visible answer after internal work.",
        },
      ],
    });

    expect(message).not.toBeNull();
    const { container } = render(<ChatMessageBubble message={message!} />);

    expect(screen.getByText("Visible answer after internal work.")).toBeInTheDocument();
    expect(screen.queryByText("Internal reasoning hidden")).not.toBeInTheDocument();
    expectNoLeakSentinels(container.textContent ?? "");
    expectNoLeakSentinels(container.innerHTML);
  });

  it("renders a generic hidden-reasoning badge without exposing raw thinking text", () => {
    const { container } = render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "Visible answer.",
          thinking: `Raw inner reasoning: ${THINKING_LEAK_SENTINEL}`,
        }}
      />,
    );

    expect(screen.getByText("Visible answer.")).toBeInTheDocument();
    expect(screen.getByText("Internal reasoning hidden")).toBeInTheDocument();
    expectNoLeakSentinels(container.textContent ?? "");
    expectNoLeakSentinels(container.innerHTML);
  });

  it("caps long user messages at three quarters of the chat row", () => {
    const { container } = render(
      <ChatMessageBubble
        message={{
          role: "user",
          content: "This is a long prompt that should wrap before it takes over the entire response area.",
        }}
      />,
    );

    expect(container.innerHTML).toContain("max-w-[75%]");
  });

  it("renders a loading placeholder for hydrated image file previews", async () => {
    vi.mocked(getStoredToken).mockReturnValue("token");
    const fileReadBytes = vi.fn(() => new Promise<Uint8Array>(() => {}));
    vi.mocked(createAgentClient).mockReturnValue({
      fileReadBytes,
    } as ReturnType<typeof createAgentClient>);

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "user",
          content: "Describe this image.",
          files: [
            {
              name: "bosquejo.png",
              path: "/home/node/.openclaw/workspace/bosquejo.png",
              type: "image/png",
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("status", { name: /loading image/i })).toBeInTheDocument();
    expect(screen.queryByText("bosquejo.png")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(fileReadBytes).toHaveBeenCalledWith("agent-123", ".openclaw/workspace/bosquejo.png");
    });
  });

  it("does not render duplicate workspace image previews when an inline attachment is present", () => {
    vi.mocked(getStoredToken).mockReturnValue("token");

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "user",
          content: "Describe this image.",
          attachments: [
            {
              type: "image",
              mimeType: "image/png",
              content: "aW1hZ2U=",
              fileName: "bosquejo.png",
            },
          ],
          files: [
            {
              name: "bosquejo.png",
              path: "/home/node/.openclaw/workspace/bosquejo.png",
              type: "image/png",
            },
          ],
        }}
      />,
    );

    expect(screen.getByAltText("bosquejo.png")).toBeInTheDocument();
    expect(screen.getAllByRole("status", { name: /loading image/i })).toHaveLength(1);
    expect(screen.queryByRole("status", { name: /image unavailable/i })).not.toBeInTheDocument();
    expect(screen.queryByText("bosquejo.png")).not.toBeInTheDocument();
    expect(createAgentClient).not.toHaveBeenCalled();
  });

  it("opens hydrated image previews in an in-chat viewer", async () => {
    vi.mocked(getStoredToken).mockReturnValue("token");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:chat-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.mocked(createAgentClient).mockReturnValue({
      fileReadBytes: vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71])),
    } as ReturnType<typeof createAgentClient>);

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "user",
          content: "Describe this image.",
          files: [
            {
              name: "bosquejo.png",
              path: "/home/node/.openclaw/workspace/bosquejo.png",
              type: "image/png",
            },
          ],
        }}
      />,
    );

    expect(await screen.findByAltText("bosquejo.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view bosquejo\.png/i }));

    expect(await screen.findByRole("dialog", { name: /bosquejo\.png/i })).toBeInTheDocument();
  });

  it("normalizes structured directory listings for chat visualization", () => {
    const listing = parseDirectoryVisualization({
      path: "/workspace",
      directories: [{ name: "src", path: "/workspace/src", type: "directory" }],
      files: [
        { name: "README.md", path: "/workspace/README.md", type: "file", size: 128 },
        { name: "page.tsx", path: "/workspace/src/page.tsx", type: "file", size: 2048 },
      ],
    });

    expect(listing).toEqual({
      rootPath: "workspace",
      entries: [
        { name: "src", path: "workspace/src", type: "directory" },
        { name: "README.md", path: "workspace/README.md", type: "file", size: 128 },
        { name: "page.tsx", path: "workspace/src/page.tsx", type: "file", size: 2048 },
      ],
      truncated: false,
    });
  });

  it("renders assistant directory JSON as a compact directory tree", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: JSON.stringify({
            path: "/workspace",
            directories: [{ name: "src", path: "/workspace/src", type: "directory" }],
            files: [{ name: "README.md", path: "/workspace/README.md", type: "file", size: 128 }],
          }),
        }}
      />,
    );

    expect(screen.getByLabelText("Directory workspace")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("renders directory tool results inside an opened tool call", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "",
          toolCalls: [
            {
              name: "list_files",
              args: JSON.stringify({ path: "/workspace" }),
              result: JSON.stringify({
                path: "/workspace",
                directories: [{ name: "docs", path: "/workspace/docs", type: "directory" }],
                files: [{ name: "guide.md", path: "/workspace/docs/guide.md", type: "file", size: 512 }],
              }),
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByText("list_files"));

    expect(screen.getByLabelText("Directory workspace")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("guide.md")).toBeInTheDocument();
  });
});
