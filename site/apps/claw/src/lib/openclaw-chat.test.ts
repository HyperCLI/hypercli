import { describe, expect, it } from "vitest";

import {
  isInternalHeartbeatMessage,
  normalizeHistoryMessage,
  normalizeLiveToolResult,
  upsertAssistantMessage,
  type ChatMessage,
} from "./openclaw-chat";

const THINKING_LEAK_SENTINEL = "DO_NOT_RENDER_THINKING_SENTINEL";
const TOOL_ARG_LEAK_SENTINEL = "DO_NOT_RENDER_TOOL_ARG_SENTINEL";
const TOOL_RESULT_LEAK_SENTINEL = "DO_NOT_RENDER_TOOL_RESULT_SENTINEL";
const EXECUTION_OUTPUT_LEAK_SENTINEL = "PROOF ANCHORS - $82,500/month equivalent through Anthropic.";
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

describe("openclaw chat normalization", () => {
  it("filters heartbeat text from history thinking blocks", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "The user wants me to read HEARTBEAT.md from the workspace and follow it strictly.",
        },
      ],
    });

    expect(normalized).toBeNull();
  });

  it("omits thinking-only history messages", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "I need to inspect the app structure before answering.",
        },
      ],
    });

    expect(normalized).toBeNull();
  });

  it("keeps visible history text without exposing thinking", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "Long internal reasoning that should not be shown in chat.",
        },
        {
          type: "text",
          text: "The agent is ready.",
        },
      ],
    });

    expect(normalized).toMatchObject({
      role: "assistant",
      content: "The agent is ready.",
    });
    expect(normalized?.thinking).toBeUndefined();
  });

  it("filters heartbeat file reads from history tool calls", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "tool_call",
          name: "read",
          args: { path: "/home/node/.openclaw/workspace/HEARTBEAT.md" },
        },
      ],
    });

    expect(normalized).toBeNull();
  });

  it("omits persisted tool-call-only history messages", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "tool_call",
          name: "read",
          args: { path: "/workspace/app/page.tsx" },
        },
      ],
    });

    expect(normalized).toBeNull();
  });

  it("omits persisted tool-result-only history messages", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "tool_result",
          name: "read",
          text: "Raw tool output",
        },
      ],
    });

    expect(normalized).toBeNull();
  });

  it("keeps visible history text without replaying persisted tool-call UI", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "tool_call",
          name: "read",
          args: { path: "/workspace/app/page.tsx" },
        },
        {
          type: "text",
          text: "The dashboard page renders the active agent workspace.",
        },
      ],
    });

    expect(normalized).toMatchObject({
      role: "assistant",
      content: "The dashboard page renders the active agent workspace.",
    });
    expect(normalized?.toolCalls).toBeUndefined();
  });

  it("keeps visible history text without leaking internal thinking or tool sentinels", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: `Planning details: ${THINKING_LEAK_SENTINEL}`,
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
          text: `Internal tool output: ${TOOL_RESULT_LEAK_SENTINEL}`,
        },
        {
          type: "text",
          text: "Visible answer after the internal work.",
        },
      ],
    });

    expect(normalized).toMatchObject({
      role: "assistant",
      content: "Visible answer after the internal work.",
    });
    expect(normalized?.thinking).toBeUndefined();
    expect(normalized?.toolCalls).toBeUndefined();
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain(THINKING_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_ARG_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_RESULT_LEAK_SENTINEL);
  });

  it("recovers output_text final answers from tool-rich history messages", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool-1",
          name: "read",
          arguments: { marker: TOOL_ARG_LEAK_SENTINEL },
        },
        {
          type: "tool_result",
          id: "tool-1",
          name: "read",
          text: TOOL_RESULT_LEAK_SENTINEL,
        },
        {
          type: "output_text",
          text: "Here is the summary from the attached file.",
        },
      ],
    });

    expect(normalized).toMatchObject({
      role: "assistant",
      content: "Here is the summary from the attached file.",
    });
    expect(normalized?.toolCalls).toBeUndefined();
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain(TOOL_ARG_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_RESULT_LEAK_SENTINEL);
  });

  it("recovers nested Responses API final answers from tool-rich history messages", () => {
    const normalized = normalizeHistoryMessage(RESPONSES_STYLE_TOOL_RICH_MESSAGE);

    expect(normalized).toMatchObject({
      role: "assistant",
      content: "The main folders are `.openclaw`, `.git`, and `state`.",
    });
    expect(normalized?.toolCalls).toBeUndefined();
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain(THINKING_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_ARG_LEAK_SENTINEL);
    expect(serialized).not.toContain(TOOL_RESULT_LEAK_SENTINEL);
    expect(serialized).not.toContain("/home/node/.openclaw/workspace/.git/refs");
  });

  it("prefers nested output over persisted message wrapper labels", () => {
    const normalized = normalizeHistoryMessage(MESSAGE_WRAPPER_WITH_OUTPUT);

    expect(normalized).toMatchObject({
      role: "assistant",
      content: "There is no README file in the workspace.",
    });
    expect(normalized?.content).not.toBe("message");
  });

  it("recovers natural assistant answers persisted as tool output only", () => {
    const normalized = normalizeHistoryMessage(README_TOOL_OUTPUT_ONLY_MESSAGE);

    expect(normalized).toMatchObject({
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
    });
    expect(normalized?.toolCalls).toBeUndefined();
  });

  it("prefers nested output over command-exit status text", () => {
    const normalized = normalizeHistoryMessage(README_OUTPUT_WITH_COMMAND_STATUS);

    expect(normalized).toMatchObject({
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
    });
    expect(normalized?.content).not.toContain("Command exited with code");
  });

  it("drops standalone command-exit status history messages", () => {
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: "Command exited with code 1",
    })).toBeNull();
  });

  it("drops NO_REPLY assistant sentinels from persisted history", () => {
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: "NO_REPLY",
    })).toBeNull();
  });

  it("drops standalone audio reply carriers from persisted history", () => {
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: "Audio reply",
    })).toBeNull();
  });

  it("extracts base64 audio content blocks from persisted history", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      timestamp: 123,
      content: [
        {
          type: "text",
          text: "Audio reply",
        },
        {
          type: "audio",
          source: {
            type: "base64",
            media_type: "audio/mpeg",
            data: "AAAA",
          },
        },
      ],
    });

    expect(normalized).toEqual({
      role: "assistant",
      content: "Audio reply",
      mediaUrls: ["data:audio/mpeg;base64,AAAA"],
      timestamp: 123,
    });
  });

  it("drops persisted toolResult records instead of rendering them as assistant messages", () => {
    expect(normalizeHistoryMessage({
      role: "toolResult",
      toolCallId: "functions.exec:0",
      toolName: "exec",
      content: [
        {
          type: "text",
          text: "\n\n(Command exited with code 1)",
        },
      ],
    })).toBeNull();
  });

  it("drops async command completion status history messages", () => {
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: [
        "System (untrusted): [2026-05-26 15:55:05 UTC] Exec completed (fast-kel, code 0) :: Model: turbo | Device: cpu | Compute: int8",
        "File: /home/node/.openclaw/workspace/voice-1779810830903.webm (58.8 KB)",
        "Warning: You are sending unauthenticated requests to the HF Hub.",
        "",
        "An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally.",
      ].join("\n"),
    })).toBeNull();
  });

  it("drops persisted heartbeat control prompts without dropping normal file listings", () => {
    const heartbeatPrompt = [
      "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.",
      "Do not infer or repeat old tasks from prior chats.",
      "If nothing needs attention, reply HEARTBEAT_OK.",
      "When reading HEARTBEAT.md, use workspace file /home/node/.openclaw/workspace/HEARTBEAT.md (exact case).",
      "Current time: Tuesday, May 26th, 2026 - 5:19 PM (UTC) / 2026-05-26 17:19 UTC",
    ].join(" ");

    expect(normalizeHistoryMessage({
      role: "system",
      content: heartbeatPrompt,
    })).toBeNull();
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: heartbeatPrompt,
    })).toBeNull();
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: "Workspace files include HEARTBEAT.md and README.md.",
    })).toEqual(expect.objectContaining({
      role: "assistant",
      content: "Workspace files include HEARTBEAT.md and README.md.",
    }));
  });

  it("preserves normal assistant text that resembles cron or reminder content", () => {
    const examples = [
      "Hello World",
      "The current time is 7:46 UTC.",
      "Return your response as plain text; this is a quoted instruction I found.",
      "[cron:example] is a label I want to discuss.",
      "[cron:session-main] is a label I want to discuss.",
      "<system-reminder>example</system-reminder> is literal markup from the document.",
    ];

    for (const content of examples) {
      expect(normalizeHistoryMessage({ role: "assistant", content })).toEqual(expect.objectContaining({
        role: "assistant",
        content,
      }));
    }
  });

  it("drops user cron-prefixed control messages from history", () => {
    for (const content of [
      "[cron:job-1] every minute say hello",
      "  [cron:d670a898-c9ed-49ab-8d65-edca7d05931d Every 5 minutes] Current time: Friday",
      "[cron<system-reminder>Current time: Friday</system-reminder>",
    ]) {
      expect(normalizeHistoryMessage({ role: "user", content })).toBeNull();
    }

    expect(normalizeHistoryMessage({
      role: "user",
      content: "Please explain what [cron:example] means.",
    })).toEqual(expect.objectContaining({
      role: "user",
      content: "Please explain what [cron:example] means.",
    }));
  });

  it("drops cron instruction envelope leaks", () => {
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: [
        "[cron:1824d15b-b08c-484d-bf41-28deea1b31b5 Every 1 minute send this message:] every 1 minute send this message: Hello World Current time: Friday, June 5th, 2026 - 7:46 AM (UTC) / 2026-06-05 07:46 UTC",
        "",
        "Return your response as plain text; it will be delivered automatically. If the task explicitly calls for messaging a specific external recipient, note who/where it should go instead of sending it yourself.",
      ].join("\n"),
    })).toBeNull();
  });

  it("strips non-uuid cron envelopes only when backend reminder context is present", () => {
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: "[cron:session-main Every 1 minute] The cron label itself matters here.",
    })).toEqual(expect.objectContaining({
      role: "assistant",
      content: "[cron:session-main Every 1 minute] The cron label itself matters here.",
    }));

    expect(normalizeHistoryMessage({
      role: "assistant",
      content: [
        "[cron:session-main Every 1 minute send this message:] every 1 minute send this message: Hello from cron",
        "",
        "Return your response as plain text; it will be delivered automatically. If the task explicitly calls for messaging a specific external recipient, note who/where it should go instead of sending it yourself.",
      ].join("\n"),
    })).toBeNull();
  });

  it("strips malformed cron envelopes that run into system reminders", () => {
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: [
        "[cron:session-main Every 1 minute send this message:<system-reminder>Current time: Friday, June 5th, 2026 - 7:46 AM (UTC)</system-reminder>",
        "every 1 minute send this message: Hello World",
      ].join(""),
    })).toBeNull();
  });

  it("drops recent cron envelope leaks with injected current time reminders", () => {
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: [
        "[cron:ea069af5-e640-4e6e-aaba-539f8c589a6a I also work here!] i also work here! Current time: Friday, June 5th, 2026 - 8:40 AM (UTC) / 2026-06-05 08:40 UTC",
        "",
        "Return your response as plain text; it will be delivered automatically. If the task explicitly calls for messaging a specific external recipient, note who/where it should go instead of sending it yourself.",
      ].join("\n"),
    })).toBeNull();

    expect(normalizeHistoryMessage({
      role: "assistant",
      content: [
        "[cron:d670a898-c9ed-49ab-8d65-edca7d05931d Every 5 minutes give me the] every 5 minutes give me the wheater report Current time: Friday, June 5th, 2026 - 8:40 AM (UTC) / 2026-06-05 08:40 UTC",
        "",
        "Return your response as plain text; it will be delivered automatically. If the task explicitly calls for messaging a specific external recipient, note who/where it should go instead of sending it yourself.",
      ].join("\n"),
    })).toBeNull();
  });

  it("keeps the persisted README answer while dropping toolResult history", () => {
    const normalized = README_REFRESH_HISTORY
      .map((message) => normalizeHistoryMessage(message))
      .filter((message): message is ChatMessage => message !== null);

    expect(normalized).toEqual([
      expect.objectContaining({
        role: "user",
        content: "Look at the workspace files and tell me if there is a README.",
      }),
      expect.objectContaining({
        role: "assistant",
        content: "There is no README file in the workspace. The files present are:\n\n- `AGENTS.md`\n- `BOOTSTRAP.md`\n- `HEARTBEAT.md`\n- `IDENTITY.md`\n- `SOUL.md`\n- `TOOLS.md`\n- `USER.md`",
      }),
    ]);
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain("Command exited with code");
    expect(serialized).not.toContain(THINKING_LEAK_SENTINEL);
  });

  it("strips hidden workspace file headers from refreshed user text while preserving file chips", () => {
    const normalized = normalizeHistoryMessage({
      role: "user",
      content: "file: .openclaw/workspace/report.md\nfile: .openclaw/workspace/notes.txt\n\nUse these files and summarize them.",
    });

    expect(normalized).toMatchObject({
      role: "user",
      content: "Use these files and summarize them.",
    });
    expect(normalized?.content).not.toContain("file:");
    expect(normalized?.content).not.toContain(".openclaw/workspace");
    expect(normalized?.files).toEqual([
      {
        name: "report.md",
        path: ".openclaw/workspace/report.md",
        type: "text/markdown",
      },
      {
        name: "notes.txt",
        path: ".openclaw/workspace/notes.txt",
        type: "text/plain",
      },
    ]);
  });

  it("hydrates file and omitted image user messages with reusable file references", () => {
    const spreadsheet = normalizeHistoryMessage({
      role: "user",
      content: [
        {
          type: "text",
          text: "file: /home/node/.openclaw/workspace/51d7fd18-4324-49b2-9b4d-2fcc605acffe_Rosedale Report_QueryTool_02-12-2026_01-35.xlsx\n\nUse this file and summarize it.",
        },
      ],
    });
    const image = normalizeHistoryMessage({
      role: "user",
      content: [
        {
          type: "text",
          text: "file: /home/node/.openclaw/workspace/bosquejo.png\n\nDescribe this image.\n[media attached: media://inbound/bosquejo---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png]",
        },
        {
          type: "image",
          mimeType: "image/jpeg",
          omitted: true,
          bytes: 241348,
        },
      ],
    });

    expect(spreadsheet).toMatchObject({
      role: "user",
      content: "Use this file and summarize it.",
      files: [
        {
          name: "51d7fd18-4324-49b2-9b4d-2fcc605acffe_Rosedale Report_QueryTool_02-12-2026_01-35.xlsx",
          path: "/home/node/.openclaw/workspace/51d7fd18-4324-49b2-9b4d-2fcc605acffe_Rosedale Report_QueryTool_02-12-2026_01-35.xlsx",
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
    });
    expect(image).toMatchObject({
      role: "user",
      content: "Describe this image.",
      files: [
        {
          name: "bosquejo.png",
          path: "/home/node/.openclaw/workspace/bosquejo.png",
          type: "image/png",
        },
      ],
    });
    expect(JSON.stringify(image)).not.toContain("media://inbound");
  });

  it("keeps an image-only refreshed user message displayable", () => {
    const normalized = normalizeHistoryMessage({
      role: "user",
      content: [
        {
          type: "text",
          text: "file: /home/node/.openclaw/workspace/bosquejo.png\n\n\n[media attached: media://inbound/bosquejo---98a48e02-fd54-4c0e-864c-973b55ac839a.png]",
        },
        {
          type: "image",
          mimeType: "image/jpeg",
          omitted: true,
          bytes: 241348,
        },
      ],
    });

    expect(normalized).toMatchObject({
      role: "user",
      content: "",
      files: [
        {
          name: "bosquejo.png",
          path: "/home/node/.openclaw/workspace/bosquejo.png",
          type: "image/png",
        },
      ],
    });
  });

  it("surfaces contentless assistant error history without leaking raw provider JSON", () => {
    const internalError = normalizeHistoryMessage({
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
    });
    const notFound = normalizeHistoryMessage({
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "404 {\"error\":{\"message\":\"404 page not found\\n. Received Model Group=kimi-k2.5-anthropic\",\"type\":\"None\",\"param\":\"None\",\"code\":\"404\"}}",
    });

    expect(internalError).toMatchObject({
      role: "system",
      content: "Assistant response failed before returning content (internal_error).",
    });
    expect(notFound).toMatchObject({
      role: "system",
      content: "Assistant response failed: 404 page not found.",
    });
    expect(JSON.stringify([internalError, notFound])).not.toContain("validation errors");
    expect(JSON.stringify([internalError, notFound])).not.toContain("ChatCompletionStreamResponse");
  });

  it("drops raw workspace path dumps from refreshed assistant messages", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: WORKSPACE_PATH_DUMP,
    });

    expect(normalized).toBeNull();
  });

  it("drops history messages that contain only internal thinking and tool sentinels", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: THINKING_LEAK_SENTINEL,
        },
        {
          type: "tool_call",
          name: "read",
          args: { marker: TOOL_ARG_LEAK_SENTINEL },
        },
        {
          type: "tool_result",
          name: "read",
          text: TOOL_RESULT_LEAK_SENTINEL,
        },
      ],
    });

    expect(normalized).toBeNull();
  });

  it("does not add live thinking-only updates to chat messages", () => {
    const next = upsertAssistantMessage([], {
      role: "assistant",
      content: "",
      thinking: "I am planning a multi-step answer.",
      timestamp: 1,
    });

    expect(next).toEqual([]);
  });

  it("preserves leading spaces in live assistant content deltas", () => {
    let next = upsertAssistantMessage([], {
      role: "assistant",
      content: "I'll",
      timestamp: 1,
    });

    next = upsertAssistantMessage(next, {
      role: "assistant",
      content: " lookup",
      timestamp: 2,
    });

    expect(next[0]?.content).toBe("I'll lookup");
  });

  it("preserves standalone whitespace live assistant content deltas", () => {
    let next = upsertAssistantMessage([], {
      role: "assistant",
      content: "get",
      timestamp: 1,
    });

    next = upsertAssistantMessage(next, {
      role: "assistant",
      content: " ",
      timestamp: 2,
    });
    next = upsertAssistantMessage(next, {
      role: "assistant",
      content: "bread",
      timestamp: 3,
    });

    expect(next[0]?.content).toBe("get bread");
  });

  it("does not add live raw workspace path dumps to chat messages", () => {
    const previous: ChatMessage[] = [
      {
        role: "user",
        content: "Inspect the project structure and summarize the main folders.",
        timestamp: 1,
      },
    ];

    const next = upsertAssistantMessage(previous, {
      role: "assistant",
      content: WORKSPACE_PATH_DUMP,
      timestamp: 2,
    });

    expect(next).toEqual(previous);
  });

  it("keeps natural language answers that mention workspace paths", () => {
    const content = "The main folders are `/home/node/.openclaw/workspace/app`, `/home/node/.openclaw/workspace/components`, and `/home/node/.openclaw/workspace/lib`.";
    const next = upsertAssistantMessage([], {
      role: "assistant",
      content,
      timestamp: 1,
    });

    expect(next).toEqual([
      {
        role: "assistant",
        content,
        timestamp: 1,
      },
    ]);
  });

  it("redacts raw workspace path dumps from live tool result details", () => {
    const next = upsertAssistantMessage([], {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          name: "list",
          args: JSON.stringify({ path: "/home/node/.openclaw/workspace" }),
          result: WORKSPACE_PATH_DUMP,
        },
      ],
      timestamp: 1,
    });

    const serialized = JSON.stringify(next);
    expect(serialized).not.toContain("/home/node/.openclaw/workspace/.git");
    expect(next[0]?.toolCalls?.[0]?.result).toBe("[Internal tool output hidden from chat.]");
  });

  it("redacts live thinking from visible assistant messages", () => {
    const next = upsertAssistantMessage([], {
      role: "assistant",
      content: "Done.",
      thinking: "Internal chain of thought that should stay hidden.",
      timestamp: 1,
    });

    expect(next).toEqual([
      {
        role: "assistant",
        content: "Done.",
        timestamp: 1,
      },
    ]);
  });

  it("drops live NO_REPLY assistant sentinels", () => {
    const next = upsertAssistantMessage([], {
      role: "assistant",
      content: "NO_REPLY",
      timestamp: 1,
    });

    expect(next).toEqual([]);
  });

  it("drops live standalone audio reply carriers", () => {
    const next = upsertAssistantMessage([], {
      role: "assistant",
      content: "Audio reply",
      timestamp: 1,
    });

    expect(next).toEqual([]);
  });

  it("drops live async command completion status messages", () => {
    const next = upsertAssistantMessage([], {
      role: "assistant",
      content: [
        "System (untrusted): [2026-05-26 15:55:05 UTC] Exec completed (fast-kel, code 0) :: Model: turbo",
        "File: /home/node/.openclaw/workspace/voice-1779810830903.webm (58.8 KB)",
        "An async command you ran earlier has completed.",
      ].join("\n"),
      timestamp: 1,
    });

    expect(next).toEqual([]);
  });

  it("drops live heartbeat control prompts", () => {
    const previous: ChatMessage[] = [
      {
        role: "assistant",
        content: "Visible answer",
        timestamp: 1,
      },
    ];
    const next = upsertAssistantMessage(previous, {
      role: "assistant",
      content: "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.",
      timestamp: 2,
    });

    expect(next).toEqual(previous);
  });

  it("keeps live audio reply carriers when audio media is attached", () => {
    const next = upsertAssistantMessage([], {
      role: "assistant",
      content: "Audio reply",
      mediaUrls: ["https://cdn.example.test/reply.wav"],
      timestamp: 1,
    });

    expect(next).toEqual([
      {
        role: "assistant",
        content: "Audio reply",
        mediaUrls: ["https://cdn.example.test/reply.wav"],
        timestamp: 1,
      },
    ]);
  });

  it("strips internal execution output blocks from live assistant content", () => {
    const next = upsertAssistantMessage([], {
      role: "assistant",
      content: [
        EXECUTION_OUTPUT_LEAK_SENTINEL,
        "800 papers. 3,000 pages. One agent.",
        "---",
        "The visible answer starts here.",
      ].join("\n"),
      timestamp: 1,
    });

    expect(next).toEqual([
      {
        role: "assistant",
        content: "The visible answer starts here.",
        timestamp: 1,
      },
    ]);
    expect(JSON.stringify(next)).not.toContain(EXECUTION_OUTPUT_LEAK_SENTINEL);
  });

  it("drops truncated internal assistant content chunks", () => {
    const next = upsertAssistantMessage([], {
      role: "assistant",
      content: "Chief, want me to write this into a...(truncated)...",
      timestamp: 1,
    });

    expect(next).toEqual([]);
  });

  it("redacts internal execution output from live tool result details", () => {
    const next = upsertAssistantMessage([], {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          name: "exec",
          args: JSON.stringify({ command: "run proof anchor check" }),
          result: EXECUTION_OUTPUT_LEAK_SENTINEL,
        },
      ],
      timestamp: 1,
    });

    expect(JSON.stringify(next)).not.toContain(EXECUTION_OUTPUT_LEAK_SENTINEL);
    expect(next[0]?.toolCalls?.[0]?.result).toBe("[Internal tool output hidden from chat.]");
  });

  it("does not attach live heartbeat tool calls to the previous assistant message", () => {
    const previous: ChatMessage[] = [
      {
        role: "assistant",
        content: "Visible answer",
        timestamp: 1,
      },
    ];

    const next = upsertAssistantMessage(previous, {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          name: "read",
          args: JSON.stringify({ path: "/home/node/.openclaw/workspace/HEARTBEAT.md" }),
        },
      ],
      timestamp: 2,
    });

    expect(next).toEqual(previous);
  });

  it("removes a partial heartbeat prelude when the marker arrives later", () => {
    const previous: ChatMessage[] = [
      {
        role: "assistant",
        content: "The user wants me to read ",
        timestamp: 1,
      },
    ];

    const next = upsertAssistantMessage(previous, {
      role: "assistant",
      content: "HEARTBEAT.md from the workspace and follow it strictly.",
      timestamp: 2,
    });

    expect(next).toEqual([]);
  });

  it("detects heartbeat markers in tool call payloads", () => {
    expect(
      isInternalHeartbeatMessage({
        toolCalls: [
          {
            name: "read",
            args: { path: "/home/node/.openclaw/workspace/HEARTBEAT.md" },
          },
        ],
      }),
    ).toBe(true);
  });

  it("omits raw PDF bytes from hydrated assistant messages", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: "%PDF-1.4\n1 0 obj<</Title (HyperWireframes)>>\nstream\n\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD",
    });

    expect(normalized?.content).toContain("Binary file content omitted");
  });

  it("omits raw PDF bytes from live tool results", () => {
    const normalized = normalizeLiveToolResult({
      name: "read",
      result: "%PDF-1.4\nstream\n\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD",
    });

    expect(normalized?.result).toContain("Binary file content omitted");
  });

  it("normalizes empty and meta-based live tool results", () => {
    expect(normalizeLiveToolResult({ name: "exec", result: "" })).toEqual({
      name: "exec",
      args: "",
      result: "",
    });
    expect(normalizeLiveToolResult({ name: "exec", meta: "completed" })?.result).toBe("completed");
  });

  it("keeps binary placeholders compact when additional chunks arrive", () => {
    const previous: ChatMessage[] = [
      {
        role: "assistant",
        content: "%PDF-1.4\n1 0 obj",
        timestamp: 1,
      },
    ];

    const next = upsertAssistantMessage(previous, {
      role: "assistant",
      content: "\nstream\n\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD",
      timestamp: 2,
    });

    expect(next).toHaveLength(1);
    expect(next[0]?.content).toContain("Binary file content omitted");
    expect(next[0]?.content).not.toContain("%PDF-1.4");
  });
});
