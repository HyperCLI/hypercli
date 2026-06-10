import { describe, expect, it, vi } from "vitest";

import { handleOpenClawChatStreamEvent, handleOpenClawSessionEvent, hydrateOpenClawSession } from "./openclaw-session";
import type { ChatMessage } from "./openclaw-chat";
import { resolveOpenClawSessionKey } from "./openclaw-session-key";

const THINKING_LEAK_SENTINEL = "DO_NOT_RENDER_THINKING_SENTINEL";
const TOOL_ARG_LEAK_SENTINEL = "DO_NOT_RENDER_TOOL_ARG_SENTINEL";
const TOOL_RESULT_LEAK_SENTINEL = "DO_NOT_RENDER_TOOL_RESULT_SENTINEL";
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
  it("keeps the default root session on main", () => {
    expect(resolveOpenClawSessionKey("main")).toBe("main");
    expect(resolveOpenClawSessionKey("")).toBe("main");
    expect(resolveOpenClawSessionKey(undefined)).toBe("main");
  });

  it("keeps deployment ids out of gateway session keys", () => {
    expect(resolveOpenClawSessionKey("agent-123")).toBe("main");
    expect(resolveOpenClawSessionKey("550e8400-e29b-41d4-a716-446655440000")).toBe("main");
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
    expect(gateway.filesList).toHaveBeenCalledWith("main");
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
      gateway: { sessionsList: vi.fn(async () => []) } as any,
      chatEvent: {
        type: "done",
        data: { message: RESPONSES_STYLE_TOOL_RICH_MESSAGE },
      } as any,
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      appendActivity: vi.fn(),
      activeSessionKey: "main",
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
      gateway: { sessionsList: vi.fn(async () => []) } as any,
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
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

  it("ignores live chat content that is only raw workspace path output", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawSessionEvent({
      gateway: { sessionsList: vi.fn(async () => []) } as any,
      gatewayEvent: {
        event: "chat.content",
        payload: { text: WORKSPACE_PATH_DUMP },
      } as any,
      setMessages,
      setSending: vi.fn(),
      setSessions: vi.fn(),
      appendActivity: vi.fn(),
    });

    expect(messages).toEqual([]);
  });

  it("shows passive agent tool start events with alternate tool field names", () => {
    let messages: ChatMessage[] = [];
    const setMessages = vi.fn((value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      messages = typeof value === "function" ? value(messages) : value;
    });

    handleOpenClawSessionEvent({
      gateway: { sessionsList: vi.fn(async () => []) } as any,
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
