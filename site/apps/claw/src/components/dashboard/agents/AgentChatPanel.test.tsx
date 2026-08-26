import { createRef, useState, type ComponentProps } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentChannelSummary } from "@hypercli.com/sdk/channels";
import type { AgentSkillsProvider } from "@hypercli.com/sdk/skills";

import { buildSdkAgent } from "@/test/factories";
import { renderWithClient } from "@/test/utils";
import { OPENCLAW_EMPTY_REPLY_NOTICE } from "@/lib/openclaw-chat";
import { toAgentViewModel } from "./agentViewModel";
import { RETURNING_AGENT_SALUTATIONS } from "./AgentEmptyHistory";
import {
  AgentChatPanel,
  chatMessageRowKey,
  failedReplyRetrySource,
  isRetryableFailedReply,
  scrollTranscriptToBottom,
} from "./AgentChatPanel";
import { agentLifecycleLabel } from "./AgentSlashCommandMenu";

const chatMessageBubbleMock = vi.hoisted(() => vi.fn());
const chatThinkingIndicatorMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/dashboard/ChatMessage", () => ({
  ChatMessageBubble: (props: {
    onRetryFailedReply?: () => void;
    retryFailedReplyDisabled?: boolean;
    retryingFailedReply?: boolean;
    userAvatarUrl?: string | null;
  }) => {
    chatMessageBubbleMock(props);
    return props.onRetryFailedReply ? (
      <button
        type="button"
        aria-label={props.retryingFailedReply ? "Retrying failed reply" : "Retry failed reply"}
        disabled={props.retryFailedReplyDisabled || props.retryingFailedReply}
        onClick={props.onRetryFailedReply}
      >
        {props.retryingFailedReply ? "Retrying..." : "Retry"}
      </button>
    ) : null;
  },
  ChatThinkingIndicator: ({
    label = "Thinking",
    description,
    ariaLabel,
    descriptionOnHover,
  }: {
    label?: string;
    description?: string;
    ariaLabel?: string;
    descriptionOnHover?: boolean;
  }) => {
    chatThinkingIndicatorMock({ label, description, ariaLabel, descriptionOnHover });
    return (
      <div role="status" aria-label={ariaLabel ?? label} data-description-on-hover={descriptionOnHover || undefined}>
        <span>{label}</span>
        {description ? <span>{description}</span> : null}
      </div>
    );
  },
}));

vi.mock("@/components/dashboard/ConfirmDialog", () => ({
  ConfirmDialog: ({
    open,
    title,
    message,
    confirmLabel = "Confirm",
    loading = false,
    onCancel,
    onConfirm,
  }: {
    open?: boolean;
    title?: string;
    message?: string;
    confirmLabel?: string;
    loading?: boolean;
    onCancel?: () => void;
    onConfirm?: () => void;
  }) => open ? (
    <div role="dialog" aria-modal="true" aria-label={title}>
      <h2>{title}</h2>
      {message ? <p>{message}</p> : null}
      <button type="button" onClick={onCancel}>Cancel</button>
      <button type="button" disabled={loading} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  ) : null,
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => ({ getToken: vi.fn(async () => "token"), isAuthenticated: true, isLoading: false }),
}));

type AgentChatPanelProps = ComponentProps<typeof AgentChatPanel>;
type ChatSession = AgentChatPanelProps["chat"];

function channel(channelId: string, configured = false): AgentChannelSummary {
  return { channelId, configured, healthState: "unknown" };
}

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
    historyPhase: "ready",
    historyPending: false,
    messages: [],
    sendMessage: vi.fn(async () => undefined),
    abortMessage: vi.fn(async () => undefined),
    aborting: false,
    activeSessionAborting: false,
    input: "",
    setInput: vi.fn(),
    pendingInput: [],
    addPendingMessage: vi.fn(),
    activeSessionKey: "main",
    activeSessionModel: null,
    activeSessionThinkingLevel: null,
    activeSessionThinkingLevels: [],
    activeSessionThinkingDefault: null,
    activeSessionReadOnly: false,
    activeSessionReadOnlyReason: null,
    activeSessionCanSend: true,
    temporaryChatAvailable: true,
    temporaryChatActive: false,
    temporaryChatState: "inactive",
    temporaryChatError: null,
    startTemporaryChat: vi.fn(async () => undefined),
    endTemporaryChat: vi.fn(async () => undefined),
    sending: false,
    activeSessionSending: false,
    files: [],
    config: null,
    configSchema: null,
    openFile: vi.fn(async () => ""),
    saveFile: vi.fn(async () => undefined),
    saveConfig: vi.fn(async () => undefined),
    setActiveSessionModel: vi.fn(async () => undefined),
    setActiveSessionThinkingLevel: vi.fn(async () => undefined),
    saveFullConfig: vi.fn(async () => undefined),
    channelsStatus: vi.fn(async () => ({ channels: {} })),
    channelsProvider: null,
    reportedChannels: [],
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
    skillsProvider: {
      capabilities: { readDocument: true, configure: true, searchRegistry: true, installRegistry: true, installUpload: false, resources: false, createSkill: false, recoverSkill: false },
      list: vi.fn(async () => []),
      readDocument: vi.fn(async () => null),
      update: vi.fn(async () => undefined),
      search: vi.fn(async () => []),
      install: vi.fn(async ({ id }) => ({ ok: true, skillId: id })),
    },
    integrationsAuthStart: vi.fn(async () => ({ authId: "auth-1" })),
    integrationsAuthStatus: vi.fn(async () => ({ status: "pending" })),
    integrationsStatus: vi.fn(async () => ({ integrations: { github: { configured: false, authenticated: false, usable: false } } })),
    integrationsDisconnect: vi.fn(async () => ({ ok: true })),
    retry: vi.fn(),
    retryAndRefreshSessions: vi.fn(async () => undefined),
    ...overrides,
  } as ChatSession;
}

function schemaWith(...paths: string[]) {
  return {
    schema: {},
    uiHints: Object.fromEntries(paths.map((path) => [path, {}])),
  };
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
    onTranscriptResize: vi.fn(),
    onRequestTranscriptScroll: vi.fn(),
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

function closestClassNameContaining(element: Element, classNamePart: string): HTMLElement | null {
  let current: Element | null = element;
  while (current instanceof HTMLElement) {
    if (typeof current.className === "string" && current.className.includes(classNamePart)) return current;
    current = current.parentElement;
  }
  return null;
}

function renderAgentChatPanelWithInputState({
  initialInput = "",
  messages,
}: {
  initialInput?: string;
  messages: ChatSession["messages"];
}) {
  function StatefulAgentChatPanel() {
    const [input, setInput] = useState(initialInput);
    return (
      <AgentChatPanel
        {...buildAgentChatPanelProps({
          chat: buildChat({
            status: "connected",
            gatewayConnected: true,
            ready: true,
            connected: true,
            input,
            setInput,
            messages,
          }),
          isSelectedRunning: true,
        })}
      />
    );
  }

  return renderWithClient(<StatefulAgentChatPanel />);
}

function setScrollMetrics(
  element: HTMLDivElement,
  { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
    scrollTop: { configurable: true, writable: true, value: scrollTop },
  });
}

describe("AgentChatPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
    chatMessageBubbleMock.mockClear();
    chatThinkingIndicatorMock.mockClear();
  });

  it("passes the profile avatar to user chat messages", () => {
    const profileAvatarUrl = "https://cdn.example.test/profile.png";
    renderAgentChatPanel({
      userAvatarUrl: profileAvatarUrl,
      chat: buildChat({ messages: [{ role: "user", content: "Hello" }] }),
    });

    expect(chatMessageBubbleMock).toHaveBeenCalledWith(expect.objectContaining({
      userAvatarUrl: profileAvatarUrl,
    }));
  });

  it("keys production message rows by target and immutable render identity", () => {
    const initialKey = chatMessageRowKey(
      "agent-1",
      "main",
      { renderId: "render-1" },
      "legacy-ignored",
    );
    const identifiedKey = chatMessageRowKey(
      "agent-1",
      "main",
      { renderId: "render-1", messageId: "message-1" },
      "legacy-ignored",
    );

    expect(identifiedKey).toBe(initialKey);
    expect(chatMessageRowKey("agent-1", "main", { messageId: "message-1" }, "legacy-ignored"))
      .toBe(JSON.stringify(["agent-1", "main", "message-1"]));
    expect(chatMessageRowKey("agent-1", "secondary", { renderId: "render-1" }, "legacy-ignored"))
      .not.toBe(initialKey);
  });

  it("recognizes failed replies and resolves their originating user turn", () => {
    const messages: ChatSession["messages"] = [
      { role: "user", content: "Earlier request", clientTurnId: "turn-1" },
      { role: "user", content: "Retry this request", clientTurnId: "turn-2" },
      {
        role: "assistant",
        content: "The agent run failed before producing a reply.",
        clientTurnId: "turn-2",
      },
    ];

    expect(isRetryableFailedReply(messages[2]!)).toBe(true);
    expect(isRetryableFailedReply({ role: "assistant", content: OPENCLAW_EMPTY_REPLY_NOTICE })).toBe(true);
    expect(isRetryableFailedReply({ role: "assistant", content: "A normal response." })).toBe(false);
    expect(failedReplyRetrySource(messages, 2)).toBe(messages[1]);
  });

  it("automatically loads transcript history in 100-message increments at the top", () => {
    const messages = Array.from({ length: 225 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `History message ${index}`,
      renderId: `history-${index}`,
    }));
    const chatScrollRef = createRef<HTMLDivElement>();
    const props = buildAgentChatPanelProps({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        messages,
      }),
      isSelectedRunning: true,
      chatScrollRef,
    });
    const { rerender } = renderWithClient(<AgentChatPanel {...props} />);

    const renderedMessages = chatMessageBubbleMock.mock.calls.map(([props]) => (
      (props as { message: ChatSession["messages"][number] }).message.content
    ));
    const uniqueRenderedMessages = Array.from(new Set(renderedMessages));
    expect(uniqueRenderedMessages).toHaveLength(100);
    expect(uniqueRenderedMessages[0]).toBe("History message 125");
    expect(uniqueRenderedMessages.at(-1)).toBe("History message 224");
    expect(screen.queryByText(/125 earlier messages/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show earlier messages" })).not.toBeInTheDocument();
    chatMessageBubbleMock.mockClear();

    const scroller = chatScrollRef.current!;
    let scrollHeightRead = 0;
    Object.defineProperties(scroller, {
      scrollHeight: {
        configurable: true,
        get: () => {
          scrollHeightRead += 1;
          return scrollHeightRead <= 2 ? 1_000 : 1_800;
        },
      },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    fireEvent.scroll(scroller);

    const expandedMessages = Array.from(new Set(chatMessageBubbleMock.mock.calls.map(([props]) => (
      (props as { message: ChatSession["messages"][number] }).message.content
    ))));
    expect(expandedMessages).toHaveLength(100);
    expect(expandedMessages[0]).toBe("History message 25");
    expect(expandedMessages.at(-1)).toBe("History message 124");
    expect(scroller.scrollTop).toBe(800);

    chatMessageBubbleMock.mockClear();
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    const allMessages = Array.from(new Set(chatMessageBubbleMock.mock.calls.map(([props]) => (
      (props as { message: ChatSession["messages"][number] }).message.content
    ))));
    expect(allMessages).toHaveLength(25);
    expect(allMessages[0]).toBe("History message 0");
    expect(allMessages.at(-1)).toBe("History message 24");

    chatMessageBubbleMock.mockClear();
    rerender(
      <AgentChatPanel
        {...props}
        chat={{ ...props.chat, activeSessionKey: "secondary" }}
      />,
    );
    const nextSessionMessages = Array.from(new Set(chatMessageBubbleMock.mock.calls.map(([nextProps]) => (
      (nextProps as { message: ChatSession["messages"][number] }).message.content
    ))));
    expect(nextSessionMessages).toHaveLength(100);
    expect(nextSessionMessages[0]).toBe("History message 125");
  });

  it("does not rerender stable historical bubbles for streamed content updates", () => {
    const historicalMessage = { role: "user" as const, content: "Stable history", renderId: "history-1" };
    const streamingMessage = { role: "assistant" as const, content: "Streaming", renderId: "stream-1" };
    const props = buildAgentChatPanelProps({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        messages: [historicalMessage, streamingMessage],
      }),
      isSelectedRunning: true,
    });
    const { rerender } = renderWithClient(<AgentChatPanel {...props} />);
    chatMessageBubbleMock.mockClear();

    rerender(
      <AgentChatPanel
        {...props}
        chat={{
          ...props.chat,
          messages: [historicalMessage, { ...streamingMessage, content: "Streaming update" }],
        }}
      />,
    );

    const rerenderedContents = Array.from(new Set(chatMessageBubbleMock.mock.calls.map(([bubbleProps]) => (
      (bubbleProps as { message: ChatSession["messages"][number] }).message.content
    ))));
    expect(rerenderedContents).toEqual(["Streaming update"]);
  });

  it("anchors the active response indicator before streamed text updates paint", () => {
    const chatScrollRef = createRef<HTMLDivElement>();
    const streamingMessage = { role: "assistant" as const, content: "Streaming", renderId: "stream-anchor" };
    const props = buildAgentChatPanelProps({
      chatScrollRef,
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        messages: [streamingMessage],
      }),
      isSelectedRunning: true,
    });
    const { rerender } = renderWithClient(<AgentChatPanel {...props} />);
    const scroller = chatScrollRef.current!;
    let scrollHeight = 1_000;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 600 },
    });
    chatThinkingIndicatorMock.mockClear();

    scrollHeight = 1_120;
    rerender(
      <AgentChatPanel
        {...props}
        chat={{
          ...props.chat,
          messages: [{ ...streamingMessage, content: "Streaming text that now wraps onto another line" }],
        }}
      />,
    );

    expect(scroller.scrollTop).toBe(1_120);
    expect(chatThinkingIndicatorMock).not.toHaveBeenCalled();
  });

  it("does not anchor streamed updates while the user is reading earlier messages", () => {
    const chatScrollRef = createRef<HTMLDivElement>();
    const streamingMessage = { role: "assistant" as const, content: "Streaming", renderId: "stream-history" };
    const props = buildAgentChatPanelProps({
      chatScrollRef,
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        messages: [streamingMessage],
      }),
      isSelectedRunning: true,
    });
    const { rerender } = renderWithClient(<AgentChatPanel {...props} />);
    const scroller = chatScrollRef.current!;
    let scrollHeight = 1_200;
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 300 },
    });
    fireEvent.scroll(scroller);

    scrollHeight = 1_320;
    rerender(
      <AgentChatPanel
        {...props}
        chat={{
          ...props.chat,
          messages: [{ ...streamingMessage, content: "Streaming update while reviewing history" }],
        }}
      />,
    );

    expect(scroller.scrollTop).toBe(300);
  });

  it("keeps memoized message file actions current", () => {
    const firstOpen = vi.fn();
    const nextOpen = vi.fn();
    const message = { role: "assistant" as const, content: "Open the file", renderId: "file-action-1" };
    const props = buildAgentChatPanelProps({
      chat: buildChat({ messages: [message] }),
      onOpenFileFromChat: firstOpen,
    });
    const { rerender } = renderWithClient(<AgentChatPanel {...props} />);
    const bubbleProps = chatMessageBubbleMock.mock.calls.at(-1)?.[0] as {
      onOpenFileFromChat?: (path: string) => void;
    };
    chatMessageBubbleMock.mockClear();

    rerender(<AgentChatPanel {...props} onOpenFileFromChat={nextOpen} />);
    expect(chatMessageBubbleMock).not.toHaveBeenCalled();
    bubbleProps.onOpenFileFromChat?.("README.md");

    expect(firstOpen).not.toHaveBeenCalled();
    expect(nextOpen).toHaveBeenCalledWith("README.md");
  });

  it("retries a failed reply with the original prompt and attachments", async () => {
    const sendMessage = vi.fn(async () => undefined);
    const attachment = {
      type: "image" as const,
      mimeType: "image/png",
      content: "aW1hZ2U=",
      fileName: "reference.png",
    };
    const file = {
      name: "context.md",
      path: "/home/node/.openclaw/workspace/context.md",
      type: "text/markdown",
    };
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sendMessage,
        messages: [
          {
            role: "user",
            content: "Visible request",
            retryContent: "Original request sent to the agent",
            clientTurnId: "turn-retry",
            attachments: [attachment],
            files: [file],
          },
          {
            role: "assistant",
            content: "The agent run failed before producing a reply.",
            clientTurnId: "turn-retry",
          },
        ],
      }),
      isSelectedRunning: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry failed reply" }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(
      "Original request sent to the agent",
      {
        displayContent: "Visible request",
        attachments: [attachment],
        files: [file],
      },
    ));
  });

  it("offers a way to scroll to the latest message when reading earlier messages", () => {
    const chatScrollRef = createRef<HTMLDivElement>();
    const handleChatScroll = vi.fn();
    const onRequestTranscriptScroll = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        messages: [{ role: "assistant", content: "An earlier response" }],
      }),
      chatScrollRef,
      handleChatScroll,
      onRequestTranscriptScroll,
    });

    const scroller = chatScrollRef.current!;
    setScrollMetrics(scroller, { scrollHeight: 1_200, clientHeight: 400, scrollTop: 300 });
    fireEvent.scroll(scroller);

    const latestButton = screen.getByRole("button", { name: "Scroll to latest message" });
    expect(handleChatScroll).toHaveBeenCalledTimes(1);
    expect(latestButton).toHaveClass(
      "bg-[var(--button-primary)]",
      "text-[var(--button-primary-foreground)]",
      "hover:bg-[var(--button-primary-hover)]",
    );

    fireEvent.click(latestButton);
    expect(onRequestTranscriptScroll).toHaveBeenCalledWith("smooth");

    scroller.scrollTop = 750;
    fireEvent.scroll(scroller);
    expect(screen.queryByRole("button", { name: "Scroll to latest message" })).not.toBeInTheDocument();
  });

  it("uses the transcript scroll owner and disables smooth scrolling for reduced motion", () => {
    const originalMatchMedia = window.matchMedia;
    const matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } satisfies MediaQueryList));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: matchMedia,
    });

    try {
      const scroller = document.createElement("div");
      const scrollTo = vi.fn();
      Object.defineProperty(scroller, "scrollTo", { configurable: true, value: scrollTo });
      setScrollMetrics(scroller, { scrollHeight: 1_200, clientHeight: 400, scrollTop: 300 });
      scrollTranscriptToBottom(scroller, "smooth");

      expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scroller.scrollTop).toBe(1_200);
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("keeps the transcript content unconstrained inside the single vertical scroll owner", () => {
    const chatScrollRef = createRef<HTMLDivElement>();
    renderAgentChatPanel({ chatScrollRef });

    const scroller = chatScrollRef.current!;
    const content = scroller.firstElementChild as HTMLDivElement;
    expect(scroller).toHaveClass("overflow-y-auto");
    expect(content).toHaveClass("min-h-full");
    expect(content.className).not.toMatch(/\boverflow(?:-[xy])?-(?:auto|scroll|hidden)\b/);
    expect(content).not.toHaveClass("h-full", "max-h-full");
  });

  it("reattaches transcript resize observation to the actual nodes after a stopped-to-running remount", () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const observers: Array<{
      callback: ResizeObserverCallback;
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    class TestResizeObserver {
      callback: ResizeObserverCallback;
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);

    const chatScrollRef = createRef<HTMLDivElement>();
    const onTranscriptResize = vi.fn();
    const props = buildAgentChatPanelProps({ chatScrollRef, onTranscriptResize });
    function Harness({ running }: { running: boolean }) {
      return running ? <AgentChatPanel {...props} /> : <div>Stopped</div>;
    }

    try {
      const { rerender, unmount } = renderWithClient(<Harness running />);
      const firstScroller = chatScrollRef.current!;
      const firstContent = firstScroller.firstElementChild;
      const firstTranscriptObserver = observers.find((observer) => observer.observe.mock.calls.some(([node]) => node === firstScroller));
      expect(firstTranscriptObserver?.observe.mock.calls).toEqual([[firstScroller], [firstContent]]);

      act(() => rerender(<Harness running={false} />));
      expect(firstTranscriptObserver?.disconnect).toHaveBeenCalledTimes(1);
      expect(chatScrollRef.current).toBeNull();

      act(() => rerender(<Harness running />));
      const secondScroller = chatScrollRef.current!;
      const secondContent = secondScroller.firstElementChild;
      const secondTranscriptObserver = observers.find((observer) => observer.observe.mock.calls.some(([node]) => node === secondScroller));
      expect(secondTranscriptObserver?.observe.mock.calls).toEqual([[secondScroller], [secondContent]]);

      secondTranscriptObserver?.callback([], secondTranscriptObserver as unknown as ResizeObserver);
      expect(onTranscriptResize).toHaveBeenCalledTimes(1);
      expect(onTranscriptResize).toHaveBeenCalledWith("auto");
      unmount();
      expect(secondTranscriptObserver?.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.stubGlobal("ResizeObserver", originalResizeObserver);
    }
  });

  it("hides the latest-message control when the active session changes", () => {
    const chatScrollRef = createRef<HTMLDivElement>();
    const chat = buildChat({
      status: "connected",
      gatewayConnected: true,
      ready: true,
      connected: true,
      messages: [{ role: "assistant", content: "Session response" }],
    });
    const props = buildAgentChatPanelProps({ chat, chatScrollRef });
    const { rerender } = renderWithClient(<AgentChatPanel {...props} />);

    const scroller = chatScrollRef.current!;
    setScrollMetrics(scroller, { scrollHeight: 1_200, clientHeight: 400, scrollTop: 300 });
    fireEvent.scroll(scroller);
    expect(screen.getByRole("button", { name: "Scroll to latest message" })).toBeInTheDocument();

    rerender(
      <AgentChatPanel
        {...props}
        chat={{ ...chat, activeSessionKey: "secondary" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Scroll to latest message" })).not.toBeInTheDocument();
  });

  it("explains the transcript-only boundary while private chat is active", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        temporaryChatActive: true,
        temporaryChatState: "active",
      }),
    });

    expect(screen.getByText("Private chat.")).toBeInTheDocument();
    expect(screen.getByText(/Agent actions can still affect shared files, memory, integrations, and settings/i)).toBeInTheDocument();
  });

  it("wires available workspace tools into the ready empty chat", () => {
    const onOpenFiles = vi.fn();
    const onOpenIntegrations = vi.fn();
    const onOpenSkills = vi.fn();
    const onOpenScheduled = vi.fn();

    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
      }),
      slashCommandActions: { onOpenFiles, onOpenIntegrations, onOpenSkills, onOpenScheduled },
    });

    const emptyStateFrame = screen
      .getByRole("heading", { name: "What should we tackle today?" })
      .closest(".agent-empty-history-frame");
    expect(emptyStateFrame).toHaveClass("self-stretch");
    expect(emptyStateFrame).not.toHaveClass("max-h-full");
    expect(screen.queryByRole("button", { name: "Say hello" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open slack setup/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open workspace files/i }));
    fireEvent.click(screen.getByRole("button", { name: /connect any tool/i }));
    fireEvent.click(screen.getByRole("button", { name: /open skills/i }));
    fireEvent.click(screen.getByRole("button", { name: /open scheduled work/i }));

    expect(onOpenFiles).toHaveBeenCalledTimes(1);
    expect(onOpenIntegrations).toHaveBeenCalledTimes(1);
    expect(onOpenSkills).toHaveBeenCalledTimes(1);
    expect(onOpenScheduled).toHaveBeenCalledTimes(1);
  });

  it("personalizes empty sessions without a separate first-use CTA", () => {
    renderAgentChatPanel({
      userName: "Sam Rivera",
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sessions: [{
          key: "dashboard:019789ab-cdef-4abc-8def-0123456789ab",
          messageCount: 2,
        }] as ChatSession["sessions"],
      }),
    });

    const heading = screen.getByRole("heading", { level: 2 });
    expect(RETURNING_AGENT_SALUTATIONS.some((candidate) => heading.textContent === `${candidate}, Sam?`)).toBe(true);
    expect(screen.queryByRole("button", { name: "Say hello" })).not.toBeInTheDocument();
    expect(screen.queryByText(/getting to know each other/i)).not.toBeInTheDocument();
  });

  it("keeps the standard new-session state after conversation history is cleared", async () => {
    renderAgentChatPanel({
      userName: "Sam Rivera",
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sessions: [],
      }),
    });

    await waitFor(() => {
      const heading = screen.getByRole("heading", { level: 2 });
      expect(RETURNING_AGENT_SALUTATIONS.some((candidate) => heading.textContent === `${candidate}, Sam?`)).toBe(true);
    });
    expect(screen.queryByRole("button", { name: "Say hello" })).not.toBeInTheDocument();
  });

  it("shows a stable history loader instead of empty-chat actions while history is pending", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        historyPhase: "loading",
        historyPending: true,
        activeSessionCanSend: false,
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("heading", { name: "Rejoining your teammate" })).toBeInTheDocument();
    expect(screen.getByText("Loading conversation")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect slack/i })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByPlaceholderText("Loading conversation...")).toBeInTheDocument();
  });

  it("keeps existing messages visible instead of showing the history loader while refresh is pending", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        historyPhase: "loading",
        historyPending: true,
        activeSessionCanSend: false,
        messages: [{ role: "assistant", content: "Saved answer", renderId: "saved-answer" }],
      }),
      isSelectedRunning: true,
    });

    expect(chatMessageBubbleMock.mock.calls.some(([props]) => (
      props as { message?: { content?: string } } | undefined
    )?.message?.content === "Saved answer")).toBe(true);
    expect(screen.queryByRole("heading", { name: "Rejoining your teammate" })).not.toBeInTheDocument();
    expect(screen.queryByText("Loading conversation")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByPlaceholderText("Loading conversation...")).toBeInTheDocument();
  });

  it("uses neutral composer copy while a retained gateway prepares the conversation", () => {
    const sendMessage = vi.fn(async () => undefined);
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: false,
        connecting: true,
        historyPhase: "loading",
        historyPending: true,
        activeSessionCanSend: true,
        input: "Saved draft",
        sendMessage,
        messages: [{ role: "assistant", content: "Saved answer", renderId: "saved-answer" }],
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Loading conversation...")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Preparing chat...")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("keeps preparation copy while a cold gateway connection is opening", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connecting",
        gatewayConnected: false,
        ready: false,
        connected: false,
        connecting: true,
        activeSessionCanSend: false,
        messages: [{ role: "assistant", content: "Saved answer", renderId: "saved-answer" }],
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByPlaceholderText("Preparing chat...")).toBeInTheDocument();
  });

  it("keeps existing messages visible and exposes retry when history refresh fails", () => {
    const retry = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        historyPhase: "error",
        activeSessionCanSend: false,
        messages: [{ role: "assistant", content: "Cached answer", renderId: "cached-answer" }],
        retry,
      }),
      isSelectedRunning: true,
    });

    expect(chatMessageBubbleMock.mock.calls.some(([props]) => (
      props as { message?: { content?: string } } | undefined
    )?.message?.content === "Cached answer")).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("Showing saved messages");
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByPlaceholderText("Retry conversation before sending...")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps the composer out of the creating stage", () => {
    const selectedAgent = buildAgent("CREATING");
    renderAgentChatPanel({
      selectedAgent,
      isSelectedRunning: false,
    });

    expect(screen.getByText("Creating agent")).toBeInTheDocument();
    expect(screen.getByText("Preparing persistent storage and admitting the runtime.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the canonical failed-agent status without using gateway diagnostics", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({
      state: "FAILED",
    }));
    renderAgentChatPanel({
      selectedAgent,
      isSelectedRunning: false,
      chat: buildChat({ error: "Stale gateway error" }),
    });

    expect(screen.getByText("Review this agent before restarting")).toBeInTheDocument();
    expect(screen.getByText("Clean up the interrupted launch, then start the agent again.")).toBeInTheDocument();
    expect(screen.queryByText("Stale gateway error")).not.toBeInTheDocument();
  });

  it("offers failed-resource cleanup instead of retrying the gateway", () => {
    const onStopAgent = vi.fn();
    renderAgentChatPanel({
      selectedAgent: toAgentViewModel(buildSdkAgent({
        state: "FAILED",
      })),
      isSelectedRunning: false,
      slashCommandActions: { onStopAgent },
    });

    fireEvent.click(screen.getByRole("button", { name: "Clean up failed launch" }));
    expect(onStopAgent).toHaveBeenCalledTimes(1);
  });

  it("does not render a blank recovery action when failed lifecycle controls are unavailable", () => {
    const selectedAgent = toAgentViewModel(buildSdkAgent({
      state: "FAILED",
      isLaunchable: false,
    }));
    renderAgentChatPanel({
      selectedAgent,
      isSelectedRunning: false,
      chat: buildChat({
        messages: [{ role: "assistant", content: "Saved answer", renderId: "saved-answer" }],
      }),
    });

    const alert = screen.getByText("Clean up the interrupted launch, then start the agent again.").closest('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.querySelector("button")).toBeNull();
  });

  it("keeps the startup experience through gateway connection after lifecycle startup", async () => {
    const pendingAgent = buildAgent("CREATING");
    const props = buildAgentChatPanelProps({
      selectedAgent: pendingAgent,
      isSelectedRunning: false,
    });
    const { container, rerender } = renderWithClient(<AgentChatPanel {...props} />);

    expect(container.querySelector('[data-slot="agent-startup-tips"]')).toBeInTheDocument();

    rerender(
      <AgentChatPanel
        {...props}
        selectedAgent={buildAgent("RUNNING")}
        isSelectedRunning
        chat={buildChat({ connecting: true })}
      />,
    );

    await waitFor(() => expect(screen.getByText("Connecting gateway")).toBeInTheDocument());
    expect(container.querySelector('[data-slot="agent-startup-tips"]')).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();
  });

  it("uses the new startup experience for initial page hydration", () => {
    const { container } = renderAgentChatPanel({
      chat: buildChat({ connecting: true }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("heading", { name: "Rejoining your teammate" })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="agent-startup-tips"]')).toBeInTheDocument();
  });

  it("keeps the new startup experience during later reconnects", async () => {
    const props = buildAgentChatPanelProps({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
      }),
      isSelectedRunning: true,
    });
    const { container, rerender } = renderWithClient(<AgentChatPanel {...props} />);

    rerender(
      <AgentChatPanel
        {...props}
        chat={buildChat({ connecting: true })}
      />,
    );

    await waitFor(() => expect(screen.getByText("Connecting gateway")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Rejoining your teammate" })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="agent-startup-tips"]')).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();
  });

  it("passes workspace file actions to rendered chat messages", () => {
    const selectedAgent = { ...buildAgent(), name: "research-agent", handle: "research-pilot", displayName: "ignored-external-name" };
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
      agentName: "Research Pilot",
      animationVariant: "off",
      onReadFileBytesFromChat: expect.any(Function),
      onOpenFileFromChat: expect.any(Function),
      onDownloadFileFromChat: expect.any(Function),
    }));
    (bubbleProps?.onOpenFileFromChat as (path: string) => void)("report.pdf");
    (bubbleProps?.onDownloadFileFromChat as (file: { path: string }) => void)({ path: "report.pdf" });
    expect(onOpenFileFromChat).toHaveBeenCalledWith("report.pdf");
    expect(onDownloadFileFromChat).toHaveBeenCalledWith({ path: "report.pdf" });
  });

  it("contains a malformed message render without losing the transcript", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    chatMessageBubbleMock.mockImplementation((props: { message?: { content?: string } }) => {
      if (props.message?.content === "Malformed payload") throw new Error("render failed");
    });
    try {
      const initialProps = buildAgentChatPanelProps({
        chat: buildChat({
          status: "connected",
          gatewayConnected: true,
          ready: true,
          connected: true,
          messages: [
            { role: "assistant", content: "Malformed payload", renderId: "bad-row" },
            { role: "assistant", content: "Healthy payload", renderId: "good-row" },
          ],
        }),
      });
      const { rerender } = renderWithClient(<AgentChatPanel {...initialProps} />);

      expect(screen.getByRole("alert")).toHaveTextContent("This message could not be displayed");
      expect(chatMessageBubbleMock.mock.calls.some(([props]) => (
        props as { message?: { content?: string } } | undefined
      )?.message?.content === "Healthy payload")).toBe(true);

      rerender(
        <AgentChatPanel
          {...initialProps}
          chat={{
            ...initialProps.chat,
            messages: [
              { role: "assistant", content: "Recovered payload", renderId: "bad-row", revision: 2 },
              { role: "assistant", content: "Healthy payload", renderId: "good-row" },
            ],
          }}
        />,
      );
      expect(screen.queryByText("This message could not be displayed.")).not.toBeInTheDocument();
      expect(chatMessageBubbleMock.mock.calls.some(([props]) => (
        props as { message?: { content?: string } } | undefined
      )?.message?.content === "Recovered payload")).toBe(true);
    } finally {
      chatMessageBubbleMock.mockImplementation(() => undefined);
      consoleError.mockRestore();
    }
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
    const { container } = renderAgentChatPanel({
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
    expect(container.querySelector('[data-slot="agent-startup-tips"]')).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
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
    expect(screen.queryByTestId("agent-empty-state-app-suggestions")).not.toBeInTheDocument();
    expect(screen.queryByText("Connecting gateway")).not.toBeInTheDocument();
  });

  it("opens auth-first GitHub setup from the desktop composer shortcut", async () => {
    const integrationsAuthStart = vi.fn(async () => ({ authId: "auth-desktop" }));
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        integrationsAuthStart,
        connectorWorkflows: {
          github: {
            schema: "hypercli.connector-workflow.v1",
            connectorId: "github",
            runtimeFingerprint: "openclaw:test",
            summary: "Cached GitHub guidance must not intercept authentication.",
            steps: [],
          },
        },
      }),
      isDesktopViewport: true,
      isSelectedRunning: true,
    });

    const emptyState = screen.getByTestId("agent-empty-history");
    const composer = screen.getByTestId("agent-chat-composer");
    const suggestions = screen.getByTestId("agent-empty-state-app-suggestions");
    expect(emptyState).not.toContainElement(composer);
    expect(composer.parentElement?.parentElement).toContainElement(suggestions);
    expect(composer.parentElement?.parentElement).toHaveClass("rounded-3xl", "border-border");
    expect(suggestions).toHaveTextContent("Get better answers from your apps");
    for (const integration of ["GitHub", "Discord", "Telegram", "WhatsApp", "Slack"]) {
      expect(within(suggestions).getByRole("button", { name: `Open ${integration} setup` })).toBeInTheDocument();
    }
    expect(screen.getAllByTestId("agent-chat-composer")).toHaveLength(1);

    fireEvent.click(within(suggestions).getByRole("button", { name: "Open GitHub setup" }));
    expect(screen.queryByText("Cached GitHub guidance must not intercept authentication.")).not.toBeInTheDocument();
    const startButton = await screen.findByRole("button", { name: /start connection/i });
    await act(async () => {
      fireEvent.click(startButton);
    });
    expect(integrationsAuthStart).toHaveBeenCalledWith({ integrationId: "github", scopes: ["repo", "read:org", "gist"] });
  });

  it("opens auth-first GitHub setup from the empty-history shortcut", async () => {
    const integrationsAuthStart = vi.fn(async () => ({ authId: "auth-empty-history" }));
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        integrationsAuthStart,
        connectorWorkflows: {
          github: {
            schema: "hypercli.connector-workflow.v1",
            connectorId: "github",
            runtimeFingerprint: "openclaw:test",
            summary: "Cached GitHub guidance must not intercept authentication.",
            steps: [],
          },
        },
      }),
      isSelectedRunning: true,
    });

    const emptyState = screen.getByTestId("agent-empty-history");
    fireEvent.click(within(emptyState).getByRole("button", { name: "Open GitHub setup" }));

    expect(screen.queryByText("Cached GitHub guidance must not intercept authentication.")).not.toBeInTheDocument();
    const startButton = await screen.findByRole("button", { name: /start connection/i });
    await act(async () => {
      fireEvent.click(startButton);
    });
    expect(integrationsAuthStart).toHaveBeenCalledWith({ integrationId: "github", scopes: ["repo", "read:org", "gist"] });
  });

  it("dismisses desktop app shortcuts", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
      }),
      isDesktopViewport: true,
      isSelectedRunning: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss app suggestions" }));
    expect(screen.queryByTestId("agent-empty-state-app-suggestions")).not.toBeInTheDocument();
  });

  it("renders the current model control for OpenClaw conversations", () => {
    renderAgentChatPanel({
      chat: buildChat({
        backend: "openclaw",
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        config: {
          agents: { defaults: { model: { primary: "openai/gpt-5-mini" } } },
          models: { providers: { openai: { name: "OpenAI", models: [{ id: "gpt-5-mini", name: "GPT-5 Mini" }] } } },
        },
        activeSessionThinkingLevels: [{ id: "medium", label: "Medium" }],
        activeSessionThinkingDefault: "medium",
      }),
      isSelectedRunning: true,
    });

    const modelTrigger = screen.getByRole("button", { name: "Model: GPT-5 Mini" });
    expect(modelTrigger).toHaveClass("max-w-24");
    expect(modelTrigger.parentElement).toHaveClass("hidden", "sm:block");
    expect(within(modelTrigger).queryByText("Medium")).not.toBeInTheDocument();
    const compactTrigger = screen.getByRole("button", { name: "Variant: Medium, model: GPT-5 Mini" });
    expect(compactTrigger.parentElement).not.toHaveClass("hidden", "sm:hidden");
    expect(within(compactTrigger).getByText("Medium")).not.toHaveClass("hidden");
    expect(screen.getByRole("textbox", { name: /message agent/i })).toHaveClass("pr-5", "sm:pr-76");
  });

  it("keeps mobile model and attachment controls directly available", () => {
    const fileInputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    renderAgentChatPanel({
      chat: buildChat({
        backend: "openclaw",
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        config: {
          agents: { defaults: { model: { primary: "openai/gpt-5-mini" } } },
          models: { providers: { openai: { name: "OpenAI", models: [{ id: "gpt-5-mini", name: "GPT-5 Mini" }] } } },
        },
        activeSessionThinkingLevels: [{ id: "medium", label: "Medium" }],
        activeSessionThinkingDefault: "medium",
      }),
      isSelectedRunning: true,
    });

    const compactTrigger = screen.getByRole("button", { name: "Variant: Medium, model: GPT-5 Mini" });
    expect(compactTrigger.parentElement).not.toHaveClass("hidden", "sm:hidden");
    const voiceTrigger = screen.getByRole("button", { name: "Record voice message" });
    const attachmentTrigger = screen.getByRole("button", { name: "Attach file" });
    const sendTrigger = screen.getByRole("button", { name: "Send message" });
    const mobileControlRow = screen.getByTestId("agent-chat-composer-region");
    expect(mobileControlRow).toHaveClass(
      "max-sm:[&_button]:min-h-[44px]",
      "max-sm:[&_button]:min-w-[44px]",
    );
    for (const trigger of [attachmentTrigger, voiceTrigger, sendTrigger]) {
      expect(mobileControlRow).toContainElement(trigger);
    }
    expect(attachmentTrigger.parentElement).toBe(voiceTrigger.parentElement);
    expect(compactTrigger.parentElement?.parentElement).toBe(attachmentTrigger.parentElement?.parentElement);
    fireEvent.click(attachmentTrigger);

    expect(fileInputClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Open message tools" })).not.toBeInTheDocument();
    fileInputClick.mockRestore();
  });

  it("keeps mobile composer controls usable while a reply is sending", () => {
    renderAgentChatPanel({
      chat: buildChat({
        backend: "openclaw",
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        input: "Continue with the responsive review",
        activeSessionThinkingLevels: [{ id: "medium", label: "Medium" }],
        activeSessionThinkingDefault: "medium",
      }),
      isSelectedRunning: true,
    });

    const stopTrigger = screen.getByRole("button", { name: "Stop reply" });
    const mobileControlRow = screen.getByTestId("agent-chat-composer-region");
    expect(mobileControlRow).toHaveClass(
      "max-sm:[&_button]:min-h-[44px]",
      "max-sm:[&_button]:min-w-[44px]",
    );
    expect(mobileControlRow).toContainElement(stopTrigger);
    expect(mobileControlRow).toContainElement(screen.getByRole("button", { name: "Attach file" }));
    expect(mobileControlRow).toContainElement(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByRole("textbox", { name: /message agent/i })).not.toHaveClass("max-sm:min-h-28");
  });

  it("reserves a mobile composer footer for model and send controls", () => {
    renderAgentChatPanel({
      chat: buildChat({
        backend: "openclaw",
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "A draft that needs the full composer width",
        activeSessionThinkingLevels: [{ id: "medium", label: "Medium" }],
        activeSessionThinkingDefault: "medium",
      }),
      isSelectedRunning: true,
    });

    const composer = screen.getByRole("textbox", { name: /message agent/i });
    expect(composer).toHaveClass("pr-5", "sm:pr-76");
    expect(composer).not.toHaveClass("max-sm:pb-18", "max-sm:min-h-24");

    const compactTrigger = screen.getByRole("button", { name: "Variant: Medium, model: Choose model" });
    const sendTrigger = screen.getByRole("button", { name: "Send message" });
    const actionRail = compactTrigger.parentElement?.parentElement;
    expect(sendTrigger.parentElement?.parentElement).toBe(actionRail);
    expect(actionRail).toHaveClass("justify-between", "px-3", "pb-3", "pt-1", "sm:absolute", "sm:top-[calc(50%-3px)]");
    expect(actionRail).not.toHaveClass("absolute", "bottom-4", "left-3", "right-3");
    expect(actionRail).not.toHaveClass("flex-col");

    const voiceTrigger = screen.getByLabelText("Clear text to record voice");
    expect(voiceTrigger.parentElement).toHaveClass("max-sm:hidden");
  });

  it("selects a model from the compact mobile control", async () => {
    const chat = buildChat({
      backend: "openclaw",
      status: "connected",
      gatewayConnected: true,
      ready: true,
      connected: true,
      config: {
        agents: { defaults: { model: { primary: "openai/gpt-5-mini" } } },
        models: { providers: { openai: { name: "OpenAI", models: [{ id: "gpt-5-mini", name: "GPT-5 Mini" }] } } },
      },
      models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", providerId: "anthropic", providerName: "Anthropic" }],
      activeSessionThinkingLevels: [{ id: "medium", label: "Medium" }],
      activeSessionThinkingDefault: "medium",
    });
    renderAgentChatPanel({ chat, isSelectedRunning: true });

    fireEvent.click(screen.getByRole("button", { name: "Variant: Medium, model: GPT-5 Mini" }));
    fireEvent.click(screen.getByRole("option", { name: "Claude Sonnet 4.5 (Anthropic)" }));

    await waitFor(() => expect(chat.setActiveSessionModel).toHaveBeenCalledWith("anthropic/claude-sonnet-4-5"));
    await waitFor(() => expect(screen.queryByRole("option", { name: "Claude Sonnet 4.5 (Anthropic)" })).not.toBeInTheDocument());
  });

  it("disables the composer for read-only connected conversations", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        activeSessionReadOnly: true,
        activeSessionReadOnlyReason: "Telegram conversations are read-only here. Reply from Telegram.",
      }),
      isSelectedRunning: true,
    });

    const composer = screen.getByRole("textbox", { name: /message agent/i });
    expect(composer).toBeDisabled();
    expect(composer).toHaveAttribute("placeholder", "Telegram conversations are read-only here. Reply from Telegram.");
    expect(screen.getAllByLabelText("Telegram conversations are read-only here. Reply from Telegram.")[0]).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("ignores dropped files for read-only connected conversations", () => {
    const handleChatFileDrop = vi.fn();
    const setChatDragActive = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        activeSessionReadOnly: true,
        activeSessionReadOnlyReason: "Telegram conversations are read-only here. Reply from Telegram.",
      }),
      handleChatFileDrop,
      setChatDragActive,
      isSelectedRunning: true,
    });

    const composer = screen.getByRole("textbox", { name: /message agent/i });
    const chatRoot = closestClassNameContaining(composer, "max-h-full");
    expect(chatRoot).not.toBeNull();

    fireEvent.dragEnter(chatRoot!, {
      dataTransfer: { types: ["Files"], files: [new File(["test"], "test.png", { type: "image/png" })] },
    });
    fireEvent.drop(chatRoot!, {
      dataTransfer: { types: ["Files"], files: [new File(["test"], "test.png", { type: "image/png" })] },
    });

    expect(handleChatFileDrop).not.toHaveBeenCalled();
    expect(setChatDragActive).toHaveBeenCalledWith(false);
    expect(setChatDragActive).not.toHaveBeenCalledWith(true);
  });

  it("expands a dropped folder before passing its files to chat", async () => {
    const handleChatFileDrop = vi.fn(async () => undefined);
    const file = new File(["image"], "photo.png", { type: "image/png" });
    const fileEntry = {
      isFile: true,
      isDirectory: false,
      name: "photo.png",
      file: (resolve: (value: File) => void) => resolve(file),
    };
    let unread = true;
    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      name: "photos",
      createReader: () => ({
        readEntries: (resolve: (entries: typeof fileEntry[]) => void) => {
          if (!unread) {
            resolve([]);
            return;
          }
          unread = false;
          resolve([fileEntry]);
        },
      }),
    };
    renderAgentChatPanel({
      chat: buildChat({ status: "connected", gatewayConnected: true, ready: true, connected: true }),
      handleChatFileDrop,
      isSelectedRunning: true,
    });
    const chatRoot = closestClassNameContaining(screen.getByRole("textbox", { name: /message agent/i }), "max-h-full");

    fireEvent.drop(chatRoot!, {
      dataTransfer: {
        types: ["Files"],
        files: [],
        items: [{ kind: "file", webkitGetAsEntry: () => directoryEntry, getAsFile: () => null }],
      },
    });

    await waitFor(() => expect(handleChatFileDrop).toHaveBeenCalledWith([{
      file,
      relativePath: "photos/photo.png",
    }]));
  });

  it("shows a useful error when a dropped chat folder disappears", async () => {
    const handleChatFileDrop = vi.fn();
    const notFound = new DOMException(
      "A requested file or directory could not be found at the time an operation was processed.",
      "NotFoundError",
    );
    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      name: "missing-photos",
      createReader: () => ({
        readEntries: (_resolve: (entries: unknown[]) => void, reject: (cause: DOMException) => void) => reject(notFound),
      }),
    };
    renderAgentChatPanel({
      chat: buildChat({ status: "connected", gatewayConnected: true, ready: true, connected: true }),
      handleChatFileDrop,
      isSelectedRunning: true,
    });
    const chatRoot = closestClassNameContaining(screen.getByRole("textbox", { name: /message agent/i }), "max-h-full");

    fireEvent.drop(chatRoot!, {
      dataTransfer: {
        types: ["Files"],
        files: [],
        items: [{ kind: "file", webkitGetAsEntry: () => directoryEntry, getAsFile: () => null }],
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Could not read folder "missing-photos". It may have been moved or removed while it was being added.',
    );
    expect(handleChatFileDrop).not.toHaveBeenCalled();
  });

  it("rejects an unreadable folder pseudo-file before chat reads its bytes", async () => {
    const handleChatFileDrop = vi.fn();
    const pseudoFile = new File([], "photos.folder", { type: "" });
    renderAgentChatPanel({
      chat: buildChat({ status: "connected", gatewayConnected: true, ready: true, connected: true }),
      handleChatFileDrop,
      isSelectedRunning: true,
    });
    const chatRoot = closestClassNameContaining(screen.getByRole("textbox", { name: /message agent/i }), "max-h-full");

    fireEvent.drop(chatRoot!, {
      dataTransfer: {
        types: ["Files"],
        files: [pseudoFile],
        items: [],
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'Could not open folder "photos.folder". This browser did not provide access to its contents.',
    );
    expect(handleChatFileDrop).not.toHaveBeenCalled();
  });

  it("renders GitHub connector cards from assistant UI action metadata", async () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        configSchema: schemaWith("integrations.github"),
        connectorWorkflows: {
          github: {
            schema: "hypercli.connector-workflow.v1",
            connectorId: "github",
            runtimeFingerprint: "openclaw:test",
            summary: "Cached GitHub guidance must not intercept authentication.",
            steps: [],
          },
        },
        messages: [
          {
            role: "assistant",
            content: "I can help connect GitHub.\n\n@@hypercli.ui-action/v1 integration.connect github",
          },
        ],
      }),
      isSelectedRunning: true,
    });

    expect(await screen.findByText("Start connection")).toBeInTheDocument();
    expect(screen.queryByText("Cached GitHub guidance must not intercept authentication.")).not.toBeInTheDocument();
    expect(chatMessageBubbleMock).not.toHaveBeenCalled();
  });

  it("renders Telegram connector cards from assistant UI action metadata", async () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        configSchema: schemaWith("channels.telegram"),
        generateConnectorWorkflow: vi.fn(async () => ({
          schema: "hypercli.connector-workflow.v1",
          connectorId: "telegram",
          runtimeFingerprint: "openclaw:test",
          summary: "Configure Telegram.",
          steps: [{
            id: "access",
            title: "Choose Telegram access",
            instructions: "Enter the protected settings.",
            kind: "input",
            inputSlots: ["telegram.botToken"],
            approvalRequired: false,
          }],
        })),
        messages: [
          {
            role: "assistant",
            content: "Use the secure Telegram wizard.\n\n@@hypercli.ui-action/v1 integration.connect telegram",
          },
        ],
      }),
      isSelectedRunning: true,
    });

    expect(await screen.findByText("Start setup")).toBeInTheDocument();
    expect(screen.getByText(/without putting secrets in chat/i)).toBeInTheDocument();
    expect(chatMessageBubbleMock).not.toHaveBeenCalled();
  });

  it.each([
    "connect Telegram",
    "set up Discord",
    "configure Slack",
    "connect my WhatsApp channel",
    "connect GitHub",
  ])("sends integration-related text normally when the user submits %s", (input) => {
    const handleSendChat = vi.fn();
    const onConnectionCta = vi.fn();
    const setInput = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input,
        setInput,
        configSchema: schemaWith("channels.telegram", "integrations.github"),
      }),
      isSelectedRunning: true,
      handleSendChat,
      onConnectionCta,
    });

    fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });

    expect(handleSendChat).toHaveBeenCalledTimes(1);
    expect(setInput).not.toHaveBeenCalled();
    expect(onConnectionCta).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /start setup|start connection|advanced mode/i })).not.toBeInTheDocument();
  });

  it("sends integration-related text normally from the send button", () => {
    const handleSendChat = vi.fn();
    const setInput = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "please connect Slack",
        setInput,
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(handleSendChat).toHaveBeenCalledTimes(1);
    expect(setInput).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /advanced mode/i })).not.toBeInTheDocument();
  });

  it.each([
    "connect a channel",
    "make a messaging integration",
    "connect Telegram and Slack",
    "connect Signal",
  ])("sends generic or unsupported integration intent normally: %s", (input) => {
    const handleSendChat = vi.fn();
    const onOpenIntegrations = vi.fn();
    const setInput = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input,
        setInput,
      }),
      isSelectedRunning: true,
      handleSendChat,
      slashCommandActions: { onOpenIntegrations },
    });

    fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });

    expect(handleSendChat).toHaveBeenCalledTimes(1);
    expect(setInput).not.toHaveBeenCalled();
    expect(onOpenIntegrations).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /start setup|start connection/i })).not.toBeInTheDocument();
  });

  it.each([
    "write a Slack announcement",
    "compare Telegram and Discord",
    "do not connect Telegram",
    "Generate a dense Markdown rendering test with a standard link, bare URL, tables, HTML elements, and a conclusion. This query should not navigate to integrations.",
  ])("does not open integration UI for ordinary discussion: %s", (input) => {
    const handleSendChat = vi.fn();
    const onOpenIntegrations = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input,
      }),
      isSelectedRunning: true,
      handleSendChat,
      slashCommandActions: { onOpenIntegrations },
    });

    fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });

    expect(handleSendChat).toHaveBeenCalledTimes(1);
    expect(onOpenIntegrations).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /start setup|start connection/i })).not.toBeInTheDocument();
  });

  it("does not reopen connector UI from historical user messages", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        messages: [{ role: "user", content: "connect Telegram" }],
      }),
      isSelectedRunning: true,
    });

    expect(screen.queryByRole("button", { name: /start setup/i })).not.toBeInTheDocument();
  });

  it("does not offer a static GitHub composer suggestion", () => {
    const onConnectionCta = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "connect github",
      }),
      isSelectedRunning: true,
      onConnectionCta,
    });

    expect(screen.queryByRole("button", { name: "Open GitHub connection setup" })).not.toBeInTheDocument();
    expect(onConnectionCta).not.toHaveBeenCalled();
  });

  it("opens a Telegram connector card from the composer suggestion", async () => {
    const onConnectionCta = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "connect telegram",
        reportedChannels: [channel("telegram")],
      }),
      isSelectedRunning: true,
      onConnectionCta,
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Telegram connection setup" }));

    expect(await screen.findByText("Start setup")).toBeInTheDocument();
    expect(onConnectionCta).not.toHaveBeenCalled();
  });

  it("dismisses individual composer integration suggestions", () => {
    const onConnectionCta = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "connect telegram and discord",
        reportedChannels: [channel("telegram"), channel("discord")],
      }),
      isSelectedRunning: true,
      onConnectionCta,
    });

    expect(screen.getByRole("button", { name: "Open Telegram connection setup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Discord connection setup" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Telegram connection suggestion" }));

    expect(screen.queryByRole("button", { name: "Open Telegram connection setup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss Telegram connection suggestion" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Discord connection setup" })).toBeInTheDocument();
    expect(onConnectionCta).not.toHaveBeenCalled();
  });

  it("opens the Telegram card setup flow from the card action", async () => {
    const onConnectionCta = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        configSchema: schemaWith("channels.telegram"),
        generateConnectorWorkflow: vi.fn(async () => ({
          schema: "hypercli.connector-workflow.v1",
          connectorId: "telegram",
          runtimeFingerprint: "openclaw:test",
          summary: "Configure Telegram.",
          steps: [{
            id: "access",
            title: "Choose Telegram access",
            instructions: "Enter the protected settings.",
            kind: "input",
            inputSlots: ["telegram.botToken"],
            approvalRequired: false,
          }],
        })),
        messages: [
          {
            role: "assistant",
            content: "@@hypercli.ui-action/v1 integration.connect telegram",
          },
        ],
      }),
      isSelectedRunning: true,
      onConnectionCta,
    });

    fireEvent.click(await screen.findByRole("button", { name: /start setup/i }));

    expect(onConnectionCta).not.toHaveBeenCalled();
    expect(await screen.findByText("Choose Telegram access")).toBeInTheDocument();
  });

  it("starts GitHub device authorization from the chat card", async () => {
    const integrationsAuthStart = vi.fn(async () => ({
      authId: "auth-1",
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-1234",
      intervalMs: 30_000,
    }));

    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        configSchema: schemaWith("integrations.github"),
        integrationsAuthStart,
        messages: [
          {
            role: "assistant",
            content: "@@hypercli.ui-action/v1 integration.connect github",
          },
        ],
      }),
      isSelectedRunning: true,
    });

    fireEvent.click(await screen.findByRole("button", { name: /start connection/i }));

    expect(integrationsAuthStart).toHaveBeenCalledWith({ integrationId: "github", scopes: ["repo", "read:org", "gist"] });
    expect(await screen.findByText("ABCD-1234")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /open github/i })[0]).toHaveAttribute("href", "https://github.com/login/device");
  });

  it("asks the agent to set up GitHub when managed auth is unsupported", async () => {
    const integrationsAuthStart = vi.fn(async () => {
      throw new Error("unknown method: integrations.auth.start");
    });
    const sendMessage = vi.fn(async () => undefined);

    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        integrationsAuthStart,
        sendMessage,
        messages: [
          {
            role: "assistant",
            content: "@@hypercli.ui-action/v1 integration.connect github",
          },
        ],
      }),
      isSelectedRunning: true,
    });

    fireEvent.click(await screen.findByRole("button", { name: /start connection/i }));
    expect(await screen.findByText(/Hold on tight/i)).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Set up GitHub CLI authentication in this workspace."),
      { displayContent: "Set up GitHub in this workspace." },
    );
  });

  it("queues GitHub verification when focus returns during an active setup response", async () => {
    const sendMessage = vi.fn(async () => undefined);
    const props = buildAgentChatPanelProps({
      chat: buildChat({ status: "connected", gatewayConnected: true, ready: true, connected: true, sendMessage }),
      isSelectedRunning: true,
    });
    const { rerender } = renderWithClient(<AgentChatPanel {...props} />);
    fireEvent.click(within(screen.getByTestId("agent-empty-history")).getByRole("button", { name: "Open GitHub setup" }));
    expect(await screen.findByRole("button", { name: /start connection/i })).toBeInTheDocument();

    rerender(
      <AgentChatPanel
        {...props}
        chat={buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        activeSessionSending: true,
        sending: true,
        sendMessage,
        messages: [
          {
            role: "assistant",
            content: "@@hypercli.ui-action/v1 integration.github.device-code 8BCD-83A2 https://github.com/login/device",
          },
          {
            role: "user",
            content: "Waiting for the active setup response.",
          },
        ],
        })}
      />,
    );

    expect(await screen.findByText("8BCD-83A2")).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Check whether GitHub CLI authentication is ready in this workspace."),
      { displayContent: "Check GitHub connection in this workspace." },
    );
  });

  it("keeps GitHub setup automation out of the visible transcript while updating the card", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        messages: [
          {
            role: "assistant",
            content: "@@hypercli.ui-action/v1 integration.connect github",
          },
          {
            role: "user",
            content: "Set up GitHub in this workspace.",
          },
          {
            role: "assistant",
            content: "@@hypercli.ui-action/v1 integration.github.device-code 8BCD-83A2 https://github.com/login/device",
            toolCalls: [
              {
                name: "shell",
                args: "gh auth login --web --git-protocol https",
                result: "Open https://github.com/login/device and enter 8BCD-83A2",
              },
            ],
          },
        ],
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByText("8BCD-83A2")).toBeInTheDocument();
    expect(chatMessageBubbleMock).not.toHaveBeenCalled();
  });

  it("does not hide unrelated messages while GitHub setup messages are present", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        messages: [
          {
            role: "user",
            content: "Set up GitHub in this workspace.",
          },
          {
            role: "assistant",
            content: "Starting auth",
            toolCalls: [{ name: "shell", args: "gh auth status", result: "not logged in" }],
          },
          {
            role: "user",
            content: "Can you check the README while GitHub connects?",
          },
          {
            role: "assistant",
            content: "The repository has no open issues.",
            toolCalls: [{ name: "shell", args: "gh issue list --limit 5", result: "no open issues" }],
          },
        ],
      }),
      isSelectedRunning: true,
    });

    const renderedContents = Array.from(new Set(chatMessageBubbleMock.mock.calls.map(([props]) => (
      props as { message: { content: string } }
    ).message.content)));
    expect(renderedContents).toEqual([
      "Can you check the README while GitHub connects?",
      "The repository has no open issues.",
    ]);
  });

  it("resizes the composer when input changes outside textarea events", async () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
    let setExternalInput: ((value: string) => void) | undefined;

    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        if (this.value.includes("line twelve")) return 240;
        return this.value.includes("\n") ? 124 : 40;
      },
    });

    try {
      const selectedAgent = buildAgent();
      function StatefulAgentChatPanel() {
        const [input, setInput] = useState("");
        setExternalInput = setInput;

        return (
          <AgentChatPanel
            {...buildAgentChatPanelProps({
              selectedAgent,
              chat: buildChat({
                status: "connected",
                gatewayConnected: true,
                ready: true,
                connected: true,
                input,
                setInput,
              }),
              isSelectedRunning: true,
            })}
          />
        );
      }

      renderWithClient(<StatefulAgentChatPanel />);

      const textbox = screen.getByRole("textbox", { name: /message agent/i }) as HTMLTextAreaElement;
      expect(textbox).toHaveStyle({ height: "40px" });

      await act(async () => {
        setExternalInput?.("line one\nline two\nline three");
      });

      expect(textbox).toHaveValue("line one\nline two\nline three");
      expect(textbox).toHaveStyle({ height: "124px" });
      expect(textbox).toHaveStyle({ overflowY: "hidden" });

      const longDraft = [
        ...Array.from({ length: 11 }, (_, index) => `line ${index + 1}`),
        "line twelve",
      ].join("\n");
      await act(async () => {
        setExternalInput?.(longDraft);
      });

      expect(textbox).toHaveValue(longDraft);
      expect(textbox).toHaveStyle({ height: "160px", overflowY: "auto" });

      await act(async () => {
        setExternalInput?.("");
      });

      expect(textbox).toHaveValue("");
      expect(textbox).toHaveStyle({ height: "40px", overflowY: "hidden" });
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", originalScrollHeight);
      } else {
        Reflect.deleteProperty(HTMLTextAreaElement.prototype, "scrollHeight");
      }
    }
  });

  it("recalls previous prompts with up and down arrows", () => {
    renderAgentChatPanelWithInputState({
      initialInput: "unsent draft",
      messages: [
        { role: "user", content: "first prompt" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second prompt" },
      ],
    });

    const textbox = screen.getByRole("textbox", { name: /message agent/i }) as HTMLTextAreaElement;
    expect(textbox).toHaveValue("unsent draft");

    fireEvent.keyDown(textbox, { key: "ArrowUp" });
    expect(textbox).toHaveValue("second prompt");

    fireEvent.keyDown(textbox, { key: "ArrowUp" });
    expect(textbox).toHaveValue("first prompt");

    fireEvent.keyDown(textbox, { key: "ArrowDown" });
    expect(textbox).toHaveValue("second prompt");

    fireEvent.keyDown(textbox, { key: "ArrowDown" });
    expect(textbox).toHaveValue("unsent draft");
  });

  it("leaves multiline arrow movement alone away from textarea edges", () => {
    renderAgentChatPanelWithInputState({
      initialInput: "line one\nline two",
      messages: [
        { role: "user", content: "previous prompt" },
      ],
    });

    const textbox = screen.getByRole("textbox", { name: /message agent/i }) as HTMLTextAreaElement;
    textbox.setSelectionRange(textbox.value.length, textbox.value.length);

    fireEvent.keyDown(textbox, { key: "ArrowUp" });
    expect(textbox).toHaveValue("line one\nline two");

    textbox.setSelectionRange(0, 0);
    fireEvent.keyDown(textbox, { key: "ArrowUp" });
    expect(textbox).toHaveValue("previous prompt");
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
    expect(sendMessage).toHaveBeenCalledWith("Summarize this session so far with decisions, open tasks, and next actions.");
  });

  it("requests access before sending a prompt slash command", async () => {
    const setInput = vi.fn();
    const sendMessage = vi.fn(async () => undefined);
    const onRequestProductUse = vi.fn(() => false);
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
      onRequestProductUse,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(onRequestProductUse).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(setInput).not.toHaveBeenCalledWith("");
  });

  it("requests access before creating a conversation from a slash command", async () => {
    const onNewConversation = vi.fn();
    const onRequestProductUse = vi.fn(() => false);
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/new",
      }),
      isSelectedRunning: true,
      onRequestProductUse,
      slashCommandActions: { onNewConversation },
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(onRequestProductUse).toHaveBeenCalledOnce();
    expect(onNewConversation).not.toHaveBeenCalled();
  });

  it("keeps new agent slash commands exempt from the product-use gate", async () => {
    const onNewAgent = vi.fn();
    const onRequestProductUse = vi.fn(() => false);
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/new-agent",
      }),
      isSelectedRunning: true,
      onRequestProductUse,
      slashCommandActions: { onNewAgent },
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(onRequestProductUse).not.toHaveBeenCalled();
    expect(onNewAgent).toHaveBeenCalledOnce();
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

  it("reports the refreshed session count for the sessions slash command", async () => {
    const refreshSessions = vi.fn(async () => [
      { key: "session-alpha" },
      { key: "session-beta" },
    ] as Awaited<ReturnType<ChatSession["refreshSessions"]>>);
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/sessions",
        sessions: [{ key: "session-stale" }] as ChatSession["sessions"],
        refreshSessions,
      }),
      isSelectedRunning: true,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(refreshSessions).toHaveBeenCalledTimes(1);
    expect(screen.getByText("2 sessions loaded.")).toBeInTheDocument();
  });

  it("reports refreshed session data for the refresh slash command", async () => {
    const refreshSessions = vi.fn(async () => [
      { key: "session-alpha" },
      { key: "session-beta" },
    ] as Awaited<ReturnType<ChatSession["refreshSessions"]>>);
    const retryAndRefreshSessions = vi.fn(async () => [
      { key: "session-alpha" },
      { key: "session-beta" },
      { key: "session-gamma" },
    ] as Awaited<ReturnType<ChatSession["refreshSessions"]>>);
    const refreshCron = vi.fn(async () => undefined);
    const retry = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/refresh",
        sessions: [{ key: "session-stale" }] as ChatSession["sessions"],
        refreshSessions,
        refreshCron,
        retry,
        retryAndRefreshSessions,
      }),
      isSelectedRunning: true,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(retryAndRefreshSessions).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(refreshSessions).not.toHaveBeenCalled();
    expect(refreshCron).not.toHaveBeenCalled();
    expect(screen.getByText("Refresh complete. 3 sessions loaded.")).toBeInTheDocument();
  });

  it("shows workspace file suggestions from @ autocomplete", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "Check @read",
        files: [
          { name: "README.md", size: 1200, missing: false },
          { name: "src/app.tsx", size: 900, missing: false },
        ],
      }),
      isSelectedRunning: true,
    });

    const listbox = screen.getByRole("listbox", { name: /file reference suggestions/i });
    expect(within(listbox).getByRole("option", { name: /README\.md/i })).toBeInTheDocument();
    expect(within(listbox).queryByRole("option", { name: /src\/app\.tsx/i })).not.toBeInTheDocument();
  });

  it("shows uploaded workspace files from external file candidates", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "Check @upload",
        files: [],
      }),
      fileReferenceCandidates: [
        {
          name: "uploaded-report.pdf",
          path: "/home/node/.openclaw/workspace/uploaded-report.pdf",
          type: "application/pdf",
        },
      ],
      isSelectedRunning: true,
    });

    const listbox = screen.getByRole("listbox", { name: /file reference suggestions/i });
    expect(within(listbox).getByRole("option", { name: /uploaded-report\.pdf/i })).toBeInTheDocument();
  });

  it("adds a selected @ file reference as a pending file chip", async () => {
    const setInput = vi.fn();
    const addPendingFiles = vi.fn();
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "Summarize @read",
        setInput,
        addPendingFiles,
        files: [{ name: "README.md", size: 1200, missing: false }],
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(addPendingFiles).toHaveBeenCalledWith([
      {
        name: "README.md",
        path: "/home/node/.openclaw/workspace/README.md",
        type: "text/markdown",
      },
    ]);
    expect(setInput).toHaveBeenCalledWith("Summarize ");
  });

  it("navigates @ file suggestions before completing with Tab", async () => {
    const setInput = vi.fn();
    const addPendingFiles = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "@",
        setInput,
        addPendingFiles,
        files: [
          { name: "alpha.md", size: 10, missing: false },
          { name: "beta.md", size: 20, missing: false },
        ],
      }),
      isSelectedRunning: true,
    });

    const textbox = screen.getByRole("textbox", { name: /message agent/i });
    await act(async () => {
      fireEvent.keyDown(textbox, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(textbox, { key: "Tab" });
    });

    expect(addPendingFiles).toHaveBeenCalledWith([
      {
        name: "beta.md",
        path: "/home/node/.openclaw/workspace/beta.md",
        type: "text/markdown",
      },
    ]);
    expect(setInput).toHaveBeenCalledWith("");
  });

  it("does not intercept @@ markers as file mentions", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "@@hypercli.ui-action",
        files: [{ name: "hypercli.md", size: 10, missing: false }],
      }),
      isSelectedRunning: true,
    });

    expect(screen.queryByRole("listbox", { name: /file reference suggestions/i })).not.toBeInTheDocument();
  });

  it("sends normally when @ autocomplete has no suggestions", async () => {
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "Check @missing",
        files: [{ name: "README.md", size: 1200, missing: false }],
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    expect(screen.queryByRole("listbox", { name: /file reference suggestions/i })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).toHaveBeenCalledTimes(1);
  });

  it("does not open static GitHub setup from the connect slash command", async () => {
    const setInput = vi.fn();
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/connect github",
        setInput,
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(setInput).not.toHaveBeenCalled();
    expect(screen.getAllByText('No available integrations match "github".').length).toBeGreaterThan(0);
    expect(screen.queryByText("Start connection")).not.toBeInTheDocument();
  });

  it("shows integration suggestions after connect slash command space", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/connect ",
        reportedChannels: [channel("telegram"), channel("msteams")],
      }),
      isSelectedRunning: true,
    });

    const listbox = screen.getByRole("listbox", { name: /connect integration suggestions/i });
    expect(within(listbox).getByRole("option", { name: /Telegram/i })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /Microsoft Teams/i })).toBeInTheDocument();
  });

  it("opens selected registry integration from connect slash suggestions", async () => {
    const setInput = vi.fn();
    const onConnectionCta = vi.fn();
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/connect teams",
        setInput,
        reportedChannels: [channel("msteams")],
      }),
      isSelectedRunning: true,
      handleSendChat,
      onConnectionCta,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(onConnectionCta).toHaveBeenCalledWith(expect.objectContaining({
      id: "msteams",
      displayName: "Microsoft Teams",
      directoryPluginId: "msteams",
    }));
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /microsoft teams connection opened/i })).toBeInTheDocument();
  });

  it("opens Telegram setup from the connect slash command", async () => {
    const setInput = vi.fn();
    const onConnectionCta = vi.fn();
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/connect telegram",
        setInput,
        reportedChannels: [channel("telegram")],
      }),
      isSelectedRunning: true,
      handleSendChat,
      onConnectionCta,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(onConnectionCta).not.toHaveBeenCalled();
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /telegram connection opened/i })).toBeInTheDocument();
    expect(await screen.findByText("Start setup")).toBeInTheDocument();
  });

  it("does not send chat when connect slash suggestions have no match", async () => {
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/connect missing",
        reportedChannels: [channel("telegram")],
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(screen.getAllByText('No available integrations match "missing".').length).toBeGreaterThan(0);
  });

  it("opens skills through the slash command menu", async () => {
    const setInput = vi.fn();
    const onOpenSkills = vi.fn();
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/skills",
        setInput,
      }),
      isSelectedRunning: true,
      handleSendChat,
      slashCommandActions: { onOpenSkills },
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(onOpenSkills).toHaveBeenCalledTimes(1);
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /skills opened/i })).toBeInTheDocument();
  });

  it("searches catalog skills from the skill slash command", async () => {
    const search = vi.fn(async () => [{ id: "code-review", name: "Code Review", description: "Review changes before shipping." }]);
    const skillsProvider = {
      ...buildChat().skillsProvider,
      search,
    } satisfies AgentSkillsProvider;
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/skill search review",
        skillsProvider,
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledWith("review", 5);
    expect(screen.getByText(/code-review: Review changes before shipping\./i)).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /1 skill found/i })).toBeInTheDocument();
  });

  it("confirms and installs a catalog skill from chat", async () => {
    const setInput = vi.fn();
    const install = vi.fn(async () => ({ ok: true, skillId: "code-review", message: "Installed Code Review." }));
    const list = vi.fn(async () => []);
    const skillsProvider = {
      ...buildChat().skillsProvider,
      install,
      list,
    } satisfies AgentSkillsProvider;
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/skill install code-review",
        setInput,
        skillsProvider,
      }),
      isSelectedRunning: true,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(screen.getByRole("heading", { name: "Install skill" })).toBeInTheDocument();
    expect(screen.getByText("Install code-review from the skill catalog? This can add files and tools to the agent.")).toBeInTheDocument();
    expect(install).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
    });

    expect(install).toHaveBeenCalledWith({ source: "registry", id: "code-review" });
    expect(list).toHaveBeenCalledTimes(1);
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /installed code review/i })).toBeInTheDocument();
  });

  it("clears the source composer before the new session callback resolves", async () => {
    const setInput = vi.fn();
    let resolveNewConversation!: () => void;
    const onNewConversation = vi.fn(() => new Promise<void>((resolve) => {
      resolveNewConversation = resolve;
    }));
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
    expect(screen.queryByRole("status", { name: /new session opened/i })).not.toBeInTheDocument();

    await act(async () => {
      resolveNewConversation();
    });

    expect(screen.getByRole("status", { name: /new session opened/i })).toBeInTheDocument();
  });

  it("restores the source slash draft when new session creation fails", async () => {
    const onNewConversation = vi.fn(async () => {
      throw new Error("Could not create conversation");
    });

    function StatefulNewSessionChat() {
      const [input, setInput] = useState("/new");
      return (
        <AgentChatPanel
          {...buildAgentChatPanelProps({
            chat: buildChat({
              status: "connected",
              gatewayConnected: true,
              ready: true,
              connected: true,
              input,
              setInput,
            }),
            isSelectedRunning: true,
            slashCommandActions: { onNewConversation },
          })}
        />
      );
    }
    renderWithClient(<StatefulNewSessionChat />);

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(onNewConversation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox", { name: /message agent/i })).toHaveValue("/new");
    expect(screen.getByRole("status", { name: /could not create conversation/i })).toBeInTheDocument();
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

  it("does not present STOPPING as stopped or allow a restart during cleanup", async () => {
    const onStartAgent = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({ input: "/" }),
      selectedAgent: buildAgent("STOPPING"),
      isSelectedRunning: false,
      slashCommandActions: { onStartAgent },
    });

    const startCommand = screen.getByRole("option", { name: /\/start/i });
    expect(startCommand).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(startCommand);
    });

    expect(screen.getAllByText("Agent cleanup is still in progress.")).toHaveLength(2);
    expect(onStartAgent).not.toHaveBeenCalled();
    expect(agentLifecycleLabel("STOPPING", false)).toBe("stopping");
  });

  it("does not expose start until a failed agent is cleaned up", async () => {
    const onStartAgent = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({ input: "/" }),
      selectedAgent: toAgentViewModel(buildSdkAgent({ state: "FAILED" })),
      isSelectedRunning: false,
      slashCommandActions: { onStartAgent },
    });

    const startCommand = screen.getByRole("option", { name: /\/start/i });
    expect(startCommand).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(startCommand);
    });

    expect(screen.getAllByText("Agent is failed.")).toHaveLength(2);
    expect(onStartAgent).not.toHaveBeenCalled();
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
    expect(screen.getByRole("status", { name: /scheduled work is coming soon/i })).toBeInTheDocument();
  });

  it("does not stage schedule slash command text while the manager is under review", async () => {
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

    expect(onOpenScheduled).toHaveBeenCalledWith();
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /scheduled work is coming soon/i })).toBeInTheDocument();
  });

  it("blocks scheduled job mutations from slash commands while the manager is under review", async () => {
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
    expect(screen.queryByRole("heading", { name: "Run scheduled job" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Scheduled work is coming soon.")).toHaveLength(2);
    expect(runCron).not.toHaveBeenCalled();
    expect(refreshCron).not.toHaveBeenCalled();
    expect(setInput).not.toHaveBeenCalled();

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
    expect(screen.queryByRole("heading", { name: "Remove scheduled job" })).not.toBeInTheDocument();
    expect(removeCron).not.toHaveBeenCalled();
    expect(refreshCron).not.toHaveBeenCalled();
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

  it("uses /stop to abort the active reply without stopping the agent", async () => {
    const abortMessage = vi.fn(async () => undefined);
    const onStopAgent = vi.fn(async () => undefined);
    const setInput = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        input: "/stop",
        setInput,
        abortMessage,
      }),
      isSelectedRunning: true,
      slashCommandActions: { onStopAgent },
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(abortMessage).toHaveBeenCalledTimes(1);
    expect(onStopAgent).not.toHaveBeenCalled();
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.queryByRole("heading", { name: "Stop agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: /stop requested/i })).toBeInTheDocument();
  });

  it("disables /stop when the active session has no reply to stop", async () => {
    const abortMessage = vi.fn(async () => undefined);
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: false,
        input: "/stop",
        abortMessage,
      }),
      isSelectedRunning: true,
    });

    const stopCommand = screen.getByRole("option", { name: /\/stop/i });
    expect(stopCommand).toHaveAttribute("aria-disabled", "true");
    expect(stopCommand).toHaveTextContent("No reply is currently running.");

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(abortMessage).not.toHaveBeenCalled();
    expect(screen.getAllByText("No reply is currently running.")).toHaveLength(2);
  });

  it("stops the current reply when Escape is pressed in the composer", () => {
    const abortMessage = vi.fn(async () => undefined);
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        input: "/summary",
        abortMessage,
      }),
      isSelectedRunning: true,
    });

    fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Escape" });

    expect(abortMessage).toHaveBeenCalledTimes(1);
  });

  it("does not show response status or stop controls for another session's reply", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: false,
        messages: [{ role: "user", content: "Question in this session" }],
      }),
      isSelectedRunning: true,
    });

    expect(screen.queryByRole("status", {
      name: /starting response|still working|working through|using tools|receiving response|waiting for final response/i,
    })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop reply/i })).not.toBeInTheDocument();
  });

  it("shows response progress and stop controls for the active session's reply", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        messages: [{ role: "user", content: "Question in this session" }],
      }),
      isSelectedRunning: true,
    });

    const status = screen.getByRole("status", { name: /starting response/i });
    expect(status).toHaveTextContent("Still with you, working with care · just started");
    expect(status).toHaveAttribute("data-description-on-hover", "true");
    expect(screen.getByRole("button", { name: /stop reply/i })).toBeInTheDocument();
  });

  it("keeps response measurements to a warm elapsed-time detail", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        messages: [{
          role: "assistant",
          content: "I checked the available channels.",
          toolCalls: [{ name: "web_search", args: "{}", result: "Search complete" }],
        }],
      }),
      isSelectedRunning: true,
    });

    const status = screen.getByRole("status", { name: /receiving response/i });
    expect(status).toHaveTextContent("Still with you, working with care");
    expect(status).not.toHaveTextContent("characters received");
    expect(status).not.toHaveTextContent("updated");
  });

  it("reports active tool work while a tool call is pending", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        messages: [{
          role: "assistant",
          content: "",
          toolCalls: [{ name: "web_search", args: "{}" }],
        }],
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("status", { name: /using tools/i })).toHaveTextContent("Still with you, working with care");
  });

  it("reports reasoning activity without exposing its contents", () => {
    const hiddenThinking = "Private chain-of-thought details";
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        messages: [
          { role: "user", content: "Compare the options" },
          { role: "assistant", content: "", thinking: hiddenThinking },
        ],
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("status", { name: /working through your request/i })).toBeInTheDocument();
    expect(screen.queryByText(hiddenThinking)).not.toBeInTheDocument();
  });

  it("lets the inline provider-reasoning disclosure replace the generic response status", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        messages: [
          { role: "user", content: "Compare the options" },
          {
            role: "assistant",
            content: "",
            reasoning: { text: "Comparing the available options", state: "active", startedAt: 1 },
          },
        ],
      }),
      isSelectedRunning: true,
    });

    expect(screen.queryByRole("status", { name: /starting response|working through your request/i })).not.toBeInTheDocument();
    const assistantProps = chatMessageBubbleMock.mock.calls.at(-1)?.[0] as {
      message: { reasoning?: { text: string; state: string } };
    };
    expect(assistantProps.message.reasoning).toEqual({
      text: "Comparing the available options",
      state: "active",
      startedAt: 1,
    });
  });

  it("shows only a warm elapsed-time detail for a long response", () => {
    const now = new Date("2026-08-04T16:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const content = "a".repeat(10_250);

    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        messages: [
          { role: "user", content: "Write a long report", timestamp: now.getTime() - 25_000 },
          { role: "assistant", content, timestamp: now.getTime() - 1_000 },
        ],
      }),
      isSelectedRunning: true,
    });

    const status = screen.getByRole("status", { name: /receiving response/i });
    expect(status).toHaveTextContent("Still with you, working with care · 25s elapsed");
    expect(status).not.toHaveTextContent("characters received");
    expect(status).not.toHaveTextContent("updated");
    expect(status).toHaveAttribute("data-description-on-hover", "true");
  });

  it("reassures users when the first response update takes longer", () => {
    const now = new Date("2026-08-04T16:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        messages: [{ role: "user", content: "Analyze this", timestamp: now.getTime() }],
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("status", { name: /starting response/i })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("status", { name: /still working/i })).toHaveTextContent("Still with you, working with care · 10s elapsed");
  });

  it("shows a separate stop button while keeping send available for queued drafts", () => {
    const abortMessage = vi.fn(async () => undefined);
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        input: "queue this next",
        abortMessage,
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    fireEvent.click(screen.getByRole("button", { name: /stop reply/i }));
    expect(abortMessage).toHaveBeenCalledTimes(1);

    const sendButton = screen.getByRole("button", { name: "Send message" });
    expect(sendButton).not.toBeDisabled();
    fireEvent.click(sendButton);
    expect(handleSendChat).toHaveBeenCalledTimes(1);
  });

  it("shows stopping feedback while an abort request is pending", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        aborting: true,
        activeSessionAborting: true,
        input: "queue this next",
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("status", { name: /stopping reply/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stopping reply/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).not.toBeDisabled();
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
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("keeps a workspace upload visible and blocks sending until it is attached", () => {
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "Review the attached document",
      }),
      chatFilesUploading: true,
      chatFileUploadProgress: { completed: 37, total: 100, label: "Preparing 100 images" },
      handleSendChat,
      isSelectedRunning: true,
    });

    expect(screen.getByRole("status", { name: /uploading workspace files/i })).toBeInTheDocument();
    expect(screen.getByText("Preparing 100 images")).toBeInTheDocument();
    expect(screen.getByText("37/100")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /file upload progress/i })).toHaveAttribute("aria-valuenow", "37");
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    expect(handleSendChat).not.toHaveBeenCalled();
  });

  it("delegates staged collection removal so its workspace files can be cleaned up", () => {
    const pendingFile = {
      name: "image-collection-100.json",
      path: "/workspace/image-collection-100.json",
      type: "application/json",
      imageCollection: {
        count: 100,
        manifestPath: "/workspace/image-collection-100.json",
        manifestUploadPath: ".openclaw/workspace/image-collection-100.json",
        uploadPaths: [],
      },
    };
    const onRemovePendingFile = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        pendingFiles: [pendingFile],
      }),
      onRemovePendingFile,
      isSelectedRunning: true,
    });

    expect(screen.getByText("100 images")).toBeInTheDocument();
    expect(screen.queryByText("image-collection-100.json")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove 100-image collection" }));
    expect(onRemovePendingFile).toHaveBeenCalledWith(0, pendingFile);
  });

  it("blocks sending a collection whose cleanup failed and offers a retry", () => {
    const pendingFile = {
      name: "image-collection-100.json",
      path: "/workspace/image-collection-100.json",
      type: "application/json",
      imageCollection: {
        count: 100,
        manifestPath: "/workspace/image-collection-100.json",
        manifestUploadPath: ".openclaw/workspace/image-collection-100.json",
        uploadPaths: [],
      },
    };
    const onRemovePendingFile = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "Compare these images",
        pendingFiles: [pendingFile],
      }),
      pendingFileRemovalStates: { [pendingFile.path]: "failed" },
      onRemovePendingFile,
      isSelectedRunning: true,
    });

    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry removing 100-image collection" }));
    expect(onRemovePendingFile).toHaveBeenCalledWith(0, pendingFile);
  });

  it("routes pasted images through the same large-drop handler", () => {
    const chat = buildChat({
      status: "connected",
      gatewayConnected: true,
      ready: true,
      connected: true,
    });
    const handleChatFileDrop = vi.fn();
    renderAgentChatPanel({ chat, handleChatFileDrop, isSelectedRunning: true });
    const image = new File(["image"], "pasted.png", { type: "image/png" });

    fireEvent.paste(screen.getByRole("textbox", { name: /message agent/i }), {
      clipboardData: {
        items: [{ type: "image/png", getAsFile: () => image }],
      },
    });

    expect(handleChatFileDrop).toHaveBeenCalledTimes(1);
    expect(handleChatFileDrop.mock.calls[0]?.[0]).toHaveLength(1);
    expect(chat.addAttachments).not.toHaveBeenCalled();
  });

  it("does not flash the textarea while a stopped recording becomes a preview", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "draft text",
      }),
      preparingAudioPreview: true,
      isSelectedRunning: true,
    });

    expect(screen.getByRole("status", { name: /preparing voice message/i })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /message agent/i })).not.toBeInTheDocument();
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
    const { container, rerender } = renderWithClient(<AgentChatPanel {...props} />);

    expect(screen.getByText("Loading workspace")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="agent-startup-tips"]')).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();

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
    expect(container.querySelector('[data-slot="agent-startup-tips"]')).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /agent workspace loading/i })).not.toBeInTheDocument();
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
    expect(screen.getByRole("textbox", { name: /message agent/i })).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(180);
    });

    expect(screen.getByRole("textbox", { name: /message agent/i })).toBeEnabled();
  });

  it("shows the retry action when the gateway reports an error", () => {
    const retry = vi.fn();
    const longError = "Gateway handshake failed because this dashboard origin is not present in the agent allowlist. The full explanation must remain readable without clipping.";
    renderAgentChatPanel({
      chat: buildChat({
        error: longError,
        retry,
      }),
      isSelectedRunning: true,
    });

    const alert = screen.getByRole("alert", { name: /try again to reconnect the agent connection was interrupted/i });
    fireEvent.click(within(alert).getByRole("button", { name: "What happened" }));
    const detail = within(alert).getByText(longError);
    expect(detail).toBeVisible();
    expect(detail).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(detail).not.toHaveClass("truncate");
    const retryButton = screen.getByRole("button", { name: /retry/i });
    expect(retryButton).toBeVisible();
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("keeps Retry available for a contextual gateway origin error", () => {
    const retry = vi.fn();
    const onStopAgent = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        error: "This agent allows connections from https://agents.hypercli.com, but you opened it from https://agents.feat.hypercli.com. Did you create it from the other dashboard?",
        retry,
      }),
      isSelectedRunning: true,
      slashCommandActions: {
        onStopAgent,
      },
    });

    const alert = screen.getByRole("alert", { name: /try again to reconnect the agent connection was interrupted/i });
    fireEvent.click(within(alert).getByRole("button", { name: "What happened" }));
    expect(within(alert).getByText(/agents\.hypercli\.com.*agents\.feat\.hypercli\.com/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /stop agent/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(onStopAgent).not.toHaveBeenCalled();
  });

  it("renders a progress-only assistant row for working commentary instead of dropping it", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        activeSessionSending: true,
        messages: [
          { role: "user", content: "Check the deployment" },
          {
            role: "assistant",
            content: "",
            progress: { text: "Checking the deployment target", state: "active", revisions: ["Checking the deployment target"] },
          },
        ],
      }),
      isSelectedRunning: true,
    });

    const renderedMessages = chatMessageBubbleMock.mock.calls.map(([props]) => props);
    const progressRow = renderedMessages.find((props: any) => props.message?.progress?.text === "Checking the deployment target");
    expect(progressRow).toBeDefined();
    expect(screen.queryByRole("status", { name: /starting response/i })).not.toBeInTheDocument();
  });

  it("keeps commentary-bearing rows on a single stable render key across progress updates", () => {
    const baseChat = buildChat({
      status: "connected",
      gatewayConnected: true,
      ready: true,
      connected: true,
      sending: true,
      activeSessionSending: true,
      messages: [
        { role: "user", content: "Check the deployment", renderId: "turn-1:user" },
        {
          role: "assistant",
          content: "",
          renderId: "turn-1:assistant",
          progress: { text: "Checking the deployment target", state: "active", revisions: ["Checking the deployment target"] },
        },
      ],
    });
    const firstRender = renderAgentChatPanel({ chat: baseChat, isSelectedRunning: true });
    chatMessageBubbleMock.mockClear();

    baseChat.messages = [
      baseChat.messages[0]!,
      {
        ...baseChat.messages[1]!,
        progress: { text: "Checking the deployment target and routes", state: "active" as const, revisions: ["Checking the deployment target"] },
      },
    ];
    firstRender.rerender(<AgentChatPanel {...buildAgentChatPanelProps({ chat: baseChat })} />);

    const renderedRowKeys = chatMessageBubbleMock.mock.calls.map(([props]) => props.message?.renderId);
    expect(renderedRowKeys.filter((key) => key === "turn-1:assistant")).toHaveLength(1);
  });
});
