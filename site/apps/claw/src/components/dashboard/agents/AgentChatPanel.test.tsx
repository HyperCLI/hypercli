import { createRef, type ComponentProps } from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSdkAgent } from "@/test/factories";
import { renderWithClient } from "@/test/utils";
import { toAgentViewModel } from "./agentViewModel";
import { AgentChatPanel } from "./AgentChatPanel";

const chatMessageBubbleMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/dashboard/ChatMessage", () => ({
  ChatMessageBubble: (props: unknown) => {
    chatMessageBubbleMock(props);
    return null;
  },
  ChatThinkingIndicator: () => null,
}));

type AgentChatPanelProps = ComponentProps<typeof AgentChatPanel>;
type ChatSession = AgentChatPanelProps["chat"];

function buildChat(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    gateway: null,
    status: "disconnected",
    error: null,
    ready: false,
    gatewayConnected: false,
    connected: false,
    connecting: false,
    hydrating: false,
    messages: [],
    sendMessage: vi.fn(async () => undefined),
    input: "",
    setInput: vi.fn(),
    pendingInput: [],
    addPendingMessage: vi.fn(),
    sending: false,
    files: [],
    config: null,
    configSchema: null,
    openFile: vi.fn(async () => ""),
    saveFile: vi.fn(async () => undefined),
    saveConfig: vi.fn(async () => undefined),
    saveFullConfig: vi.fn(async () => undefined),
    channelsStatus: vi.fn(async () => ({ channels: {} })),
    pendingFiles: [],
    pendingAttachments: [],
    pendingAttachmentReads: 0,
    addPendingFiles: vi.fn(),
    addAttachments: vi.fn(),
    removePendingFile: vi.fn(),
    removeAttachment: vi.fn(),
    sessions: [],
    cronJobs: [],
    models: [],
    activityFeed: [],
    refreshSessions: vi.fn(async () => undefined),
    createSession: vi.fn(async () => "session-test"),
    refreshCron: vi.fn(async () => undefined),
    addCron: vi.fn(async () => undefined),
    removeCron: vi.fn(async () => undefined),
    runCron: vi.fn(async () => undefined),
    retry: vi.fn(),
    ...overrides,
  } as ChatSession;
}

function buildAgent(state: NonNullable<AgentChatPanelProps["selectedAgent"]>["state"] = "RUNNING") {
  return toAgentViewModel(buildSdkAgent({ state }));
}

function buildAgentChatPanelProps(overrides: Partial<AgentChatPanelProps> = {}): AgentChatPanelProps {
  const selectedAgent = overrides.selectedAgent ?? buildAgent();
  return {
    chat: buildChat(),
    selectedAgent,
    isSelectedRunning: selectedAgent.state === "RUNNING",
    chatDragActive: false,
    setChatDragActive: vi.fn(),
    chatDragDepthRef: { current: 0 },
    handleChatFileDrop: vi.fn(),
    chatScrollRef: createRef<HTMLDivElement>(),
    handleChatScroll: vi.fn(),
    chatEndRef: createRef<HTMLDivElement>(),
    recording: false,
    audioLevel: 0,
    recordingDuration: 0,
    stopRecording: vi.fn(),
    audioUrl: null,
    audioPreviewPlaying: false,
    audioPreviewDuration: 0,
    toggleAudioPreviewPlayback: vi.fn(),
    discardAudio: vi.fn(),
    sendAudio: vi.fn(),
    sendingAudio: false,
    startRecording: vi.fn(),
    handleSendChat: vi.fn(),
    formatDuration: (seconds) => `${seconds}s`,
    ...overrides,
  };
}

function renderAgentChatPanel(overrides: Partial<AgentChatPanelProps> = {}) {
  const props = buildAgentChatPanelProps(overrides);
  return renderWithClient(<AgentChatPanel {...props} />);
}

describe("AgentChatPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
    chatMessageBubbleMock.mockClear();
  });

  it("keeps the composer out of the provisioning stage", () => {
    const selectedAgent = buildAgent("PENDING");
    renderAgentChatPanel({
      selectedAgent,
      isSelectedRunning: false,
    });

    expect(screen.getByText("Provisioning runtime")).toBeInTheDocument();
    expect(screen.getByText("Reserving compute and preparing the workspace.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("passes workspace file actions to rendered chat messages", () => {
    const selectedAgent = buildAgent();
    const onReadFileBytesFromChat = vi.fn();
    const onOpenFileFromChat = vi.fn();
    const onDownloadFileFromChat = vi.fn();

    renderAgentChatPanel({
      selectedAgent,
      isSelectedRunning: true,
      chat: buildChat({
        ready: true,
        gatewayConnected: true,
        connected: true,
        messages: [
          {
            role: "user",
            content: "See attached.",
            files: [
              {
                name: "report.pdf",
                path: "/home/node/.openclaw/workspace/report.pdf",
                type: "application/pdf",
              },
            ],
          },
        ],
      }),
      onReadFileBytesFromChat,
      onOpenFileFromChat,
      onDownloadFileFromChat,
    });

    const bubbleProps = chatMessageBubbleMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(bubbleProps).toEqual(expect.objectContaining({
      agentId: selectedAgent.id,
      onReadFileBytesFromChat,
      onOpenFileFromChat,
      onDownloadFileFromChat,
    }));
  });

  it("passes assistant audio reply files to chat message bubbles", () => {
    const selectedAgent = buildAgent();

    renderAgentChatPanel({
      selectedAgent,
      isSelectedRunning: true,
      chat: buildChat({
        ready: true,
        gatewayConnected: true,
        connected: true,
        messages: [
          {
            role: "assistant",
            content: "Audio reply saved at /home/node/.openclaw/workspace/reply-summary.mp3",
          },
        ],
      }),
    });

    const bubbleProps = chatMessageBubbleMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(bubbleProps).toEqual(expect.objectContaining({
      inlineAudioFile: {
        agentId: selectedAgent.id,
        path: "/home/node/.openclaw/workspace/reply-summary.mp3",
      },
    }));
  });

  it("does not pass duplicate inline audio for sent voice messages with attached files", () => {
    const selectedAgent = buildAgent();
    const voicePath = "/home/node/.openclaw/workspace/voice-1779810078334.webm";

    renderAgentChatPanel({
      selectedAgent,
      isSelectedRunning: true,
      chat: buildChat({
        ready: true,
        gatewayConnected: true,
        connected: true,
        messages: [
          {
            role: "user",
            content: `I recorded a voice message. Run this command to transcribe it:\n\`hyper voice transcribe ${voicePath}\``,
            files: [
              {
                name: "voice-1779810078334.webm",
                path: voicePath,
                type: "audio/webm",
              },
            ],
          },
        ],
      }),
    });

    const bubbleProps = chatMessageBubbleMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(bubbleProps).toEqual(expect.objectContaining({
      inlineAudioFile: null,
    }));
  });

  it("shows workspace hydration once the gateway transport is connected", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        connecting: true,
        hydrating: true,
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByText("Loading workspace")).toBeInTheDocument();
    expect(screen.getByText("Fetching messages, files, and config.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders the composer after chat is ready", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("textbox", { name: /message agent/i })).toBeInTheDocument();
    expect(screen.queryByText("Connecting gateway")).not.toBeInTheDocument();
  });

  it("shows slash command options when the draft starts with slash", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/",
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("listbox", { name: /slash command menu/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /\/summary/i })).toBeInTheDocument();
  });

  it("scrolls the selected slash command into view while navigating", async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      renderAgentChatPanel({
        chat: buildChat({
          status: "connected",
          gatewayConnected: true,
          ready: true,
          connected: true,
          input: "/",
        }),
        isSelectedRunning: true,
      });

      const initialCalls = scrollIntoView.mock.calls.length;

      await act(async () => {
        fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "ArrowDown" });
      });

      expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
      expect(scrollIntoView.mock.calls.length).toBeGreaterThan(initialCalls);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("supports slash command keyboard completion and jumps", async () => {
    const setInput = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/",
        setInput,
      }),
      isSelectedRunning: true,
    });

    const textbox = screen.getByRole("textbox", { name: /message agent/i });
    await act(async () => {
      fireEvent.keyDown(textbox, { key: "End" });
    });
    expect(screen.getAllByRole("option").at(-1)).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      fireEvent.keyDown(textbox, { key: "Home" });
    });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      fireEvent.keyDown(textbox, { key: "PageDown" });
    });
    expect(screen.getAllByRole("option")[5]).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      fireEvent.keyDown(textbox, { key: "Tab" });
    });
    expect(setInput).toHaveBeenCalledWith("/clear ");
  });

  it("sends a prompt slash command instead of forwarding slash text", async () => {
    const setInput = vi.fn();
    const sendMessage = vi.fn(async () => undefined);
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/summary",
        setInput,
        sendMessage,
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(setInput).toHaveBeenCalledWith("");
    expect(sendMessage).toHaveBeenCalledWith("Summarize this project so far with decisions, open tasks, and next actions.");
  });

  it("runs a UI slash command through the provided page callback", async () => {
    const setInput = vi.fn();
    const onOpenFiles = vi.fn();
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/files",
        setInput,
      }),
      isSelectedRunning: true,
      handleSendChat,
      slashCommandActions: { onOpenFiles },
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(onOpenFiles).toHaveBeenCalledTimes(1);
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /files opened/i })).toBeInTheDocument();
  });

  it("starts a new project through the slash command callback", async () => {
    const setInput = vi.fn();
    const onNewConversation = vi.fn(async () => undefined);
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/new",
        setInput,
      }),
      isSelectedRunning: true,
      handleSendChat,
      slashCommandActions: { onNewConversation },
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(onNewConversation).toHaveBeenCalledTimes(1);
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /new project opened/i })).toBeInTheDocument();
  });

  it("passes a path through the open file slash command", async () => {
    const setInput = vi.fn();
    const onOpenFiles = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/open src/app.tsx",
        setInput,
      }),
      isSelectedRunning: true,
      slashCommandActions: { onOpenFiles },
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(onOpenFiles).toHaveBeenCalledWith("src/app.tsx");
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /opening src\/app\.tsx/i })).toBeInTheDocument();
  });

  it("uses the app confirmation dialog for mutating slash commands", async () => {
    const setInput = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/clear",
        setInput,
      }),
      isSelectedRunning: true,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(screen.getByRole("heading", { name: "Clear draft" })).toBeInTheDocument();
    expect(screen.getByText("Clear the current draft? Persisted chat history will not be deleted.")).toBeInTheDocument();
    expect(setInput).not.toHaveBeenCalledWith("");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    });

    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /draft cleared/i })).toBeInTheDocument();
  });

  it("creates a workspace folder through a confirmed slash command", async () => {
    const setInput = vi.fn();
    const onCreateDirectory = vi.fn(async () => undefined);
    const onOpenFiles = vi.fn();
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/mkdir reports",
        setInput,
      }),
      isSelectedRunning: true,
      handleSendChat,
      slashCommandActions: { onCreateDirectory, onOpenFiles },
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Create folder" })).toBeInTheDocument();
    expect(screen.getByText('Create folder "reports" in the workspace root?')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    });

    expect(onCreateDirectory).toHaveBeenCalledWith("reports");
    expect(onOpenFiles).toHaveBeenCalledTimes(1);
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /folder "reports" created/i })).toBeInTheDocument();
  });

  it("rejects nested folder names in the folder slash command", async () => {
    const onCreateDirectory = vi.fn(async () => undefined);
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/mkdir reports/2026",
      }),
      isSelectedRunning: true,
      slashCommandActions: { onCreateDirectory },
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(screen.getAllByText("Create one folder at a time.").length).toBeGreaterThan(0);
    expect(onCreateDirectory).not.toHaveBeenCalled();
  });

  it("shows a reason when a slash command is unavailable", async () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/",
      }),
      isSelectedRunning: true,
    });

    const startCommand = screen.getByRole("option", { name: /\/start/i });
    expect(startCommand).toHaveAttribute("aria-disabled", "true");
    expect(startCommand).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(startCommand);
    });

    expect(screen.getAllByText("Agent is already running.")).toHaveLength(2);
  });

  it("opens scheduled work from the slash command menu", async () => {
    const setInput = vi.fn();
    const onOpenScheduled = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/",
        setInput,
      }),
      isSelectedRunning: true,
      slashCommandActions: { onOpenScheduled },
    });

    const command = screen.getByRole("option", { name: /\/schedule/i });
    expect(command).not.toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(command);
    });

    expect(onOpenScheduled).toHaveBeenCalledTimes(1);
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /scheduled opened/i })).toBeInTheDocument();
  });

  it("passes schedule slash command text into the scheduled draft", async () => {
    const setInput = vi.fn();
    const onOpenScheduled = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/schedule Every weekday at 9am, send a standup digest",
        setInput,
      }),
      isSelectedRunning: true,
      slashCommandActions: { onOpenScheduled },
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(onOpenScheduled).toHaveBeenCalledWith("Every weekday at 9am, send a standup digest");
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /scheduled draft opened/i })).toBeInTheDocument();
  });

  it("runs and removes scheduled jobs from slash commands", async () => {
    const setInput = vi.fn();
    const runCron = vi.fn(async () => undefined);
    const removeCron = vi.fn(async () => undefined);
    const refreshCron = vi.fn(async () => undefined);

    const runChat = buildChat({
      status: "connected",
      gatewayConnected: true,
      ready: true,
      connected: true,
      input: "/run job-1",
      setInput,
      runCron,
      refreshCron,
    });
    const { rerender } = renderAgentChatPanel({ chat: runChat, isSelectedRunning: true });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });
    expect(screen.getByRole("heading", { name: "Run scheduled job" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run" }));
    });

    expect(runCron).toHaveBeenCalledWith("job-1");
    expect(refreshCron).toHaveBeenCalledTimes(1);
    expect(setInput).toHaveBeenCalledWith("");

    const removeChat = buildChat({
      status: "connected",
      gatewayConnected: true,
      ready: true,
      connected: true,
      input: "/unschedule job-1",
      setInput,
      removeCron,
      refreshCron,
    });
    rerender(<AgentChatPanel {...buildAgentChatPanelProps({ chat: removeChat, isSelectedRunning: true })} />);

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });
    expect(screen.getByRole("heading", { name: "Remove scheduled job" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    });

    expect(removeCron).toHaveBeenCalledWith("job-1");
  });

  it("lets escaped slash text send as a normal chat message", () => {
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "//summary",
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });

    expect(handleSendChat).toHaveBeenCalledTimes(1);
  });

  it("shows image attachment preparation before the preview is available", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        pendingAttachmentReads: 1,
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("status", { name: /preparing image attachment/i })).toBeInTheDocument();
    expect(screen.getByTitle("Send message")).toBeDisabled();
  });

  it("keeps an existing draft visible but disabled during reconnect", () => {
    renderAgentChatPanel({
      chat: buildChat({
        input: "pending message",
        connecting: true,
      }),
      isSelectedRunning: true,
    });

    const composer = screen.getByRole("textbox");
    expect(composer).toHaveValue("pending message");
    expect(composer).toBeDisabled();
  });

  it("keeps workspace hydration visible through a transient gateway regression", () => {
    const props = buildAgentChatPanelProps({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        connecting: true,
        hydrating: true,
      }),
      isSelectedRunning: true,
    });
    const { rerender } = renderWithClient(<AgentChatPanel {...props} />);

    expect(screen.getByText("Loading workspace")).toBeInTheDocument();

    rerender(
      <AgentChatPanel
        {...props}
        chat={buildChat({
          connecting: true,
        })}
      />,
    );

    expect(screen.getByText("Loading workspace")).toBeInTheDocument();
    expect(screen.queryByText("Connecting gateway")).not.toBeInTheDocument();
  });

  it("settles briefly before replacing loading with the ready composer", async () => {
    vi.useFakeTimers();
    const props = buildAgentChatPanelProps({
      chat: buildChat({
        connecting: true,
      }),
      isSelectedRunning: true,
    });
    const { rerender } = renderWithClient(<AgentChatPanel {...props} />);

    expect(screen.getByText("Connecting gateway")).toBeInTheDocument();

    rerender(
      <AgentChatPanel
        {...props}
        chat={buildChat({
          status: "connected",
          gatewayConnected: true,
          ready: true,
          connected: true,
        })}
      />,
    );

    expect(screen.getByText("Connecting gateway")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /message agent/i })).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(180);
    });

    expect(screen.getByRole("textbox", { name: /message agent/i })).toBeInTheDocument();
  });

  it("shows the retry action when the gateway reports an error", () => {
    const retry = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        error: "Gateway handshake failed",
        retry,
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("alert", { name: /could not connect gateway handshake failed/i })).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("offers to stop the agent when the gateway origin allowlist is stale", () => {
    const retry = vi.fn();
    const onStopAgent = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        error: "This agent was opened from another dashboard address. Stop and start it from this page, then retry.",
        retry,
      }),
      isSelectedRunning: true,
      slashCommandActions: {
        onStopAgent,
      },
    });

    expect(screen.getByRole("alert", { name: /another dashboard address/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    const stopButton = screen.getByRole("button", { name: /stop agent/i });
    fireEvent.click(stopButton);
    expect(onStopAgent).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });
});
