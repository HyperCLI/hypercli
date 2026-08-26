import { describe, expect, it, vi } from "vitest";

import { handleOpenClawChatStreamEvent, handleOpenClawSessionEvent, hydrateOpenClawHistory, hydrateOpenClawSession, refreshOpenClawChatMessages } from "./openclaw-session";
import { OPENCLAW_EMPTY_REPLY_NOTICE, type ChatMessage } from "./openclaw-chat";
import { OPENCLAW_INTERNAL_SESSION_KEY, createOpenClawDashboardSessionKey } from "./openclaw-session-key";

const THINKING_LEAK_SENTINEL = "DO_NOT_RENDER_THINKING_SENTINEL";
const TOOL_ARG_LEAK_SENTINEL = "DO_NOT_RENDER_TOOL_ARG_SENTINEL";
const TOOL_RESULT_LEAK_SENTINEL = "DO_NOT_RENDER_TOOL_RESULT_SENTINEL";
const EMPTY_REPLY_FAILURE_TEXT = "I finished the turn, but it did not produce a visible reply. Please try again, or start a new session if this keeps happening.";
const WORKSPACE_PATH_DUMP = [
  "/home/node/.openclaw/workspace",
  "/home/node/.openclaw/workspace/.openclaw",
  "/home/node/.openclaw/workspace/.git",
  "/home/node/.openclaw/workspace/.git/refs",
  "/home/node/.openclaw/workspace/.git/hooks",
  "/home/node/.openclaw/workspace/state",
].join(" ");
const RESPONSES_STYLE_TOOL_RICH_MESSAGE = {
  role: "assistant",
  content: [
    {
      type: "reasoning",
      summary: [{ text: THINKING_LEAK_SENTINEL }],
    },
    {
      type: "function_call",
      call_id: "call-1",
      name: "list",
      arguments: { path: "/home/node/.openclaw/workspace", marker: TOOL_ARG_LEAK_SENTINEL },
    },
    {
      type: "function_call_output",
      call_id: "call-1",
      output: `${WORKSPACE_PATH_DUMP} ${TOOL_RESULT_LEAK_SENTINEL}`,
    },
    {
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "The main folders are `.openclaw`, `.git`, and `state`.",
        },
      ],
    },
  ],
};
const MESSAGE_WRAPPER_WITH_OUTPUT = {
  type: "message",
  role: "assistant",
  content: "message",
  output: [
    {
      type: "output_text",
      text: "There is no README file in the workspace.",
    },
  ],
};
const README_TOOL_OUTPUT_ONLY_MESSAGE = {
  role: "assistant",
  content: [
    {
      type: "tool_result",
      name: "list",
      text: [
        "No - there's no README.",
        "The workspace currently has these files:",
        "",
        "AGENTS.md",
        "BOOTSTR",
        "TOOLS.md",
        "USER.md",
      ].join("\n"),
    },
  ],
};
const README_OUTPUT_WITH_COMMAND_STATUS = {
  role: "assistant",
  content: "Command exited with code 1",
  output: [
    {
      type: "output_text",
      text: [
        "No - there's no README.",
        "The workspace currently has these files:",
        "",
        "AGENTS.md",
        "BOOTSTR",
        "TOOLS.md",
        "USER.md",
      ].join("\n"),
    },
  ],
};
const README_REFRESH_HISTORY = [
  {
    role: "user",
    content: [
      {
        type: "text",
        text: "Look at the workspace files and tell me if there is a README.",
      },
    ],
  },
  {
    role: "assistant",
    content: [
      {
        type: "thinking",
        thinking: THINKING_LEAK_SENTINEL,
      },
      {
        type: "text",
        text: " ",
      },
      {
        type: "toolCall",
        id: "functions.exec:0",
        name: "exec",
        arguments: {
          command: "ls -la /home/node/.openclaw/workspace/ | grep -i readme",
        },
      },
    ],
  },
  {
    role: "toolResult",
    toolCallId: "functions.exec:0",
    toolName: "exec",
    content: [
      {
        type: "text",
        text: "\n\n(Command exited with code 1)",
      },
    ],
  },
  {
    role: "assistant",
    content: [
      {
        type: "thinking",
        thinking: "No README file exists in the workspace.",
      },
      {
        type: "text",
        text: " There is no README file in the workspace. The files present are:\n\n- `AGENTS.md`\n- `BOOTSTRAP.md`\n- `HEARTBEAT.md`\n- `IDENTITY.md`\n- `SOUL.md`\n- `TOOLS.md`\n- `USER.md`",
      },
    ],
  },
];

describe("openclaw session keys", () => {
  it("keeps OpenClaw's internal root session named main", () => {
    expect(OPENCLAW_INTERNAL_SESSION_KEY).toBe("main");
  });

  it("creates dashboard session keys without deployment ids or main", () => {
    const key = createOpenClawDashboardSessionKey([
      "dashboard:550e8400-e29b-41d4-a716-446655440000",
    ]);

    expect(key).toMatch(/^dashboard:[0-9a-f-]+$/i);
    expect(key).not.toBe("main");
    expect(key).not.toContain("agent-123");
    expect(key).not.toContain("550e8400-e29b-41d4-a716-446655440000");
  });

  it("uses the canonical gateway file agent id before probing legacy workspaces", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => []),
      agentsList: vi.fn(async () => [
        { id: "550e8400-e29b-41d4-a716-446655440000" },
        { id: "main" },
      ]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "550e8400-e29b-41d4-a716-446655440000");

    expect(gateway.chatHistory).toHaveBeenCalledWith("main", 200);
    expect(gateway.chatHistory).toHaveBeenCalledTimes(1);
    expect(gateway.filesList).toHaveBeenCalledWith("main");
    expect(hydrated.gwAgentId).toBe("main");
  });

  it("does not probe unadvertised deployment workspaces when canonical files are empty", async () => {
    const deploymentId = "550e8400-e29b-41d4-a716-446655440000";
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => []),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async (agentId: string) => {
        if (agentId === "main") return [];
        throw new Error(`Unexpected legacy workspace probe: ${agentId}`);
      }),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, deploymentId);

    expect(gateway.filesList).toHaveBeenCalledTimes(1);
    expect(gateway.filesList).toHaveBeenCalledWith("main");
    expect(hydrated.files).toEqual([]);
    expect(hydrated.gwAgentId).toBe("main");
  });

  it("falls back to legacy deployment-scoped chat history when canonical history is empty", async () => {
    const deploymentId = "550e8400-e29b-41d4-a716-446655440000";
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async (sessionKey: string) => (
        sessionKey === `agent:${deploymentId}:main`
          ? [{ role: "assistant", content: "Recovered history" }]
          : []
      )),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => [{ id: `agent:${deploymentId}:main` }]),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, deploymentId);

    expect(gateway.chatHistory).toHaveBeenCalledWith("main", 200);
    expect(gateway.chatHistory).toHaveBeenCalledWith(`agent:${deploymentId}:main`, 200);
    expect(hydrated.messages).toEqual([expect.objectContaining({
      role: "assistant",
      content: "Recovered history",
    })]);
    expect(hydrated.gwAgentId).toBe("main");
  });

  it("hydrates refreshed chat history without thinking or tool-call leakage", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: `Internal plan: ${THINKING_LEAK_SENTINEL}`,
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
              text: `Internal output: ${TOOL_RESULT_LEAK_SENTINEL}`,
            },
            {
              type: "text",
              text: "Only this answer should hydrate.",
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_call",
              name: "read",
              args: { marker: TOOL_ARG_LEAK_SENTINEL },
            },
          ],
        },
      ]),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "agent-123");

    expect(hydrated.messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "Only this answer should hydrate.",
      }),
    ]);
    expect(hydrated.messages[0]?.thinking).toBeUndefined();
    expect(hydrated.messages[0]?.toolCalls).toBeUndefined();
    const serialized = JSON.stringify(hydrated.messages);
    expect(serialized).not.toContain(THINKING_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_ARG_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_RESULT_LEAK_SENTINEL);
  });

  it("hydrates an active gateway run and its buffered partial response", async () => {
    const gateway = {
      sessionsList: vi.fn(async () => [{
        key: "session-alpha",
        status: "running",
        hasActiveRun: true,
        activeRunIds: ["run-reload"],
      }]),
      chatHistory: vi.fn(async () => []),
      chatHistoryResult: vi.fn(async () => ({
        messages: [{ role: "user", content: "Long-running request" }],
        sessionInfo: {
          status: "running",
          hasActiveRun: true,
          activeRunIds: ["run-reload"],
        },
        inFlightRun: { runId: "run-reload", text: "Buffered partial response" },
      })),
    };

    const hydrated = await hydrateOpenClawHistory(gateway as any, "deploy-123", "session-alpha");

    expect(hydrated).toEqual(expect.objectContaining({
      hasActiveRun: true,
      activeRunIds: ["run-reload"],
      inFlightRun: { runId: "run-reload", text: "Buffered partial response" },
    }));
    expect(hydrated.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Long-running request" }),
      expect.objectContaining({ role: "assistant", content: "Buffered partial response", runId: "run-reload" }),
    ]);
  });

  it("appends only the unpersisted tail of a multi-segment active response", async () => {
    const gateway = {
      sessionsList: vi.fn(async () => [{ key: "session-alpha" }]),
      chatHistory: vi.fn(async () => []),
      chatHistoryResult: vi.fn(async () => ({
        messages: [
          { role: "user", content: "Inspect the workspace" },
          { role: "assistant", content: "First segment. ", runId: "run-reload" },
          { role: "assistant", content: "Second segment.", runId: "run-reload" },
        ],
        sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-reload"] },
        inFlightRun: {
          runId: "run-reload",
          text: "First segment. Second segment. Buffered tail.",
        },
      })),
    };

    const hydrated = await hydrateOpenClawHistory(gateway as any, "deploy-123", "session-alpha");

    expect(hydrated.messages.map((message) => message.content)).toEqual([
      "Inspect the workspace",
      "First segment.",
      "Second segment. Buffered tail.",
    ]);
  });

  it("preserves the exact sentence boundary when an active run tail resumes a persisted segment", async () => {
    const gateway = {
      sessionsList: vi.fn(async () => [{ key: "session-alpha" }]),
      chatHistory: vi.fn(async () => []),
      chatHistoryResult: vi.fn(async () => ({
        messages: [
          { role: "user", content: "Revisa los logos" },
          { role: "assistant", content: "Déjame revisar. ", runId: "run-reload" },
        ],
        sessionInfo: { status: "running", hasActiveRun: true, activeRunIds: ["run-reload"] },
        inFlightRun: {
          runId: "run-reload",
          text: "Déjame revisar. Tenemos dos logos 1080×1080 con transparencia.",
        },
      })),
    };

    const hydrated = await hydrateOpenClawHistory(gateway as any, "deploy-123", "session-alpha");

    expect(hydrated.messages.map((message) => message.content)).toEqual([
      "Revisa los logos",
      "Déjame revisar. Tenemos dos logos 1080×1080 con transparencia.",
    ]);
    expect(hydrated.messages[1]).toEqual(expect.objectContaining({
      role: "assistant",
      runId: "run-reload",
    }));
  });

  it("keeps the final output_text answer from refreshed tool-rich history", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => [
        {
          role: "user",
          content: "Inspect the project structure and summarize the main folders.",
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "list",
              arguments: { path: "/workspace", marker: TOOL_ARG_LEAK_SENTINEL },
            },
            {
              type: "tool_result",
              id: "tool-1",
              name: "list",
              text: `app\ncomponents\n${TOOL_RESULT_LEAK_SENTINEL}`,
            },
            {
              type: "output_text",
              text: "The main folders are app, components, and lib.",
            },
          ],
        },
      ]),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "agent-123");

    expect(hydrated.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Inspect the project structure and summarize the main folders.",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "The main folders are app, components, and lib.",
      }),
    ]);
    expect(hydrated.messages[1]?.toolCalls).toBeUndefined();
    const serialized = JSON.stringify(hydrated.messages);
    expect(serialized).not.toContain(TOOL_ARG_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_RESULT_LEAK_SENTINEL);
  });

  it("keeps the final nested Responses API answer from refreshed tool-rich history", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => [
        {
          role: "user",
          content: "Inspect the project structure and summarize the main folders.",
        },
        RESPONSES_STYLE_TOOL_RICH_MESSAGE,
      ]),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "agent-123");

    expect(hydrated.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Inspect the project structure and summarize the main folders.",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "The main folders are `.openclaw`, `.git`, and `state`.",
      }),
    ]);
    const serialized = JSON.stringify(hydrated.messages);
    expect(serialized).not.toContain(THINKING_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_ARG_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_RESULT_LEAK_SENTINEL);
    expect(serialized).not.toContain("/home/node/.openclaw/workspace/.git/refs");
  });

  it("uses the final nested Responses API answer from chatSend done events", () => {
    let messages: ChatMessage[] = [
      {
        role: "user",
        content: "Inspect the project structure and summarize the main folders.",
        timestamp: 1,
      },
    ];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawChatStreamEvent({
      chatEvent: {
        type: "done",
        data: { message: RESPONSES_STYLE_TOOL_RICH_MESSAGE },
      } as any,
      setMessages,
      setSending: vi.fn(),
      appendActivity: vi.fn(),
    });

    expect(messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Inspect the project structure and summarize the main folders.",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "The main folders are `.openclaw`, `.git`, and `state`.",
      }),
    ]);
    const serialized = JSON.stringify(messages);
    expect(serialized).not.toContain(THINKING_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_ARG_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_RESULT_LEAK_SENTINEL);
    expect(serialized).not.toContain("/home/node/.openclaw/workspace/.git/refs");
  });

  it("preserves spaces across streamed assistant content chunks", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });
    const context = {
      setMessages,
      setSending: vi.fn(),
      appendActivity: vi.fn(),
    };

    for (const text of ["I'll", " lookup", " and get", " ", "bread"]) {
      handleOpenClawChatStreamEvent({
        ...context,
        chatEvent: { type: "content", text } as any,
      });
    }

    expect(messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "I'll lookup and get bread",
      }),
    ]);
  });

  it("appends canonical stream chunks even when a chunk repeats the current prefix", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });
    const context = {
      setMessages,
      setSending: vi.fn(),
      appendActivity: vi.fn(),
    };

    for (const text of ["ha", "ha!"]) {
      handleOpenClawChatStreamEvent({
        ...context,
        chatEvent: { type: "content", text } as any,
      });
    }

    expect(messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "haha!",
      }),
    ]);
  });

  it("applies stream replacements to one identified assistant render row", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });
    const context = {
      setMessages,
      setSending: vi.fn(),
      appendActivity: vi.fn(),
      assistantRenderId: "assistant-render-1",
      clientTurnId: "client-turn-1",
    };

    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: {
        type: "content",
        text: "Draft response",
        messageId: "message-1",
        turnId: "turn-1",
        runId: "run-1",
        sessionKey: "agent:default:main",
        revision: 1,
      },
    });
    const initialRenderId = messages[0]?.renderId;
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: {
        type: "content",
        text: "Corrected response",
        replace: true,
        messageId: "message-1",
        turnId: "turn-1",
        runId: "run-1",
        sessionKey: "agent:default:main",
        revision: 2,
      },
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: {
        type: "done",
        eventId: "event-final",
        messageId: "message-1",
        turnId: "turn-1",
        runId: "run-1",
        sessionKey: "agent:default:main",
        revision: 3,
      },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: "Corrected response",
      renderId: "assistant-render-1",
      clientTurnId: "client-turn-1",
      messageId: "message-1",
      turnId: "turn-1",
      runId: "run-1",
      sessionKey: "agent:default:main",
      eventId: "event-final",
      revision: 3,
    });
    expect(messages[0]?.renderId).toBe(initialRenderId);
  });

  it("prefers a channel source key for metadata-poor read-only previews", async () => {
    const sessionsPreview = vi.fn(async (sessionKey: string) => (
      sessionKey === "telegram:123"
        ? [{ role: "user", content: "Telegram message" }]
        : [{ role: "user", content: "Main workspace message" }]
    ));
    const messages = await refreshOpenClawChatMessages(
      { sessionsPreview, chatHistory: vi.fn() } as any,
      "agent-1",
      "telegram:123",
      "agent:default:main",
      {
        key: "telegram:123",
        gatewaySessionKey: "agent:default:main",
        sourceSessionKey: "telegram:123",
        sourceChannelId: "telegram",
        readOnly: true,
        raw: {},
      },
    );

    expect(sessionsPreview).toHaveBeenCalledTimes(1);
    expect(sessionsPreview).toHaveBeenCalledWith("telegram:123", 200);
    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "Telegram message" }),
    ]);
  });

  it("loads full read-only channel history so managed delivery media is preserved", async () => {
    const mediaUrl = "/api/chat/media/outgoing/agent%3Adefault%3Amain/221a9839-f7b1-4e2d-95b3-4b109c087e0b/full";
    const sessionsPreview = vi.fn(async () => [
      { role: "assistant", text: "cat with fluffy headphones" },
    ]);
    const chatHistory = vi.fn(async (sessionKey: string) => (
      sessionKey === "slack:T0ALU0BFVTP:C0BJUTAR79T"
        ? [
          {
            role: "assistant",
            provider: "openclaw",
            model: "delivery-mirror",
            content: [{ type: "text", text: "cat1_fluffy_headphones---217f4253-edae-4c35-b822-b5b21f724134.png" }],
          },
          {
            role: "assistant",
            provider: "openclaw",
            model: "delivery-mirror",
            content: [
              { type: "text", text: "cat with fluffy headphones" },
              {
                type: "image",
                url: mediaUrl,
                openUrl: mediaUrl,
                alt: "cat1_fluffy_headphones---217f4253-edae-4c35-b822-b5b21f724134.png",
                mimeType: "image/png",
              },
            ],
          },
        ]
        : []
    ));

    const messages = await refreshOpenClawChatMessages(
      { sessionsPreview, chatHistory } as any,
      "agent-1",
      "slack:T0ALU0BFVTP:C0BJUTAR79T",
      "agent:default:main",
      {
        key: "slack:T0ALU0BFVTP:C0BJUTAR79T",
        gatewaySessionKey: "agent:default:main",
        sourceSessionKey: "slack:T0ALU0BFVTP:C0BJUTAR79T",
        sourceChannelId: "slack",
        readOnly: true,
        raw: {},
      },
    );

    expect(chatHistory).toHaveBeenCalledWith("slack:T0ALU0BFVTP:C0BJUTAR79T", 200);
    expect(sessionsPreview).not.toHaveBeenCalled();
    expect(messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "cat with fluffy headphones",
        mediaUrls: [mediaUrl],
      }),
    ]);
  });

  it("rejects metadata-poor previews from an ambiguous shared channel key", async () => {
    const sessionsPreview = vi.fn(async (sessionKey: string) => (
      sessionKey === "telegram:123"
        ? []
        : [{ role: "user", content: "Main workspace message" }]
    ));
    const messages = await refreshOpenClawChatMessages(
      { sessionsPreview, chatHistory: vi.fn() } as any,
      "agent-1",
      "telegram:123",
      "agent:default:main",
      {
        key: "telegram:123",
        gatewaySessionKey: "agent:default:main",
        sourceSessionKey: "telegram:123",
        sourceChannelId: "telegram",
        readOnly: true,
        raw: {},
      },
    );

    expect(messages).toEqual([]);
  });

  it("hydrates message wrappers with nested output instead of the wrapper label", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => [
        {
          role: "user",
          content: "Look at the workspace files and tell me if there is a README.",
        },
        MESSAGE_WRAPPER_WITH_OUTPUT,
      ]),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "agent-123");

    expect(hydrated.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Look at the workspace files and tell me if there is a README.",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "There is no README file in the workspace.",
      }),
    ]);
    expect(hydrated.messages[1]?.content).not.toBe("message");
  });

  it("hydrates natural assistant answers persisted as tool output only", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => [
        {
          role: "user",
          content: "Look at the workspace files and tell me if there is a README.",
        },
        README_TOOL_OUTPUT_ONLY_MESSAGE,
      ]),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "agent-123");

    expect(hydrated.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Look at the workspace files and tell me if there is a README.",
      }),
      expect.objectContaining({
        role: "assistant",
        content: [
          "No - there's no README.",
          "The workspace currently has these files:",
          "",
          "AGENTS.md",
          "BOOTSTR",
          "TOOLS.md",
          "USER.md",
        ].join("\n"),
      }),
    ]);
    expect(hydrated.messages[1]?.toolCalls).toBeUndefined();
  });

  it("hydrates nested output instead of command-exit status text", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => [
        {
          role: "user",
          content: "Look at the workspace files and tell me if there is a README.",
        },
        README_OUTPUT_WITH_COMMAND_STATUS,
      ]),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "agent-123");

    expect(hydrated.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Look at the workspace files and tell me if there is a README.",
      }),
      expect.objectContaining({
        role: "assistant",
        content: [
          "No - there's no README.",
          "The workspace currently has these files:",
          "",
          "AGENTS.md",
          "BOOTSTR",
          "TOOLS.md",
          "USER.md",
        ].join("\n"),
      }),
    ]);
    expect(JSON.stringify(hydrated.messages)).not.toContain("Command exited with code");
  });

  it("hydrates persisted README answers while dropping toolResult records", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => README_REFRESH_HISTORY),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "agent-123");

    expect(hydrated.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Look at the workspace files and tell me if there is a README.",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "There is no README file in the workspace. The files present are:\n\n- `AGENTS.md`\n- `BOOTSTRAP.md`\n- `HEARTBEAT.md`\n- `IDENTITY.md`\n- `SOUL.md`\n- `TOOLS.md`\n- `USER.md`",
      }),
    ]);
    const serialized = JSON.stringify(hydrated.messages);
    expect(serialized).not.toContain("Command exited with code");
    expect(serialized).not.toContain(THINKING_LEAK_SENTINEL);
  });

  it("hydrates persisted file and image exchanges with final answers still visible", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "file: /home/node/.openclaw/workspace/51d7fd18-4324-49b2-9b4d-2fcc605acffe_Rosedale Report_QueryTool_02-12-2026_01-35.xlsx\n\nUse this file and summarize it.",
            },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "I need to inspect the spreadsheet." },
            { type: "text", text: " ## Summary: Rosedale Report (QueryTool Export)\n\nRecords: 3,319 credentialing applications." },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "file: /home/node/.openclaw/workspace/bosquejo.png\n\nDescribe this image.\n[media attached: media://inbound/bosquejo---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png]",
            },
            { type: "image", mimeType: "image/jpeg", omitted: true, bytes: 241348 },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "The user is asking me to describe an image." },
            { type: "text", text: " This is a detailed architectural rendering of a custom walk-in closet system." },
          ],
        },
      ]),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "agent-123");

    expect(hydrated.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Use this file and summarize it.",
        files: [
          expect.objectContaining({
            name: "51d7fd18-4324-49b2-9b4d-2fcc605acffe_Rosedale Report_QueryTool_02-12-2026_01-35.xlsx",
          }),
        ],
      }),
      expect.objectContaining({
        role: "assistant",
        content: "## Summary: Rosedale Report (QueryTool Export)\n\nRecords: 3,319 credentialing applications.",
      }),
      expect.objectContaining({
        role: "user",
        content: "Describe this image.",
        files: [
          expect.objectContaining({
            name: "bosquejo.png",
            type: "image/png",
          }),
        ],
      }),
      expect.objectContaining({
        role: "assistant",
        content: "This is a detailed architectural rendering of a custom walk-in closet system.",
      }),
    ]);
    expect(JSON.stringify(hydrated.messages)).not.toContain("media://inbound");
  });

  it("hydrates contentless assistant error records as visible system messages", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => [
        {
          role: "user",
          content: [{ type: "text", text: "show it to me" }],
        },
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: JSON.stringify({
            type: "error",
            error: {
              type: "internal_error",
              message: "2 validation errors for ChatCompletionStreamResponse\nmodel\n  Field required",
            },
          }),
        },
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "404 {\"error\":{\"message\":\"404 page not found\\n. Received Model Group=kimi-k2.5-anthropic\",\"type\":\"None\",\"param\":\"None\",\"code\":\"404\"}}",
        },
      ]),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "agent-123");

    expect(hydrated.messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "show it to me",
      }),
      expect.objectContaining({
        role: "system",
        content: "Assistant response failed before returning content (internal_error).",
      }),
      expect.objectContaining({
        role: "system",
        content: "Assistant response failed: 404 page not found.",
      }),
    ]);
    const serialized = JSON.stringify(hydrated.messages);
    expect(serialized).not.toContain("ChatCompletionStreamResponse");
    expect(serialized).not.toContain("Received Model Group");
  });

  it("preserves exact sentence boundaries across gateway chat.content deltas", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });
    const context = {
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "main",
    };

    handleOpenClawSessionEvent({
      gatewayEvent: {
        event: "chat.content",
        payload: {
          runId: "run-1",
          sessionKey: "main",
          message: { role: "assistant", content: "Déjame revisar. " },
        },
      } as any,
      ...context,
    });
    handleOpenClawSessionEvent({
      gatewayEvent: {
        event: "chat.content",
        payload: {
          runId: "run-1",
          sessionKey: "main",
          message: { role: "assistant", content: "Tenemos dos logos 1080×1080 con transparencia." },
        },
      } as any,
      ...context,
    });

    expect(messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "Déjame revisar. Tenemos dos logos 1080×1080 con transparencia.",
      }),
    ]);
  });

  it("keeps gateway chat.content deltas exact for mid-word splits and standalone whitespace", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });
    const context = {
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "main",
    };
    const sendDelta = (content: string) => handleOpenClawSessionEvent({
      gatewayEvent: {
        event: "chat.content",
        payload: {
          runId: "run-1",
          sessionKey: "main",
          message: { role: "assistant", content },
        },
      } as any,
      ...context,
    });

    sendDelta("Déjame revis");
    sendDelta("ar.");
    sendDelta(" ");
    sendDelta("Tenemos dos logos.");

    expect(messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "Déjame revisar. Tenemos dos logos.",
      }),
    ]);
  });

  it("ignores live chat content that is only raw workspace path output", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawSessionEvent({
      gatewayEvent: {
        event: "chat.content",
        payload: { text: WORKSPACE_PATH_DUMP },
      } as any,
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "main",
    });

    expect(messages).toEqual([]);
  });

  it("requests a fresh session list when OpenClaw publishes a native title", () => {
    const refreshSessions = vi.fn();

    handleOpenClawSessionEvent({
      gatewayEvent: {
        event: "sessions.changed",
        payload: {
          sessionKey: "agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab",
          reason: "chat.title",
        },
      } as any,
      setMessages: vi.fn(),
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions,
      appendActivity: vi.fn(),
      activeSessionKey: "agent:default:dashboard:019789ab-cdef-4abc-8def-0123456789ab",
    });

    expect(refreshSessions).toHaveBeenCalledWith({ fresh: true });
  });

  it("keeps Telegram channel events out of the active main project", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawSessionEvent({
      gatewayEvent: {
        event: "chat.content",
        payload: {
          sessionKey: "agent:default:main",
          text: "Telegram hello",
          origin: { provider: "telegram", from: "telegram:489595440" },
          deliveryContext: { channel: "telegram" },
        },
      } as any,
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "main",
    });

    expect(messages).toEqual([]);
  });

  it("renders Telegram channel events when that channel session is selected", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawSessionEvent({
      gatewayEvent: {
        event: "chat.content",
        payload: {
          sessionKey: "agent:default:main",
          text: "Telegram hello",
          origin: { provider: "telegram", from: "telegram:489595440" },
          deliveryContext: { channel: "telegram" },
        },
      } as any,
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "telegram:489595440",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: "Telegram hello",
      }),
    ]);
  });

  it("renders Telegram channel user events when that channel session is selected", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawSessionEvent({
      gatewayEvent: {
        event: "chat",
        payload: {
          sessionKey: "agent:default:main",
          state: "final",
          origin: { provider: "telegram", from: "telegram:489595440" },
          deliveryContext: { channel: "telegram" },
          message: {
            role: "user",
            content: "User from Telegram",
          },
        },
      } as any,
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "telegram:489595440",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "User from Telegram",
      }),
    ]);
  });

  it("treats aborted stream errors as a stopped reply instead of a visible error", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });
    const setSending = vi.fn();
    const appendActivity = vi.fn();

    handleOpenClawChatStreamEvent({
      chatEvent: {
        type: "error",
        text: "aborted",
        data: { state: "aborted" },
      },
      setMessages,
      setSending,
      appendActivity,
    });

    expect(setSending).toHaveBeenCalledWith(false);
    expect(messages).toEqual([]);
    expect(appendActivity).toHaveBeenCalledWith({ type: "system", action: "Assistant reply stopped" });
  });

  it("replaces partial output with a graceful notice when a turn has no visible reply", () => {
    let messages: ChatMessage[] = [
      { role: "user", content: "Write the document", clientTurnId: "turn-1" },
      {
        role: "assistant",
        content: "HE",
        renderId: "assistant-1",
        clientTurnId: "turn-1",
        toolCalls: [{ id: "tool-1", name: "Write", args: "document.md", result: "path provided" }],
      },
    ];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });
    const setSending = vi.fn();
    const appendActivity = vi.fn();

    handleOpenClawChatStreamEvent({
      chatEvent: { type: "error", text: EMPTY_REPLY_FAILURE_TEXT },
      setMessages,
      setSending,
      appendActivity,
      assistantRenderId: "assistant-1",
      clientTurnId: "turn-1",
    });

    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual(expect.objectContaining({
      role: "assistant",
      content: OPENCLAW_EMPTY_REPLY_NOTICE,
      renderId: "assistant-1",
      clientTurnId: "turn-1",
      toolCalls: [expect.objectContaining({ name: "Write", result: "path provided" })],
    }));
    expect(messages.some((message) => message.role === "system")).toBe(false);
    expect(setSending).toHaveBeenCalledWith(false);
    expect(appendActivity).toHaveBeenCalledWith({ type: "error", action: "Error", detail: EMPTY_REPLY_FAILURE_TEXT });
  });

  it("keeps unrelated stream errors as explicit system errors", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawChatStreamEvent({
      chatEvent: { type: "error", text: "Model backend unavailable" },
      setMessages,
      setSending: vi.fn(),
      appendActivity: vi.fn(),
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: "system", content: "Error: Model backend unavailable" }),
    ]);
  });

  it("shows passive agent tool start events with alternate tool field names", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawSessionEvent({
      gatewayEvent: {
        event: "agent",
        payload: {
          sessionKey: "main",
          stream: "tool",
          data: {
            phase: "start",
            tool_call_id: "tool-1",
            tool_name: "functions.read",
            args: { path: "/tmp/demo.zip" },
          },
        },
      } as any,
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "main",
    });

    expect(messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        toolCalls: [
          expect.objectContaining({
            id: "tool-1",
            name: "functions.read",
          }),
        ],
      }),
    ]);
  });

  it("migrates legacy UUID workspace files into the canonical main workspace", async () => {
    const deploymentId = "550e8400-e29b-41d4-a716-446655440000";
    const canonicalFiles: Array<{ name: string; size: number; missing: boolean }> = [];
    const legacyFiles = [{ name: "README.md", size: 12, missing: false }];
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => []),
      agentsList: vi.fn(async () => [
        { id: deploymentId },
        { id: "main" },
      ]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async (agentId: string) => {
        if (agentId === "main") return canonicalFiles;
        if (agentId === deploymentId) return legacyFiles;
        return [];
      }),
      fileGet: vi.fn(async (agentId: string, name: string) => {
        if (agentId === deploymentId && name === "README.md") return "# recovered";
        throw new Error("missing");
      }),
      fileSet: vi.fn(async (agentId: string, name: string, content: string) => {
        if (agentId === "main" && name === "README.md" && content === "# recovered") {
          canonicalFiles.push({ name, size: content.length, missing: false });
        }
      }),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, deploymentId);

    expect(gateway.filesList).toHaveBeenCalledWith("main");
    expect(gateway.filesList).toHaveBeenCalledWith(deploymentId);
    expect(gateway.fileGet).toHaveBeenCalledWith(deploymentId, "README.md");
    expect(gateway.fileSet).toHaveBeenCalledWith("main", "README.md", "# recovered");
    expect(hydrated.files).toEqual([{ name: "README.md", size: "# recovered".length, missing: false }]);
    expect(hydrated.gwAgentId).toBe("main");
  });

  it("does not probe or migrate legacy UUID workspaces when canonical files already exist", async () => {
    const deploymentId = "550e8400-e29b-41d4-a716-446655440000";
    const canonicalFiles = [{ name: "app.tsx", size: 42, missing: false }];
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => []),
      agentsList: vi.fn(async () => [
        { id: deploymentId },
        { id: "main" },
      ]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async (agentId: string) => {
        if (agentId === "main") return canonicalFiles;
        throw new Error("legacy workspace should not be read");
      }),
      fileGet: vi.fn(),
      fileSet: vi.fn(),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, deploymentId);

    expect(gateway.filesList).toHaveBeenCalledTimes(1);
    expect(gateway.filesList).toHaveBeenCalledWith("main");
    expect(gateway.fileGet).not.toHaveBeenCalled();
    expect(gateway.fileSet).not.toHaveBeenCalled();
    expect(hydrated.files).toEqual(canonicalFiles);
    expect(hydrated.gwAgentId).toBe("main");
  });

  it("falls back to the legacy UUID workspace when copying into main fails", async () => {
    const deploymentId = "550e8400-e29b-41d4-a716-446655440000";
    const legacyFiles = [{ name: "lost.md", size: 9, missing: false }];
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => []),
      agentsList: vi.fn(async () => [
        { id: deploymentId },
        { id: "main" },
      ]),
      sessionsList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
      filesList: vi.fn(async (agentId: string) => {
        if (agentId === "main") return [];
        if (agentId === deploymentId) return legacyFiles;
        return [];
      }),
      fileGet: vi.fn(async (agentId: string, name: string) => {
        if (agentId === deploymentId && name === "lost.md") return "recovered";
        throw new Error("missing");
      }),
      fileSet: vi.fn(async () => {
        throw new Error("canonical workspace is not writable yet");
      }),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, deploymentId);

    expect(gateway.filesList).toHaveBeenCalledWith("main");
    expect(gateway.filesList).toHaveBeenCalledWith(deploymentId);
    expect(gateway.fileGet).toHaveBeenCalledWith(deploymentId, "lost.md");
    expect(gateway.fileSet).toHaveBeenCalledWith("main", "lost.md", "recovered");
    expect(hydrated.files).toEqual(legacyFiles);
    expect(hydrated.gwAgentId).toBe(deploymentId);
  });
});

describe("openclaw commentary session wiring", () => {
  function createStreamContext(initial: ChatMessage[] = []) {
    let messages = initial;
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });
    return {
      context: {
        setMessages,
        setSending: vi.fn(),
        appendActivity: vi.fn(),
        assistantRenderId: "assistant-render-1",
        clientTurnId: "client-turn-1",
      },
      messages: () => messages,
    };
  }

  it("keeps a model without commentary on the ordinary content-only path", () => {
    const { context, messages } = createStreamContext();
    const identity = { messageId: "m1", turnId: "t1", runId: "r1", sessionKey: "main" };

    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "content", text: "A plain answer.", ...identity } as any,
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "done", ...identity } as any,
    });

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ role: "assistant", content: "A plain answer." });
    expect(messages()[0].progress).toBeUndefined();
    expect(messages()[0].thinking).toBeUndefined();
  });

  it("turns typed commentary chat events into one progress note, then settles on done", () => {
    const { context, messages } = createStreamContext();
    const identity = { messageId: "m1", turnId: "t1", runId: "r1", sessionKey: "main" };

    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "commentary", text: "Checking credentials", replace: true, ...identity } as any,
    });
    // Mirrored ordinary chat text of the same commentary.
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: {
        type: "content",
        text: "Checking credentials",
        replace: true,
        ...identity,
        data: { message: { role: "assistant", content: "Checking credentials" } },
      } as any,
    });
    expect(messages()).toHaveLength(1);
    expect(messages()[0].content).toBe("");
    expect(messages()[0].progress).toMatchObject({ text: "Checking credentials", state: "active" });

    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "tool_call", ...identity, data: { toolCallId: "tool-1", name: "read", args: { path: "config" } } } as any,
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "commentary", text: "Verifying the config", replace: true, ...identity } as any,
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: {
        type: "content",
        text: "Verifying the config\nAll good.",
        replace: true,
        ...identity,
      } as any,
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: {
        type: "done",
        ...identity,
        data: {
          message: {
            role: "assistant",
            stopReason: "stop",
            content: [{ type: "text", text: "Checking credentials\nVerifying the config\nAll good." }],
          },
        },
      } as any,
    });

    expect(messages()).toHaveLength(1);
    const row = messages()[0]!;
    expect(row.progress).toMatchObject({ text: "Verifying the config", state: "settled" });
    // The mirrored working notes never duplicate into the ordinary reply;
    // only the final answer tail remains, preserving boundary whitespace.
    expect(row.content).toBe("\nAll good.");
    expect(row.content).not.toContain("Checking credentials");
    expect(row.content).not.toContain("Verifying the config");
    expect(row.thinking).toBeUndefined();
  });

  it("uses the cumulative chat payload to suppress a mirrored commentary suffix", () => {
    const { context, messages } = createStreamContext();
    const identity = { runId: "r1", sessionKey: "main" };

    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "commentary", text: "Inspecting the workspace", replace: true, ...identity } as any,
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: {
        type: "content",
        text: "Inspecting the workspace",
        ...identity,
        data: { message: { role: "assistant", content: "Inspecting the workspace" } },
      } as any,
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: {
        type: "commentary",
        text: "Inspecting the workspace and checking configuration",
        replace: true,
        ...identity,
      } as any,
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: {
        type: "content",
        text: " and checking configuration",
        ...identity,
        data: {
          message: {
            role: "assistant",
            content: "Inspecting the workspace and checking configuration",
          },
        },
      } as any,
    });

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({
      content: "",
      progress: {
        text: "Inspecting the workspace and checking configuration",
        state: "active",
      },
    });
  });

  it("never renders raw thinking as progress, even when both stream kinds arrive", () => {
    const { context, messages } = createStreamContext();
    const identity = { messageId: "m1", turnId: "t1", runId: "r1", sessionKey: "raw" };

    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "thinking", text: THINKING_LEAK_SENTINEL, ...identity } as any,
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "commentary", text: "Public working note", replace: true, ...identity } as any,
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "content", text: "Answer", ...identity } as any,
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "done", ...identity } as any,
    });

    expect(messages()).toHaveLength(1);
    const row = messages()[0]!;
    expect(row.progress?.text).toBe("Public working note");
    expect(serializedNoThinkingLeak(row)).toBe(true);
  });

  it("settles progress when the run is aborted mid-commentary", () => {
    const { context, messages } = createStreamContext();
    const identity = { runId: "r1", sessionKey: "main" };

    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "commentary", text: "Halfway through", replace: true, ...identity } as any,
    });
    handleOpenClawChatStreamEvent({
      ...context,
      chatEvent: { type: "error", text: "aborted", ...identity, data: { state: "aborted" } } as any,
    });

    expect(messages()).toHaveLength(1);
    expect(messages()[0]!.progress).toMatchObject({ text: "Halfway through", state: "settled" });
  });

  it("handles raw gateway agent commentary frames for adopted (passive) runs", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });
    const base = {
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "main",
    };

    handleOpenClawSessionEvent({
      ...base,
      gatewayEvent: {
        type: "event",
        event: "agent",
        payload: {
          stream: "assistant",
          runId: "passive-run",
          sessionKey: "main",
          data: { phase: "commentary", text: "Adopted run working note", delta: "", replace: true },
        },
      } as any,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      progress: { text: "Adopted run working note", state: "active" },
    });

    handleOpenClawSessionEvent({
      ...base,
      gatewayEvent: {
        type: "event",
        event: "chat",
        payload: {
          runId: "passive-run",
          sessionKey: "main",
          state: "final",
          message: {
            role: "assistant",
            stopReason: "stop",
            content: [{ type: "text", text: "Adopted run working note\nPassive answer." }],
          },
        },
      } as any,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]!.progress?.state).toBe("settled");
    expect(messages[0]!.content).toContain("Passive answer.");
  });

  it.each([
    {
      label: "lifecycle completion",
      event: {
        type: "event",
        event: "agent",
        payload: {
          stream: "lifecycle",
          runId: "passive-run",
          sessionKey: "main",
          data: { phase: "end" },
        },
      },
    },
    {
      label: "an aborted chat event",
      event: {
        type: "event",
        event: "chat.aborted",
        payload: { runId: "passive-run", sessionKey: "main", state: "aborted" },
      },
    },
    {
      label: "an aborted chat error",
      event: {
        type: "event",
        event: "chat.error",
        payload: { runId: "passive-run", sessionKey: "main", state: "aborted", message: "aborted" },
      },
    },
  ])("settles passive commentary after $label", ({ event }) => {
    let messages: ChatMessage[] = [{
      role: "assistant",
      content: "",
      runId: "passive-run",
      sessionKey: "main",
      progress: { text: "Adopted run working note", state: "active", revisions: [] },
    }];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawSessionEvent({
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "main",
      gatewayEvent: event as any,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]!.progress).toMatchObject({
      text: "Adopted run working note",
      state: "settled",
    });
  });

  it("drops passive commentary frames addressed to another session", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawSessionEvent({
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "main",
      gatewayEvent: {
        type: "event",
        event: "agent",
        payload: {
          stream: "assistant",
          runId: "passive-run",
          sessionKey: "someone-else",
          data: { phase: "commentary", text: "Foreign session note", delta: "", replace: true },
        },
      } as any,
    });

    expect(messages).toEqual([]);
  });

  it("suppresses raw commentary frames while an owned chatSend stream is active", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawSessionEvent({
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      refreshSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "main",
      suppressChatStreamEvents: true,
      gatewayEvent: {
        type: "event",
        event: "agent",
        payload: {
          stream: "assistant",
          runId: "owned-run",
          sessionKey: "main",
          data: { phase: "commentary", text: "Duplicate raw frame", delta: "", replace: true },
        },
      } as any,
    });

    expect(messages).toEqual([]);
  });

  it("keeps hydrated turn state stable across a full reload of a commentary run", async () => {
    const history = [
      { role: "user", content: [{ type: "text", text: "Check the config" }], timestamp: 1 },
      {
        role: "assistant",
        stopReason: "toolUse",
        timestamp: 2,
        content: [{ type: "text", text: "Reading config files." }],
      },
      {
        role: "assistant",
        stopReason: "toolUse",
        timestamp: 3,
        content: [{ type: "text", text: "Reading config files.\nValidating two entries." }],
      },
      {
        role: "assistant",
        stopReason: "stop",
        timestamp: 4,
        content: [{ type: "text", text: "Config is valid." }],
      },
    ];
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => history),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "agent-1");
    const assistantRows = hydrated.messages.filter((message) => message.role === "assistant");
    expect(assistantRows).toHaveLength(1);
    expect(assistantRows[0]!).toMatchObject({
      content: "Config is valid.",
      progress: {
        text: "Reading config files.\nValidating two entries.",
        state: "settled",
      },
    });
    expect(assistantRows[0]!.progress?.revisions).toEqual([
      "Reading config files.",
      "Reading config files.\nValidating two entries.",
    ]);

    // A second hydration of the same history produces the same stable rows.
    const rehydrated = await hydrateOpenClawSession(gateway as any, "agent-1");
    expect(rehydrated.messages.map((message) => message.renderId)).toEqual(
      hydrated.messages.map((message) => message.renderId),
    );
  });

  it("folds persisted commentary into the final reply across an intervening error notice", async () => {
    const gateway = {
      configGet: vi.fn(async () => ({})),
      configSchema: vi.fn(async () => null),
      chatHistory: vi.fn(async () => [
        { role: "user", content: [{ type: "text", text: "Check the config" }], timestamp: 1 },
        {
          role: "assistant",
          stopReason: "toolUse",
          timestamp: 2,
          content: [{ type: "text", text: "Reading the config file" }],
        },
        {
          role: "assistant",
          stopReason: "error",
          errorMessage: "quota exceeded for model A",
          timestamp: 3,
          content: [],
        },
        {
          role: "assistant",
          stopReason: "stop",
          timestamp: 4,
          content: [{ type: "text", text: "Reading the config file\nConfig is valid." }],
        },
      ]),
      agentsList: vi.fn(async () => [{ id: "main" }]),
      sessionsList: vi.fn(async () => []),
      filesList: vi.fn(async () => []),
      cronList: vi.fn(async () => []),
      modelsList: vi.fn(async () => []),
    };

    const hydrated = await hydrateOpenClawSession(gateway as any, "agent-1");

    expect(hydrated.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Check the config" }),
      expect.objectContaining({ role: "system", content: "Assistant response failed: quota exceeded for model A." }),
      expect.objectContaining({
        role: "assistant",
        content: "\nConfig is valid.",
        progress: expect.objectContaining({ text: "Reading the config file", state: "settled" }),
      }),
    ]);
  });

  function serializedNoThinkingLeak(row: ChatMessage): boolean {
    const serialized = JSON.stringify(row);
    if (serialized.includes(THINKING_LEAK_SENTINEL)) return false;
    // Progress is serialized independently; private thinking is omitted.
    return row.progress?.text === "Public working note";
  }
});
