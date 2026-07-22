import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("renders interrupted assistant replies with a stopped badge", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "Partial answer before the stop request.",
          status: "interrupted",
        }}
      />,
    );

    expect(screen.getByText("Partial answer before the stop request.")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /reply stopped/i })).toHaveTextContent("Stopped");
  });

  it("renders reply stopped system notices without error styling", () => {
    render(<ChatMessageBubble message={{ role: "system", content: "Reply stopped" }} />);

    const notice = screen.getByText("Reply stopped");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveClass("text-text-muted");
    expect(notice).not.toHaveClass("text-[#d05f5f]");
  });

  it("uses semantic destructive colors for system errors", () => {
    render(<ChatMessageBubble message={{ role: "system", content: "Connection failed" }} />);

    expect(screen.getByText("Connection failed")).toHaveClass(
      "border-destructive/20",
      "bg-destructive/10",
      "text-destructive",
    );
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
    expect(screen.getByText("Internal reasoning hidden").parentElement).toHaveClass("text-text-muted");
    expectNoLeakSentinels(container.textContent ?? "");
    expectNoLeakSentinels(container.innerHTML);
  });

  it("does not show the file preview raw switch for normal chat markdown", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: [
            "# Chat preview",
            "",
            "```tsx",
            "const value = 1;",
            "```",
          ].join("\n"),
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Chat preview" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Raw" })).not.toBeInTheDocument();
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

  it("uses the page file reader when hydrating image file previews", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:chat-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const readFileBytes = vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    const file = {
      name: "bosquejo.png",
      path: "/home/node/.openclaw/workspace/bosquejo.png",
      type: "image/png",
    };

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "user",
          content: "Describe this image.",
          files: [file],
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(await screen.findByAltText("bosquejo.png")).toBeInTheDocument();
    expect(readFileBytes).toHaveBeenCalledWith(file.path);
    expect(createAgentClient).not.toHaveBeenCalled();
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

  it("renders file actions for live inline image attachments without duplicating previews", () => {
    vi.mocked(getStoredToken).mockReturnValue("token");
    const file = {
      name: "bosquejo.png",
      path: "/home/node/.openclaw/workspace/bosquejo.png",
      type: "image/png",
    };
    const onOpenFileFromChat = vi.fn();
    const onDownloadFileFromChat = vi.fn();

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
          files: [file],
        }}
        onOpenFileFromChat={onOpenFileFromChat}
        onDownloadFileFromChat={onDownloadFileFromChat}
      />,
    );

    expect(screen.getByAltText("bosquejo.png")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /image unavailable/i })).not.toBeInTheDocument();
    expect(createAgentClient).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /open bosquejo\.png in files/i }));
    fireEvent.click(screen.getByRole("button", { name: /download bosquejo\.png/i }));

    expect(onOpenFileFromChat).toHaveBeenCalledWith(file.path);
    expect(onDownloadFileFromChat).toHaveBeenCalledWith(file);
  });

  it("does not render raw local media handles when a workspace image preview exists", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:chat-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const readFileBytes = vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71]));

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
          mediaUrls: ["media://inbound/bosquejo---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png"],
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(await screen.findByAltText("bosquejo.png")).toBeInTheDocument();
    expect(screen.queryByText(/^media$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/media:\/\/inbound/i)).not.toBeInTheDocument();
  });

  it("renders an unavailable media component instead of raw local media alt text", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "![MEDIA](media://inbound/generated---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png)",
        }}
      />,
    );

    expect(screen.getByRole("status", { name: /media preview unavailable/i })).toBeInTheDocument();
    expect(screen.queryByText(/^media$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view media/i })).not.toBeInTheDocument();
  });

  it("renders an unavailable media component for unresolvable local media urls", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "",
          mediaUrls: ["media://inbound/generated---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png"],
        }}
      />,
    );

    expect(screen.getByRole("status", { name: /media preview unavailable/i })).toBeInTheDocument();
    expect(screen.queryByText(/^media$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/media:\/\/inbound/i)).not.toBeInTheDocument();
  });

  it("renders local ICS media handles as calendar file chips instead of unavailable previews", () => {
    const onOpenFileFromChat = vi.fn();
    const calendarFile = {
      name: "placeholder-calendar.ics",
      path: "/home/node/.openclaw/workspace/placeholder-calendar.ics",
      type: "text/calendar",
    };

    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "",
          files: [calendarFile],
          mediaUrls: ["media://inbound/placeholder-calendar---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.ics"],
        }}
        onOpenFileFromChat={onOpenFileFromChat}
      />,
    );

    expect(screen.getByText("placeholder-calendar.ics")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /media preview unavailable/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/media:\/\/inbound/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open placeholder-calendar\.ics in files/i }));
    expect(onOpenFileFromChat).toHaveBeenCalledWith(calendarFile.path);
  });

  it("renders completed write-tool calendar outputs as file chips before file refresh catches up", () => {
    const onOpenFileFromChat = vi.fn();

    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "",
          toolCalls: [
            {
              name: "write_file",
              args: JSON.stringify({ path: "/home/node/.openclaw/workspace/demo-event.ics" }),
              result: "path provided",
            },
          ],
          mediaUrls: ["media://inbound/demo-event---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.ics"],
        }}
        onOpenFileFromChat={onOpenFileFromChat}
      />,
    );

    expect(screen.getByText("demo-event.ics")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /media preview unavailable/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/media:\/\/inbound/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open demo-event\.ics in files/i }));
    expect(onOpenFileFromChat).toHaveBeenCalledWith("/home/node/.openclaw/workspace/demo-event.ics");
  });

  it("renders workspace ICS MEDIA paths as file chips without unavailable preview labels", () => {
    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "Created fake VCALENDAR content.\nMEDIA:/home/node/.openclaw/workspace/placeholder-calendar.ics",
        }}
      />,
    );

    expect(screen.getByText("placeholder-calendar.ics")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /media preview unavailable/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/MEDIA:\/home\/node\/\.openclaw\/workspace\/placeholder-calendar\.ics/i)).not.toBeInTheDocument();
  });

  it("renders assistant MEDIA workspace paths as downloadable generated media without leaking the runtime path", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:generated-media"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const readFileBytes = vi.fn().mockResolvedValue(new Uint8Array([255, 216, 255]));
    const onDownloadFileFromChat = vi.fn();
    const onOpenFileFromChat = vi.fn();

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "Generated image:\nMEDIA:/home/node/.openclaw/workspace/865621.jpg",
        }}
        onReadFileBytesFromChat={readFileBytes}
        onOpenFileFromChat={onOpenFileFromChat}
        onDownloadFileFromChat={onDownloadFileFromChat}
      />,
    );

    expect(await screen.findByAltText("865621.jpg")).toBeInTheDocument();
    expect(readFileBytes).toHaveBeenCalledWith(".openclaw/workspace/865621.jpg");
    expect(screen.queryByText(/MEDIA:\/home\/node\/\.openclaw\/workspace\/865621\.jpg/i)).not.toBeInTheDocument();
    const mediaLabel = screen.getByText("865621.jpg");
    fireEvent.focus(mediaLabel);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("MEDIA:/home/865621.jpg");

    fireEvent.click(screen.getByRole("button", { name: /open 865621\.jpg in files/i }));
    expect(onOpenFileFromChat).toHaveBeenCalledWith(".openclaw/workspace/865621.jpg");

    fireEvent.click(screen.getByRole("button", { name: /download 865621\.jpg/i }));
    expect(onDownloadFileFromChat).toHaveBeenCalledWith({
      name: "865621.jpg",
      path: ".openclaw/workspace/865621.jpg",
      type: "image/jpeg",
    });
  });

  it("renders MEDIA workspace urls as generated media without showing MEDIA text", () => {
    const readFileBytes = vi.fn(() => new Promise<Uint8Array>(() => {}));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "",
          mediaUrls: ["MEDIA:/home/node/.openclaw/workspace/865621.jpg"],
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getByRole("status", { name: /loading image/i })).toBeInTheDocument();
    expect(readFileBytes).toHaveBeenCalledWith(".openclaw/workspace/865621.jpg");
    expect(screen.queryByText(/^media:?$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MEDIA:\/home\/node\/\.openclaw\/workspace\/865621\.jpg/i)).not.toBeInTheDocument();
  });

  it("renders assistant MEDIA audio paths with the chat audio player", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:generated-audio"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const readFileBytes = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "Generated audio:\nMEDIA:/home/node/.openclaw/workspace/voice-clip.mp3",
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getByRole("button", { name: /play voice-clip\.mp3/i })).toBeInTheDocument();
    expect(screen.queryByText("Generated audio:")).not.toBeInTheDocument();
    expect(screen.queryByText(/MEDIA:\/home\/node\/\.openclaw\/workspace\/voice-clip\.mp3/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(readFileBytes).toHaveBeenCalledWith(".openclaw/workspace/voice-clip.mp3");
    });
  });

  it("retries generated media reads before showing a failed preview", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:retried-audio"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const readFileBytes = vi.fn()
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "MEDIA:/home/node/.openclaw/workspace/fresh-clip.m4a",
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getByRole("button", { name: /play fresh-clip\.m4a/i })).toBeInTheDocument();
    expect(readFileBytes).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(readFileBytes).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(/audio unavailable/i)).not.toBeInTheDocument();
  });

  it("renders assistant MEDIA video paths with a native video preview", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:generated-video"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const readFileBytes = vi.fn().mockResolvedValue(new Uint8Array([0, 0, 0, 24]));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "Generated clip:\nMEDIA:/home/node/.openclaw/workspace/generated-demo-clip.mp4",
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(await screen.findByLabelText(/video preview generated-demo-clip\.mp4/i)).toHaveAttribute("src", "blob:generated-video");
    expect(screen.queryByText(/MEDIA:\/home\/node\/\.openclaw\/workspace\/generated-demo-clip\.mp4/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(readFileBytes).toHaveBeenCalledWith(".openclaw/workspace/generated-demo-clip.mp4");
    });
  });

  it("suppresses assistant audio reply carrier text when an inline audio player is shown", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:inline-audio-reply"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const readFileBytes = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        inlineAudioFile={{
          agentId: "agent-123",
          path: "/home/node/.openclaw/workspace/reply-summary.mp3",
        }}
        message={{
          role: "assistant",
          content: "Audio reply saved at /home/node/.openclaw/workspace/reply-summary.mp3",
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getByRole("button", { name: /play reply-summary\.mp3/i })).toBeInTheDocument();
    expect(screen.queryByText(/audio reply/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(readFileBytes).toHaveBeenCalledWith("/home/node/.openclaw/workspace/reply-summary.mp3");
    });
  });

  it("does not duplicate audio players when an inline audio reply is also a MEDIA reference", () => {
    const readFileBytes = vi.fn(() => new Promise<Uint8Array>(() => {}));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        inlineAudioFile={{
          agentId: "agent-123",
          path: "/home/node/.openclaw/workspace/reply-summary.mp3",
        }}
        message={{
          role: "assistant",
          content: "Audio reply:\nMEDIA:/home/node/.openclaw/workspace/reply-summary.mp3",
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getAllByRole("button", { name: /play reply-summary\.mp3/i })).toHaveLength(1);
    expect(screen.queryByText(/audio reply/i)).not.toBeInTheDocument();
  });

  it("renders direct audio media urls with playback and download controls", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "Audio reply",
          mediaUrls: ["https://cdn.example.test/output/final.wav"],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /play final\.wav/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download final\.wav/i })).toHaveAttribute("href", "https://cdn.example.test/output/final.wav");
    expect(screen.queryByText("https://cdn.example.test/output/final.wav")).not.toBeInTheDocument();
    expect(screen.queryByText(/audio reply/i)).not.toBeInTheDocument();
  });

  it("renders base64 audio media urls without showing carrier text", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "Audio reply",
          mediaUrls: ["data:audio/mpeg;base64,AAAA"],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /play audio/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download audio/i })).toHaveAttribute("href", "data:audio/mpeg;base64,AAAA");
    expect(screen.queryByText(/audio reply/i)).not.toBeInTheDocument();
  });

  it("renders workspace audio file attachments with the chat audio player", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:voice-attachment"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const readFileBytes = vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6]));
    const file = {
      name: "voice-message.webm",
      path: "/home/node/.openclaw/workspace/voice-message.webm",
      type: "audio/webm",
    };

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "user",
          content: "Voice note",
          files: [file],
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getByRole("button", { name: /play voice-message\.webm/i })).toBeInTheDocument();
    expect(screen.queryByText("voice-message.webm")).toBeInTheDocument();
    await waitFor(() => {
      expect(readFileBytes).toHaveBeenCalledWith(file.path);
    });
  });

  it("hides voice-note transcription instructions when the sent audio file is attached", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:sent-voice-note"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const readFileBytes = vi.fn().mockResolvedValue(new Uint8Array([7, 8, 9]));
    const file = {
      name: "voice-1779810078334.webm",
      path: "/home/node/.openclaw/workspace/voice-1779810078334.webm",
      type: "audio/webm",
    };

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "user",
          content: "I recorded a voice message. Run this command to transcribe it:\n`hyper voice transcribe /home/node/.openclaw/workspace/voice-1779810078334.webm`",
          files: [file],
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getByRole("button", { name: /play voice-1779810078334\.webm/i })).toBeInTheDocument();
    expect(screen.queryByText(/I recorded a voice message/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/hyper voice transcribe/i)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(readFileBytes).toHaveBeenCalledWith(file.path);
    });
  });

  it("does not render duplicate inline audio when the voice file is already attached", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:sent-voice-note"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    const readFileBytes = vi.fn().mockResolvedValue(new Uint8Array([7, 8, 9]));
    const file = {
      name: "voice-1779810078334.webm",
      path: "/home/node/.openclaw/workspace/voice-1779810078334.webm",
      type: "audio/webm",
    };

    render(
      <ChatMessageBubble
        agentId="agent-123"
        inlineAudioFile={{ agentId: "agent-123", path: file.path }}
        message={{
          role: "user",
          content: "I recorded a voice message. Run this command to transcribe it:\n`hyper voice transcribe /home/node/.openclaw/workspace/voice-1779810078334.webm`",
          files: [file],
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getAllByRole("button", { name: /play voice-1779810078334\.webm/i })).toHaveLength(1);
    await waitFor(() => {
      expect(readFileBytes).toHaveBeenCalledTimes(1);
    });
  });

  it("uses generated media urls while content still has a pending MEDIA sentinel", () => {
    const readFileBytes = vi.fn(() => new Promise<Uint8Array>(() => {}));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "MEDIA:",
          mediaUrls: ["/home/node/.openclaw/workspace/865621.jpg"],
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.queryByRole("status", { name: /loading preview/i })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: /loading image/i })).toBeInTheDocument();
    expect(readFileBytes).toHaveBeenCalledWith(".openclaw/workspace/865621.jpg");
    expect(screen.queryByText(/^media:?$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MEDIA:\/home\/node\/\.openclaw\/workspace\/865621\.jpg/i)).not.toBeInTheDocument();
  });

  it("extracts inline MEDIA workspace paths before markdown rendering", () => {
    const readFileBytes = vi.fn(() => new Promise<Uint8Array>(() => {}));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "Generated: MEDIA:/home/node/.openclaw/workspace/865621.jpg",
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getByRole("status", { name: /loading image/i })).toBeInTheDocument();
    expect(screen.getByText("Generated:")).toBeInTheDocument();
    expect(screen.queryByText(/^media:?$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MEDIA:\/home\/node\/\.openclaw\/workspace\/865621\.jpg/i)).not.toBeInTheDocument();
  });

  it("extracts quoted inline MEDIA workspace paths before markdown rendering", () => {
    const readFileBytes = vi.fn(() => new Promise<Uint8Array>(() => {}));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "Generated: MEDIA:\"/home/node/.openclaw/workspace/865621.jpg\"",
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getByRole("status", { name: /loading image/i })).toBeInTheDocument();
    expect(screen.getByText("Generated:")).toBeInTheDocument();
    expect(screen.queryByText(/MEDIA:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/home\/node\/\.openclaw\/workspace\/865621\.jpg/i)).not.toBeInTheDocument();
  });

  it("suppresses incomplete MEDIA sentinel text while generated media is streaming", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "Working on it.\nMEDIA:",
        }}
        isStreaming
      />,
    );

    expect(screen.getByLabelText("streaming")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /loading preview/i })).toBeInTheDocument();
    expect(screen.queryByText(/^media:?$/i)).not.toBeInTheDocument();
  });

  it("does not leave an incomplete MEDIA sentinel stuck after streaming ends", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "MEDIA:",
        }}
      />,
    );

    expect(screen.queryByRole("status", { name: /loading preview/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^media:?$/i)).not.toBeInTheDocument();
  });

  it("does not show MEDIA text while generated media is loading", () => {
    const readFileBytes = vi.fn(() => new Promise<Uint8Array>(() => {}));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "Generated image:\nMEDIA:/home/node/.openclaw/workspace/865621.jpg",
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getByRole("status", { name: /loading image/i })).toBeInTheDocument();
    expect(screen.queryByText(/^media:?$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/MEDIA:\/home\/node\/\.openclaw\/workspace\/865621\.jpg/i)).not.toBeInTheDocument();
  });

  it("renders streamed markdown MEDIA images as generated media instead of alt text", () => {
    const readFileBytes = vi.fn(() => new Promise<Uint8Array>(() => {}));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "![MEDIA](/home/node/.openclaw/workspace/865621.jpg)",
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getByRole("status", { name: /loading image/i })).toBeInTheDocument();
    expect(readFileBytes).toHaveBeenCalledWith(".openclaw/workspace/865621.jpg");
    expect(screen.queryByText(/^media$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view media/i })).not.toBeInTheDocument();
  });

  it("suppresses incomplete markdown MEDIA image syntax while streaming", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "![MEDIA](",
        }}
        isStreaming
      />,
    );

    expect(screen.getByLabelText("streaming")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /loading preview/i })).toBeInTheDocument();
    expect(screen.queryByText(/MEDIA/i)).not.toBeInTheDocument();
  });

  it("renders home MEDIA paths as generated media instead of hiding them", async () => {
    const readFileBytes = vi.fn(() => new Promise<Uint8Array>(() => {}));

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "assistant",
          content: "MEDIA:/home/865621.jpg",
        }}
        onReadFileBytesFromChat={readFileBytes}
      />,
    );

    expect(screen.getByRole("status", { name: /loading image/i })).toBeInTheDocument();
    expect(readFileBytes).toHaveBeenCalledWith(".openclaw/workspace/865621.jpg");
    const mediaLabel = screen.getByText("865621.jpg");
    fireEvent.focus(mediaLabel);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("MEDIA:/home/865621.jpg");
    expect(screen.queryByText(/^media:?$/i)).not.toBeInTheDocument();
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

  it("offers open and download actions for workspace file chips", () => {
    const file = {
      name: "report.pdf",
      path: "/home/node/.openclaw/workspace/report.pdf",
      type: "application/pdf",
    };
    const onOpenFileFromChat = vi.fn();
    const onDownloadFileFromChat = vi.fn();

    render(
      <ChatMessageBubble
        message={{
          role: "user",
          content: "Use this report.",
          files: [file],
        }}
        onOpenFileFromChat={onOpenFileFromChat}
        onDownloadFileFromChat={onDownloadFileFromChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open report\.pdf in files/i }));
    fireEvent.click(screen.getByRole("button", { name: /download report\.pdf/i }));

    expect(onOpenFileFromChat).toHaveBeenCalledWith(file.path);
    expect(onDownloadFileFromChat).toHaveBeenCalledWith(file);
  });

  it("opens files mentioned in assistant markdown responses", () => {
    const onOpenFileFromChat = vi.fn();

    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "Updated `src/app.tsx` and /home/node/.openclaw/workspace/report.md.",
        }}
        onOpenFileFromChat={onOpenFileFromChat}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "src/app.tsx" }));
    fireEvent.click(screen.getByRole("link", { name: "/home/node/.openclaw/workspace/report.md" }));

    expect(onOpenFileFromChat).toHaveBeenCalledWith("src/app.tsx");
    expect(onOpenFileFromChat).toHaveBeenCalledWith(".openclaw/workspace/report.md");
  });

  it("renders file actions when history file metadata is missing a type", () => {
    const file = {
      name: "notes.txt",
      path: "/home/node/.openclaw/workspace/notes.txt",
    } as never;
    const onOpenFileFromChat = vi.fn();
    const onDownloadFileFromChat = vi.fn();

    render(
      <ChatMessageBubble
        message={{
          role: "user",
          content: "Use these notes.",
          files: [file],
        }}
        onOpenFileFromChat={onOpenFileFromChat}
        onDownloadFileFromChat={onDownloadFileFromChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open notes\.txt in files/i }));
    fireEvent.click(screen.getByRole("button", { name: /download notes\.txt/i }));

    expect(onOpenFileFromChat).toHaveBeenCalledWith("/home/node/.openclaw/workspace/notes.txt");
    expect(onDownloadFileFromChat).toHaveBeenCalledWith({
      name: "notes.txt",
      path: "/home/node/.openclaw/workspace/notes.txt",
      type: "",
    });
  });

  it("offers open and download actions in hydrated image previews", async () => {
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
    const file = {
      name: "bosquejo.png",
      path: "/home/node/.openclaw/workspace/bosquejo.png",
      type: "image/png",
    };
    const onOpenFileFromChat = vi.fn();
    const onDownloadFileFromChat = vi.fn().mockResolvedValue(undefined);

    render(
      <ChatMessageBubble
        agentId="agent-123"
        message={{
          role: "user",
          content: "Describe this image.",
          files: [file],
        }}
        onOpenFileFromChat={onOpenFileFromChat}
        onDownloadFileFromChat={onDownloadFileFromChat}
      />,
    );

    expect(await screen.findByAltText("bosquejo.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /view bosquejo\.png/i }));

    const dialog = await screen.findByRole("dialog", { name: /bosquejo\.png/i });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /open bosquejo\.png in files/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /download bosquejo\.png/i }));

    expect(onOpenFileFromChat).toHaveBeenCalledWith(file.path);
    await waitFor(() => {
      expect(onDownloadFileFromChat).toHaveBeenCalledWith(file);
    });
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

    fireEvent.click(screen.getByText("List Files"));

    expect(screen.getByLabelText("Directory workspace")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("guide.md")).toBeInTheDocument();
  });

  it("does not preview raw tool execution text in collapsed tool rows", () => {
    const rawResult = "PROOF ANCHORS - $82,500/month equivalent through Anthropic.";
    const rawArgs = "cat /home/node/.openclaw/workspace/proof.txt";

    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "",
          toolCalls: [
            {
              name: "exec",
              args: rawArgs,
              result: rawResult,
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Result ready")).toBeInTheDocument();
    expect(screen.queryByText(rawResult)).not.toBeInTheDocument();
    expect(screen.queryByText(rawArgs)).not.toBeInTheDocument();
  });

  it("counts empty results in stacked tool-call progress", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "",
          toolCalls: ["one", "two", "three", "four"].map((name) => ({
            id: name,
            name,
            args: "{}",
            result: "",
          })),
        }}
        isStreaming
      />,
    );

    const stackButton = screen.getByRole("button", { name: /4 tool calls/i });
    expect(stackButton).toHaveTextContent("Done");
    expect(screen.queryByText(/0\/4 done/)).not.toBeInTheDocument();
  });

  it("renders stacked tool calls with duplicate gateway ids without key warnings", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <ChatMessageBubble
          message={{
            role: "assistant",
            content: "",
            toolCalls: ["one", "two", "three", "four"].map((name) => ({
              id: "functions.web_fetch:5",
              name,
              args: "{}",
              result: "ok",
            })),
          }}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /4 tool calls/i }));

      expect(consoleError.mock.calls.some((call) => call.join(" ").includes("same key"))).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not expose file actions from hidden tool-call file paths", () => {
    render(
      <ChatMessageBubble
        message={{
          role: "assistant",
          content: "",
          toolCalls: [
            {
              name: "read",
              args: JSON.stringify({ path: "/home/node/.openclaw/workspace/private-report.pdf" }),
              result: "private report contents",
            },
          ],
        }}
        onOpenFileFromChat={vi.fn()}
        onDownloadFileFromChat={vi.fn()}
      />,
    );

    expect(screen.getByText("path provided")).toBeInTheDocument();
    expect(screen.queryByText(/private-report\.pdf/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/private report contents/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open private-report\.pdf in files/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download private-report\.pdf/i })).not.toBeInTheDocument();
  });
});
