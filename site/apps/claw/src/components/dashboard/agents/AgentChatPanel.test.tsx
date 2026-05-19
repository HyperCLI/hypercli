import { createRef, type ComponentProps } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSdkAgent } from "@/test/factories";
import { renderWithClient } from "@/test/utils";
import { toAgentViewModel } from "./agentViewModel";
import { AgentChatPanel } from "./AgentChatPanel";

vi.mock("@/components/dashboard/ChatMessage", () => ({
  ChatMessageBubble: () => null,
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

    expect(screen.getByPlaceholderText("Message agent...")).toBeInTheDocument();
    expect(screen.queryByText("Connecting gateway")).not.toBeInTheDocument();
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
    expect(screen.queryByPlaceholderText("Message agent...")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(180);
    });

    expect(screen.getByPlaceholderText("Message agent...")).toBeInTheDocument();
  });

  it("automatically retries three times before showing the retry action", async () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        error: "Gateway handshake failed",
        retry,
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("status", { name: /retrying connection attempt 1 of 3/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await act(async () => {
        vi.advanceTimersByTime(900);
      });
      expect(retry).toHaveBeenCalledTimes(attempt);
    }

    expect(screen.getByRole("alert", { name: /could not connect gateway handshake failed/i })).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledTimes(4);
  });
});
