import { createRef, useState, type ComponentProps } from "react";
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
    abortMessage: vi.fn(async () => undefined),
    aborting: false,
    input: "",
    setInput: vi.fn(),
    pendingInput: [],
    addPendingMessage: vi.fn(),
    activeSessionKey: "main",
    activeSessionReadOnly: false,
    activeSessionReadOnlyReason: null,
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
    skillsStatus: vi.fn(async () => ({ workspaceDir: "/workspace", managedSkillsDir: "/app/skills", skills: [] })),
    skillsSearch: vi.fn(async () => ({ results: [] })),
    skillsDetail: vi.fn(async () => ({ skill: null })),
    skillsSecurityVerdicts: vi.fn(async () => ({ schema: "openclaw.skills.security-verdicts.v1", items: [] })),
    skillsSkillCard: vi.fn(async () => ({ schema: "openclaw.skills.skill-card.v1", skillKey: "test", path: "/app/skills/test/SKILL.md", sizeBytes: 0, content: "" })),
    skillsInstall: vi.fn(async () => ({ ok: true })),
    skillsUpdate: vi.fn(async () => ({ ok: true, skillKey: "test", config: {} })),
    integrationsAuthStart: vi.fn(async () => ({ authId: "auth-1" })),
    integrationsAuthStatus: vi.fn(async () => ({ status: "pending" })),
    integrationsStatus: vi.fn(async () => ({ integrations: { github: { configured: false, authenticated: false, usable: false } } })),
    integrationsDisconnect: vi.fn(async () => ({ ok: true })),
    retry: vi.fn(),
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
    expect(screen.getAllByTitle("Telegram conversations are read-only here. Reply from Telegram.")[0]).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTitle("Send message")).toBeDisabled();
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

  it("renders GitHub connector cards from assistant UI action metadata", async () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        configSchema: schemaWith("integrations.github"),
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

  it("opens a GitHub connector card from the composer suggestion", async () => {
    const onConnectionCta = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "connect github",
        configSchema: schemaWith("integrations.github"),
      }),
      isSelectedRunning: true,
      onConnectionCta,
    });

    fireEvent.click(screen.getByTitle("Open GitHub connection setup"));

    const startConnection = await screen.findByText("Start connection");
    expect(startConnection).toBeInTheDocument();
    const composerShell = closestClassNameContaining(screen.getByRole("textbox", { name: /message agent/i }), "max-h-[45%]");
    expect(composerShell).not.toBeNull();
    expect(composerShell?.contains(startConnection)).toBe(false);
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
        configSchema: schemaWith("channels.telegram"),
      }),
      isSelectedRunning: true,
      onConnectionCta,
    });

    fireEvent.click(screen.getByTitle("Open Telegram connection setup"));

    expect(await screen.findByText("Start setup")).toBeInTheDocument();
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
    expect(await screen.findByText("Create bot")).toBeInTheDocument();
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

    const renderedContents = chatMessageBubbleMock.mock.calls.map(([props]) => (
      props as { message: { content: string } }
    ).message.content);
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

      await act(async () => {
        setExternalInput?.("");
      });

      expect(textbox).toHaveValue("");
      expect(textbox).toHaveStyle({ height: "40px" });
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", originalScrollHeight);
      } else {
        delete (HTMLTextAreaElement.prototype as Partial<HTMLTextAreaElement>).scrollHeight;
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

  it("opens GitHub setup from the connect slash command", async () => {
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
        configSchema: schemaWith("integrations.github"),
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /github connection opened/i })).toBeInTheDocument();
    expect(await screen.findByText("Start connection")).toBeInTheDocument();
  });

  it("shows integration suggestions after connect slash command space", () => {
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/connect ",
        configSchema: schemaWith("channels.telegram", "plugins.entries.openai"),
      }),
      isSelectedRunning: true,
    });

    const listbox = screen.getByRole("listbox", { name: /connect integration suggestions/i });
    expect(within(listbox).getByRole("option", { name: /Telegram/i })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: /OpenAI/i })).toBeInTheDocument();
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
        input: "/connect open",
        setInput,
        configSchema: schemaWith("plugins.entries.openai"),
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
      id: "openai",
      displayName: "OpenAI",
      directoryPluginId: "openai",
    }));
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /openai connection opened/i })).toBeInTheDocument();
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
        configSchema: schemaWith("channels.telegram"),
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
        configSchema: schemaWith("channels.telegram"),
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

  it("searches ClawHub skills from the skill slash command", async () => {
    const skillsSearch = vi.fn(async () => ({
      results: [
        {
          score: 1,
          slug: "code-review",
          displayName: "Code Review",
          summary: "Review changes before shipping.",
        },
      ],
    }));
    const handleSendChat = vi.fn();
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/skill search review",
        skillsSearch,
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(handleSendChat).not.toHaveBeenCalled();
    expect(skillsSearch).toHaveBeenCalledWith({ query: "review", limit: 5 });
    expect(screen.getByText(/code-review: Review changes before shipping\./i)).toBeInTheDocument();
    expect(screen.getByRole("status", { name: /1 skill found/i })).toBeInTheDocument();
  });

  it("confirms and installs a ClawHub skill from chat", async () => {
    const setInput = vi.fn();
    const skillsInstall = vi.fn(async () => ({ ok: true, slug: "code-review", message: "Installed Code Review." }));
    const skillsStatus = vi.fn(async () => ({ workspaceDir: "/workspace", managedSkillsDir: "/app/skills", skills: [] }));
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        input: "/skill install code-review",
        setInput,
        skillsInstall,
        skillsStatus,
      }),
      isSelectedRunning: true,
    });

    await act(async () => {
      fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Enter" });
    });

    expect(screen.getByRole("heading", { name: "Install skill" })).toBeInTheDocument();
    expect(screen.getByText("Install code-review from ClawHub? This can add files and tools to the workspace.")).toBeInTheDocument();
    expect(skillsInstall).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Install" }));
    });

    expect(skillsInstall).toHaveBeenCalledWith({ source: "clawhub", slug: "code-review" });
    expect(skillsStatus).toHaveBeenCalledTimes(1);
    expect(setInput).toHaveBeenCalledWith("");
    expect(screen.getByRole("status", { name: /installed code review/i })).toBeInTheDocument();
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

  it("stops the current reply when Escape is pressed in the composer", () => {
    const abortMessage = vi.fn(async () => undefined);
    renderAgentChatPanel({
      chat: buildChat({
        status: "connected",
        gatewayConnected: true,
        ready: true,
        connected: true,
        sending: true,
        input: "/summary",
        abortMessage,
      }),
      isSelectedRunning: true,
    });

    fireEvent.keyDown(screen.getByRole("textbox", { name: /message agent/i }), { key: "Escape" });

    expect(abortMessage).toHaveBeenCalledTimes(1);
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
        input: "queue this next",
        abortMessage,
      }),
      isSelectedRunning: true,
      handleSendChat,
    });

    fireEvent.click(screen.getByRole("button", { name: /stop reply/i }));
    expect(abortMessage).toHaveBeenCalledTimes(1);

    const sendButton = screen.getByTitle("Send message");
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
        aborting: true,
        input: "queue this next",
      }),
      isSelectedRunning: true,
    });

    expect(screen.getByRole("status", { name: /stopping reply/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stopping reply/i })).toBeDisabled();
    expect(screen.getByTitle("Send message")).not.toBeDisabled();
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
