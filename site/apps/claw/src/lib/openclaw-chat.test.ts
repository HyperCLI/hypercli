import { describe, expect, it } from "vitest";

import {
  isInternalHeartbeatMessage,
  isOpenClawEmptyReplyFailureText,
  normalizeHistoryMessage,
  normalizeLiveToolCall,
  normalizeLiveToolResult,
  OPENCLAW_EMPTY_REPLY_NOTICE,
  settleAssistantProgress,
  settleAssistantReasoning,
  upsertAssistantMessage,
  type ChatMessage,
} from "./openclaw-chat";

const THINKING_LEAK_SENTINEL = "DO_NOT_RENDER_THINKING_SENTINEL";
const TOOL_ARG_LEAK_SENTINEL = "DO_NOT_RENDER_TOOL_ARG_SENTINEL";
const TOOL_RESULT_LEAK_SENTINEL = "DO_NOT_RENDER_TOOL_RESULT_SENTINEL";
const EXECUTION_OUTPUT_LEAK_SENTINEL = "PROOF ANCHORS - $82,500/month equivalent through Anthropic.";
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

describe("openclaw chat normalization", () => {
  it("repairs only lossless, strongly evidenced mojibake in history and live content", () => {
    const examples = [
      {
        input: "FranÃ§ois said â\u0080\u0094 hello ð\u009f\u0091\u008b.",
        expected: "François said — hello 👋.",
      },
      {
        input: "Itâ€™s ready ðŸ‘‹",
        expected: "It’s ready 👋",
      },
      { input: "Mâcon is in France.", expected: "Mâcon is in France." },
      { input: "Guðmundur approved it.", expected: "Guðmundur approved it." },
      {
        input: "Mâcon — Guðmundur approved it 👋 in 東京.",
        expected: "Mâcon — Guðmundur approved it 👋 in 東京.",
      },
      { input: "Incomplete â\u0080 sequence", expected: "Incomplete â\u0080 sequence" },
      { input: "Already damaged Ã© \uFFFD", expected: "Already damaged Ã© \uFFFD" },
    ];

    for (const { input, expected } of examples) {
      expect(normalizeHistoryMessage({ role: "assistant", content: input })?.content).toBe(expected);
      expect(upsertAssistantMessage([], { role: "assistant", content: input })[0]?.content).toBe(expected);
    }
  });

  it("keeps OpenClaw managed outgoing image blocks as media urls", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "image",
          url: "/api/chat/media/outgoing/agent%3Adefault%3Amain/11111111-1111-4111-8111-111111111111/full",
          openUrl: "/api/chat/media/outgoing/agent%3Adefault%3Amain/11111111-1111-4111-8111-111111111111/full",
          alt: "cat.png",
          mimeType: "image/png",
        },
      ],
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.mediaUrls).toEqual([
      "/api/chat/media/outgoing/agent%3Adefault%3Amain/11111111-1111-4111-8111-111111111111/full",
    ]);
  });

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

  it("keeps provider reasoning-only history messages as settled thoughts", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "I need to inspect the app structure before answering.",
        },
      ],
    });

    expect(normalized).toMatchObject({
      role: "assistant",
      content: "",
      reasoning: {
        text: "I need to inspect the app structure before answering.",
        state: "settled",
      },
    });
    expect(normalized?.thinking).toBeUndefined();
  });

  it("keeps provider reasoning separate from visible history text", () => {
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
      reasoning: {
        text: "Long internal reasoning that should not be shown in chat.",
        state: "settled",
      },
    });
    expect(normalized?.thinking).toBeUndefined();
  });

  it("keeps payload reasoning_content separate from the answer", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      reasoning_content: "Inspect the workspace and compare the configuration.",
      content: "The configuration is valid.",
    });

    expect(normalized).toMatchObject({
      role: "assistant",
      content: "The configuration is valid.",
      reasoning: {
        text: "Inspect the workspace and compare the configuration.",
        state: "settled",
      },
    });
    expect(normalized?.thinking).toBeUndefined();
    expect(normalized?.progress).toBeUndefined();
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

  it("keeps visible history text without leaking raw runtime thinking or tool sentinels", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      thinking: `Planning details: ${THINKING_LEAK_SENTINEL}`,
      content: [
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

  it("preserves execution-like final answers in history and live content", () => {
    const answers = [
      "Exit code: 0",
      "Raw output: the API returned 201.\nThis confirms success.",
      "The source literally says ... (truncated) ... and the surrounding prose matters.",
    ];

    for (const content of answers) {
      expect(normalizeHistoryMessage({ role: "assistant", content })).toEqual(expect.objectContaining({
        role: "assistant",
        content,
      }));
      expect(upsertAssistantMessage([], { role: "assistant", content })).toEqual([
        expect.objectContaining({ role: "assistant", content }),
      ]);
    }
  });

  it("drops NO_REPLY assistant sentinels from persisted history", () => {
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: "NO_REPLY",
    })).toBeNull();
  });

  it("drops Telegram delivery mirror assistant records from persisted history", () => {
    expect(normalizeHistoryMessage({
      role: "assistant",
      provider: "openclaw",
      model: "delivery-mirror",
      content: [
        {
          type: "text",
          text: "Hey. Telegram bot project is all set up in the workspace. What's next?",
        },
      ],
    })).toBeNull();
  });

  it("keeps delivery mirror assistant records with OpenClaw managed media", () => {
    const mediaUrl = "/api/chat/media/outgoing/agent%3Adefault%3Amain/221a9839-f7b1-4e2d-95b3-4b109c087e0b/full";

    const normalized = normalizeHistoryMessage({
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
    });

    expect(normalized).toEqual(expect.objectContaining({
      role: "assistant",
      content: "cat with fluffy headphones",
      mediaUrls: [mediaUrl],
    }));
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

    expect(normalized).toEqual(expect.objectContaining({
      role: "assistant",
      content: "Audio reply",
      mediaUrls: ["data:audio/mpeg;base64,AAAA"],
      timestamp: 123,
      renderId: expect.any(String),
    }));
  });

  it("extracts direct and nested output_audio records from persisted history", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [
        { type: "output_audio", data: "AAAA", format: "wav" },
        { type: "output_audio", output_audio: { data: "BBBB", mime_type: "audio/ogg" } },
        { type: "audio", audio: { url: "https://cdn.example.test/reply.mp3" } },
      ],
    });

    expect(normalized?.mediaUrls).toEqual([
      "data:audio/wav;base64,AAAA",
      "data:audio/ogg;base64,BBBB",
      "https://cdn.example.test/reply.mp3",
    ]);
  });

  it("falls back to an audio mime type for malformed TTS metadata", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [{ type: "output_audio", data: "AAAA", media_type: "text/html" }],
    });

    expect(normalized?.mediaUrls).toEqual(["data:audio/mpeg;base64,AAAA"]);
  });

  it("normalizes codec parameters on TTS audio MIME metadata", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [{ type: "output_audio", data: "AAAA", media_type: "audio/webm;codecs=opus" }],
    });

    expect(normalized?.mediaUrls).toEqual(["data:audio/webm;base64,AAAA"]);
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

  it("keeps heartbeat explanations and non-control tool data in history and live content", () => {
    const explanations = [
      "HEARTBEAT.md contains the periodic maintenance checklist for this workspace.",
      "The phrase Read HEARTBEAT.md if it exists (workspace context) is quoted here for explanation.",
      "The user wants me to read HEARTBEAT.md, but this sentence is explaining that request.",
    ];

    for (const content of explanations) {
      expect(normalizeHistoryMessage({ role: "assistant", content })).toEqual(expect.objectContaining({ content }));
      expect(upsertAssistantMessage([], { role: "assistant", content })).toEqual([
        expect.objectContaining({ role: "assistant", content }),
      ]);
    }

    const explanatoryToolCall = {
      name: "search",
      args: JSON.stringify({ query: "Explain HEARTBEAT.md" }),
      result: "HEARTBEAT.md is a workspace maintenance document, not an error.",
    };
    expect(isInternalHeartbeatMessage({ toolCalls: [explanatoryToolCall] })).toBe(false);
    expect(upsertAssistantMessage([], {
      role: "assistant",
      content: "I can explain HEARTBEAT.md without running a heartbeat control turn.",
      toolCalls: [explanatoryToolCall],
    })).toEqual([
      expect.objectContaining({
        content: "I can explain HEARTBEAT.md without running a heartbeat control turn.",
        toolCalls: [explanatoryToolCall],
      }),
    ]);
  });

  it("drops exact heartbeat sentinels from history and live content", () => {
    expect(normalizeHistoryMessage({ role: "assistant", content: "HEARTBEAT_OK" })).toBeNull();
    expect(upsertAssistantMessage([], { role: "assistant", content: "HEARTBEAT_OK" })).toEqual([]);
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

  it("keeps persisted provider thoughts and the README answer while dropping toolResult history", () => {
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
        content: "",
        reasoning: expect.objectContaining({
          text: THINKING_LEAK_SENTINEL,
          state: "settled",
        }),
      }),
      expect.objectContaining({
        role: "assistant",
        content: "There is no README file in the workspace. The files present are:\n\n- `AGENTS.md`\n- `BOOTSTRAP.md`\n- `HEARTBEAT.md`\n- `IDENTITY.md`\n- `SOUL.md`\n- `TOOLS.md`\n- `USER.md`",
        reasoning: expect.objectContaining({
          text: "No README file exists in the workspace.",
          state: "settled",
        }),
      }),
    ]);
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain("Command exited with code");
    expect(serialized).toContain(THINKING_LEAK_SENTINEL);
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
          text: "file: /home/node/.openclaw/workspace/51d7fd18-4324-49b2-9b4d-2fcc605acffe_Sample Report_QueryTool_02-12-2026_01-35.xlsx\n\nUse this file and summarize it.",
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
          name: "51d7fd18-4324-49b2-9b4d-2fcc605acffe_Sample Report_QueryTool_02-12-2026_01-35.xlsx",
          path: "/home/node/.openclaw/workspace/51d7fd18-4324-49b2-9b4d-2fcc605acffe_Sample Report_QueryTool_02-12-2026_01-35.xlsx",
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

  it("keeps recorder-named WebM history files classified as audio", () => {
    const normalized = normalizeHistoryMessage({
      role: "user",
      content: [{
        type: "text",
        text: "file: /home/node/.openclaw/workspace/voice-1779810830903.webm\n\nTranscribe this recording.",
      }],
    });

    expect(normalized?.files).toEqual([{
      name: "voice-1779810830903.webm",
      path: "/home/node/.openclaw/workspace/voice-1779810830903.webm",
      type: "audio/webm",
    }]);
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

  it("surfaces context overflow history as a user-actionable system message", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: "Context overflow: prompt too large for the model (precheck).",
    });

    expect(normalized).toMatchObject({
      role: "system",
      content: "The conversation is too large for the current model. Start a new session or compact the context, then retry.",
    });
  });

  it("normalizes empty interactive replies from visible and contentless history", () => {
    const visibleFailure = normalizeHistoryMessage({
      role: "assistant",
      content: `HEError: ${EMPTY_REPLY_FAILURE_TEXT}`,
      stopReason: "error",
    });
    const contentlessFailure = normalizeHistoryMessage({
      role: "assistant",
      content: [],
      stopReason: "error",
      errorMessage: EMPTY_REPLY_FAILURE_TEXT,
    });

    expect(visibleFailure).toEqual(expect.objectContaining({
      role: "assistant",
      content: OPENCLAW_EMPTY_REPLY_NOTICE,
    }));
    expect(contentlessFailure).toEqual(expect.objectContaining({
      role: "system",
      content: OPENCLAW_EMPTY_REPLY_NOTICE,
    }));
    expect(isOpenClawEmptyReplyFailureText(OPENCLAW_EMPTY_REPLY_NOTICE)).toBe(true);
  });

  it("normalizes an empty-reply failure assembled from stream chunks", () => {
    const splitAt = Math.floor(EMPTY_REPLY_FAILURE_TEXT.length / 2);
    let messages = upsertAssistantMessage([], {
      role: "assistant",
      content: EMPTY_REPLY_FAILURE_TEXT.slice(0, splitAt),
    });

    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: EMPTY_REPLY_FAILURE_TEXT.slice(splitAt),
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: "assistant", content: OPENCLAW_EMPTY_REPLY_NOTICE }),
    ]);
  });

  it("drops contentless aborted assistant history records", () => {
    expect(normalizeHistoryMessage({
      role: "assistant",
      content: [],
      stopReason: "aborted",
      errorMessage: "aborted",
    })).toBeNull();
  });

  it("drops raw workspace path dumps from refreshed assistant messages", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      content: WORKSPACE_PATH_DUMP,
    });

    expect(normalized).toBeNull();
  });

  it("keeps structured provider reasoning while omitting persisted tool UI", () => {
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

    expect(normalized).toMatchObject({
      role: "assistant",
      content: "",
      reasoning: { text: THINKING_LEAK_SENTINEL, state: "settled" },
    });
    expect(normalized?.toolCalls).toBeUndefined();
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

  it("streams provider reasoning into one round and settles it when content begins", () => {
    let messages = upsertAssistantMessage([], {
      role: "assistant",
      content: "",
      reasoning: { text: "Inspecting ", state: "active", startedAt: 1 },
      runId: "run-1",
      renderId: "assistant-1",
      timestamp: 1,
    }, { updateReasoning: "append", startNewRound: true });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "",
      reasoning: { text: "the workspace", state: "active", startedAt: 2 },
      runId: "run-1",
      renderId: "assistant-1",
      timestamp: 2,
    }, { updateReasoning: "append", startNewRound: true });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "The configuration is valid.",
      runId: "run-1",
      renderId: "assistant-1",
      timestamp: 3,
    }, { appendContent: true, startNewRound: true });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      content: "The configuration is valid.",
      reasoning: {
        text: "Inspecting the workspace",
        state: "settled",
        startedAt: 1,
        completedAt: 3,
      },
    });
  });

  it("starts a new reasoning round after completed tool activity", () => {
    let messages = upsertAssistantMessage([], {
      role: "assistant",
      content: "",
      reasoning: { text: "Finding the file", state: "active", startedAt: 1 },
      runId: "run-1",
      renderId: "assistant-1",
    }, { updateReasoning: "append", startNewRound: true });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "I will inspect the file.",
      toolCalls: [{ id: "tool-1", name: "read", args: "config.json", result: "{}" }],
      runId: "run-1",
      renderId: "assistant-1",
      timestamp: 2,
    });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "",
      reasoning: { text: "Checking the result", state: "active", startedAt: 3 },
      runId: "run-1",
      renderId: "assistant-1",
      timestamp: 3,
    }, { updateReasoning: "append", startNewRound: true });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "Everything is configured correctly.",
      runId: "run-1",
      renderId: "assistant-1",
      timestamp: 4,
    }, { appendContent: true, startNewRound: true });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      content: "I will inspect the file.",
      reasoning: { text: "Finding the file", state: "settled" },
      toolCalls: [expect.objectContaining({ id: "tool-1", result: "{}" })],
    });
    expect(messages[1]).toMatchObject({
      content: "Everything is configured correctly.",
      reasoning: { text: "Checking the result", state: "settled" },
    });
    expect(messages[1]?.renderId).not.toBe(messages[0]?.renderId);
  });

  it("keeps distinct provider message ids as distinct rounds within one run", () => {
    let messages = upsertAssistantMessage([], {
      role: "assistant",
      content: "First round",
      messageId: "message-1",
      turnId: "turn-1",
      runId: "run-1",
      renderId: "assistant-1",
    });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "Final round",
      messageId: "message-2",
      turnId: "turn-1",
      runId: "run-1",
      renderId: "assistant-1",
    });

    expect(messages.map((message) => message.content)).toEqual(["First round", "Final round"]);
    expect(messages[1]?.renderId).not.toBe(messages[0]?.renderId);
  });

  it("marks active provider reasoning incomplete without discarding it", () => {
    const messages = settleAssistantReasoning([{
      role: "assistant",
      content: "",
      reasoning: { text: "Halfway through the analysis", state: "active", startedAt: 1 },
      runId: "run-1",
    }], { runId: "run-1" }, "incomplete");

    expect(messages[0]?.reasoning).toEqual({
      text: "Halfway through the analysis",
      state: "incomplete",
      startedAt: 1,
    });
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

  it("keeps assistant prose containing truncation notation", () => {
    const content = "Chief, want me to write this into a...(truncated)...";
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

  it("keeps common output labels in live tool result details", () => {
    const details = [
      "Exit code: 0",
      "Raw output: the API returned 201.\nThis confirms success.",
      "The response included ... (truncated) ... as literal prose.",
    ];

    for (const result of details) {
      const toolResult = normalizeLiveToolResult({ name: "inspect", result });
      expect(toolResult?.result).toBe(result);
      const messages = upsertAssistantMessage([], {
        role: "assistant",
        content: "",
        toolCalls: toolResult ? [toolResult] : [],
      });
      expect(messages[0]?.toolCalls?.[0]?.result).toBe(result);
    }
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

  it("keeps explanatory PDF signatures in history and live content", () => {
    const explanations = [
      "The token %PDF-1.7 identifies the PDF file format version.",
      "%PDF-1.7\nThis is explanatory prose about a header, not a binary payload.",
    ];

    for (const content of explanations) {
      expect(normalizeHistoryMessage({ role: "assistant", content })?.content).toBe(content);
      expect(upsertAssistantMessage([], { role: "assistant", content })[0]?.content).toBe(content);
      expect(normalizeLiveToolResult({ name: "explain", result: content })?.result).toBe(content);
    }
  });

  it("keeps incremental 10,000-character response updates bounded", () => {
    const content = "Una respuesta larga con contexto y detalles utiles para el usuario. "
      .repeat(180)
      .slice(0, 10_000);
    let messages: ChatMessage[] = [{ role: "user", content: "Write a detailed report" }];
    const started = performance.now();

    for (let offset = 0; offset < content.length; offset += 16) {
      messages = upsertAssistantMessage(messages, {
        role: "assistant",
        content: content.slice(offset, offset + 16),
      }, { appendContent: true });
    }

    expect(messages.at(-1)?.content).toBe(content);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("omits raw PDF bytes from live tool results", () => {
    const normalized = normalizeLiveToolResult({
      name: "read",
      result: "%PDF-1.4\nstream\n\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD",
    });

    expect(normalized?.result).toContain("Binary file content omitted");
  });

  it("normalizes live tool-call id and name aliases", () => {
    const normalized = normalizeLiveToolCall({
      tool_call_id: "tool-1",
      tool_name: "functions.read",
      args: { path: "/tmp/demo.zip" },
    });

    expect(normalized).toMatchObject({
      id: "tool-1",
      name: "functions.read",
    });
    expect(normalized?.args).toContain("/tmp/demo.zip");
  });

  it("keeps identified live tool calls visible without a tool name", () => {
    expect(normalizeLiveToolCall({ id: "tool-1", arguments: { query: "status" } })).toMatchObject({
      id: "tool-1",
      name: "tool",
      args: expect.stringContaining("status"),
    });
    expect(normalizeLiveToolCall({})).toBeNull();
  });

  it("normalizes live tool-result aliases and error metadata", () => {
    expect(normalizeLiveToolResult({
      tool_call_id: "tool-1",
      tool_name: "exec",
      meta: "command failed",
      isError: true,
    })).toEqual({
      id: "tool-1",
      name: "exec",
      args: "",
      result: "Error: command failed",
    });
  });

  it("normalizes empty and meta-based live tool results", () => {
    expect(normalizeLiveToolResult({ name: "exec", result: "" })).toEqual({
      name: "exec",
      args: "",
      result: "",
    });
    expect(normalizeLiveToolResult({ name: "exec", meta: "completed" })?.result).toBe("completed");
  });

  it("keeps live tool calls visible when final assistant text arrives", () => {
    const withToolCall = upsertAssistantMessage([
      { role: "user", content: "Find current events", timestamp: 1 },
    ], {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "memory_search_0",
          name: "memory_search",
          args: JSON.stringify({ query: "live events" }),
        },
      ],
      timestamp: 2,
    });
    const withToolResult = upsertAssistantMessage(withToolCall, {
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "memory_search_0",
          name: "memory_search",
          args: "",
          result: 'Error: {"error":"index provider settings changed"}',
        },
      ],
      timestamp: 3,
    });
    const final = upsertAssistantMessage(withToolResult, {
      role: "assistant",
      content: "I checked the files directly and found the event list.",
      timestamp: 4,
    });

    expect(final).toEqual([
      expect.objectContaining({ role: "user", content: "Find current events" }),
      expect.objectContaining({
        role: "assistant",
        content: "I checked the files directly and found the event list.",
        toolCalls: [
          expect.objectContaining({
            id: "memory_search_0",
            name: "memory_search",
            result: expect.stringContaining("index provider settings changed"),
          }),
        ],
      }),
    ]);
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

  it("preserves history protocol identity and assigns a render identity", () => {
    const historyMessage = {
      role: "assistant",
      content: "Persisted answer",
      messageId: "message-1",
      turnId: "turn-1",
      runId: "run-1",
      canonicalSessionKey: "agent:default:main",
      revision: "rev-2",
    };
    const normalized = normalizeHistoryMessage(historyMessage);
    const normalizedAgain = normalizeHistoryMessage(historyMessage);

    expect(normalized).toMatchObject({
      role: "assistant",
      content: "Persisted answer",
      messageId: "message-1",
      turnId: "turn-1",
      runId: "run-1",
      sessionKey: "agent:default:main",
      revision: "rev-2",
      renderId: expect.any(String),
    });
    expect(normalizedAgain?.renderId).toBe(normalized?.renderId);
  });

  it("upserts assistants by message, then turn, then run identity while retaining render ids", () => {
    const current: ChatMessage[] = [
      {
        role: "assistant",
        content: "First",
        messageId: "message-1",
        turnId: "turn-1",
        runId: "run-1",
        renderId: "render-1",
      },
      {
        role: "assistant",
        content: "Second",
        messageId: "message-2",
        turnId: "turn-2",
        runId: "run-2",
        renderId: "render-2",
      },
    ];

    const byMessage = upsertAssistantMessage(current, {
      role: "assistant",
      content: " updated by message",
      messageId: "message-1",
      turnId: "turn-2",
      runId: "run-2",
      renderId: "incoming-render",
      revision: 2,
    });
    expect(byMessage[0]).toMatchObject({
      content: "First updated by message",
      renderId: "render-1",
      revision: 2,
    });
    expect(byMessage[1]?.content).toBe("Second");

    const byTurn = upsertAssistantMessage(current, {
      role: "assistant",
      content: " updated by turn",
      turnId: "turn-1",
      runId: "run-2",
    });
    expect(byTurn[0]).toMatchObject({ content: "First updated by turn", renderId: "render-1" });
    expect(byTurn[1]?.content).toBe("Second");

    const byRun = upsertAssistantMessage(current, {
      role: "assistant",
      content: " updated by run",
      runId: "run-1",
    });
    expect(byRun[0]).toMatchObject({ content: "First updated by run", renderId: "render-1" });
    expect(byRun[1]?.content).toBe("Second");
  });

  it("preserves the exact sentence boundary when appending a live delta after trimmed history", () => {
    const persisted = normalizeHistoryMessage({
      role: "assistant",
      content: "Déjame revisar. ",
      runId: "run-1",
    });
    expect(persisted?.content).toBe("Déjame revisar.");

    const resumed = upsertAssistantMessage([persisted!], {
      role: "assistant",
      content: " Tenemos dos logos 1080×1080 con transparencia.",
      runId: "run-1",
    }, { appendContent: true });

    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.content).toBe("Déjame revisar. Tenemos dos logos 1080×1080 con transparencia.");
  });

  it("appends mid-word and already-spaced live deltas exactly without inventing whitespace", () => {
    const persisted = normalizeHistoryMessage({
      role: "assistant",
      content: "Déjame revis",
      runId: "run-1",
    });
    expect(persisted?.content).toBe("Déjame revis");

    const resumed = upsertAssistantMessage([persisted!], {
      role: "assistant",
      content: "ar. Tenemos dos logos.",
      runId: "run-1",
    }, { appendContent: true });

    expect(resumed[0]?.content).toBe("Déjame revisar. Tenemos dos logos.");
  });
});

describe("openclaw commentary progress reconciliation", () => {
  // Contract evidence (HAR-derived, structural): the gateway emits explicit
  // user-facing commentary as `agent` events with stream "assistant" and
  // data.phase "commentary" (cumulative `text`, `replace: true`), mirrors the
  // same text through ordinary `chat` deltas as a prefix of the accumulated
  // visible text, and persists it as text-only assistant rows whose
  // stopReason is "toolUse" while final answers use stopReason "stop".
  const commentary = (text: string, runId = "run-1") => ({
    role: "assistant" as const,
    content: "",
    progress: { text, state: "active" as const, revisions: [] as string[] },
    runId,
    renderId: `${runId}:assistant`,
    timestamp: 1,
  });

  it("creates one progress row from commentary updates without touching content", () => {
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, commentary("Inspecting"), { updateProgress: "replace" });
    messages = upsertAssistantMessage(messages, commentary("Inspecting the workspace"), { updateProgress: "replace" });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: "",
      progress: { text: "Inspecting the workspace", state: "active" },
    });
    expect(messages[0]?.thinking).toBeUndefined();
  });

  it("keeps mirrored ordinary chat text out of the assistant reply content", () => {
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, commentary("Checking credentials"), { updateProgress: "replace" });
    // Mirrored cumulative chat text equals the commentary text.
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "Checking credentials",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 2,
    }, { replaceContent: true });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("");
    expect(messages[0]?.progress?.text).toBe("Checking credentials");
  });

  it("splits a mirrored commentary prefix from the growing final answer tail", () => {
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, commentary("Checking credentials"), { updateProgress: "replace" });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "Checking credentials\nCredentials verified. Two keys are valid.",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 2,
    }, { replaceContent: true });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("\nCredentials verified. Two keys are valid.");
    expect(messages[0]?.progress?.text).toBe("Checking credentials");
  });

  it("strips a near-complete commentary mirror when the final answer replaces its last word", () => {
    const note = "I love that you asked me this. Financial freedom is challenging in the current economy, but possible with the right strategy. Let me research the current options.";
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, commentary(note), { updateProgress: "replace" });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "I love that you asked me this. Financial freedom is challenging in the current economy, but possible with the right strategy. Let me research the current optPerfect. I now have the information I need.",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 2,
    }, { replaceContent: true });

    expect(messages[0]?.content).toBe("Perfect. I now have the information I need.");
    expect(messages[0]?.progress?.text).toBe(note);
  });

  it("keeps an independent answer that only shares a short opening with commentary", () => {
    const note = "I love that you asked me this. Let me research all of the available options before answering.";
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, commentary(note), { updateProgress: "replace" });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "I love that you asked me this, so here is the direct answer.",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 2,
    }, { replaceContent: true });

    expect(messages[0]?.content).toBe("I love that you asked me this, so here is the direct answer.");
  });

  it("reclassifies a mirrored chat prefix when the commentary marker arrives late", () => {
    let messages: ChatMessage[] = [];
    // Ordinary mirrored content first, marker late.
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "Reviewing settings",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 1,
    }, { replaceContent: true });
    expect(messages[0]?.content).toBe("Reviewing settings");

    messages = upsertAssistantMessage(messages, commentary("Reviewing settings"), { updateProgress: "replace" });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toBe("");
    expect(messages[0]?.progress?.text).toBe("Reviewing settings");
  });

  it("handles commentary replacement while the mirrored chat text still carries the older revision", () => {
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, commentary("Reading the config file and 24 more entries"), { updateProgress: "replace" });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "Reading the config file and 24 more entries",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 2,
    }, { replaceContent: true });
    expect(messages[0]?.content).toBe("");

    // The model revises its working note; the mirror has not caught up yet.
    messages = upsertAssistantMessage(messages, commentary("Reading the config"), { updateProgress: "replace" });
    expect(messages[0]?.progress?.text).toBe("Reading the config");
    expect(messages[0]?.content).toBe("");

    // Late mirrored frame carrying the older revision must not reappear as content.
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "Reading the config file and 24 more entries",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 3,
    }, { replaceContent: true });
    expect(messages[0]?.content).toBe("");
    expect(messages[0]?.progress?.text).toBe("Reading the config");
  });

  it("keeps interstitial text that never prefix-matches any commentary revision", () => {
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, commentary("Working on it"), { updateProgress: "replace" });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "A genuinely independent interstitial note.",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 2,
    }, { replaceContent: true });

    expect(messages[0]?.content).toBe("A genuinely independent interstitial note.");
    expect(messages[0]?.progress?.text).toBe("Working on it");
  });

  it("does not let commentary from another run attach to the active row", () => {
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "Run one streamed answer",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 1,
    }, { replaceContent: true });

    messages = upsertAssistantMessage(messages, commentary("Run two working note", "run-2"), { updateProgress: "replace" });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.progress).toBeUndefined();
    expect(messages[1]?.progress?.text).toBe("Run two working note");
  });

  it("settles the prior progress row when a correlated commentary round begins", () => {
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, {
      ...commentary("Inspecting the workspace"),
      messageId: "round-1",
    }, { updateProgress: "replace" });
    messages = upsertAssistantMessage(messages, {
      ...commentary("Checking the deployment"),
      messageId: "round-2",
    }, { updateProgress: "replace" });

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.progress?.state)).toEqual(["settled", "active"]);
    expect(messages.map((message) => message.progress?.text)).toEqual([
      "Inspecting the workspace",
      "Checking the deployment",
    ]);
  });

  it("settles active progress when correlated tool activity begins", () => {
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, {
      ...commentary("Inspecting the workspace"),
      messageId: "round-1",
    }, { updateProgress: "replace" });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "",
      progress: undefined,
      toolCalls: [{ id: "tool-1", name: "read", args: "config.json" }],
      messageId: "round-1",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 2,
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.progress).toMatchObject({
      text: "Inspecting the workspace",
      state: "settled",
    });
    expect(messages[0]?.toolCalls).toEqual([
      expect.objectContaining({ id: "tool-1", name: "read" }),
    ]);
  });

  it("settles progress without losing the note or the final answer", () => {
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, commentary("Checking credentials"), { updateProgress: "replace" });
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "Checking credentials\nCredentials verified.",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 2,
    }, { replaceContent: true });

    const settled = settleAssistantProgress(messages, { renderId: "run-1:assistant" });
    expect(settled[0]?.progress).toMatchObject({ text: "Checking credentials", state: "settled" });
    expect(settled[0]?.content).toContain("Credentials verified.");
    // Settling is idempotent.
    const settledAgain = settleAssistantProgress(settled, { renderId: "run-1:assistant" });
    expect(settledAgain).toEqual(settled);
  });

  it("settles every matching row when an identity is supplied, without touching other sessions", () => {
    let messages: ChatMessage[] = [
      { role: "assistant", content: "", progress: { text: "Session A note", state: "active", revisions: [] }, sessionKey: "session-a", renderId: "a:1", timestamp: 1 },
      { role: "assistant", content: "", progress: { text: "Session B note", state: "active", revisions: [] }, sessionKey: "session-b", renderId: "b:1", timestamp: 2 },
    ];
    messages = settleAssistantProgress(messages, { sessionKey: "session-a" });
    expect(messages[0]?.progress?.state).toBe("settled");
    expect(messages[1]?.progress?.state).toBe("active");
  });

  it("survives 1,000 rapid commentary updates on one row with bounded memory", () => {
    let messages: ChatMessage[] = [];
    for (let update = 0; update < 1000; update += 1) {
      messages = upsertAssistantMessage(
        messages,
        commentary(`Working note revision ${update}`),
        { updateProgress: "replace" },
      );
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]?.progress?.text).toBe("Working note revision 999");
    // Reconciliation memory stays bounded instead of growing one entry per update.
    expect((messages[0]?.progress?.revisions ?? []).length).toBeLessThanOrEqual(16);
    // A late mirrored frame carrying an early revision must not resurface.
    messages = upsertAssistantMessage(messages, {
      role: "assistant",
      content: "Working note revision 999",
      runId: "run-1",
      renderId: "run-1:assistant",
      timestamp: 2,
    }, { replaceContent: true });
    expect(messages[0]?.content).toBe("");
  });

  it("preserves emoji, CJK, RTL, markdown-looking, and HTML-like commentary as plain text", () => {
    const tricky = [
      "🛠️ تحقق من الإعدادات، ثم اكتب التقرير ✅",
      "確認しています。レポートを書きます。",
      "**not markdown** `<script>alert(1)</script>` [link](javascript:alert(1))",
      "line one\nline two <b>stays text</b>",
    ];
    for (const text of tricky) {
      const messages = upsertAssistantMessage([], commentary(text), { updateProgress: "replace" });
      expect(messages[0]?.progress?.text).toBe(text);
      expect(messages[0]?.content).toBe("");
    }
  });

  it("skips empty and whitespace-only commentary updates without creating a row", () => {
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, commentary(""), { updateProgress: "replace" });
    expect(messages).toEqual([]);
    let withContent: ChatMessage[] = [{ role: "assistant", content: "Real answer", runId: "run-1", renderId: "run-1:assistant", timestamp: 1 }];
    withContent = upsertAssistantMessage(withContent, commentary("   "), { updateProgress: "replace" });
    expect(withContent).toHaveLength(1);
    expect(withContent[0]?.progress).toBeUndefined();
    expect(withContent[0]?.content).toBe("Real answer");
  });

  it("marks text-only assistant history rows with stopReason toolUse as settled progress", () => {
    const normalized = normalizeHistoryMessage({
      role: "assistant",
      stopReason: "toolUse",
      timestamp: 10,
      content: [{ type: "text", text: "I scanned the workspace and found two issues." }],
    });

    expect(normalized).not.toBeNull();
    expect(normalized).toMatchObject({
      role: "assistant",
      content: "",
      progress: { text: "I scanned the workspace and found two issues.", state: "settled" },
    });
  });

  it("keeps final answers (stopReason stop) and tool-bearing toolUse rows as ordinary assistant messages", () => {
    const finalAnswer = normalizeHistoryMessage({
      role: "assistant",
      stopReason: "stop",
      timestamp: 11,
      content: [{ type: "text", text: "Both issues are fixed." }],
    });
    expect(finalAnswer?.content).toBe("Both issues are fixed.");
    expect(finalAnswer?.progress).toBeUndefined();

    const withTools = normalizeHistoryMessage({
      role: "assistant",
      stopReason: "toolUse",
      timestamp: 12,
      content: [
        { type: "text", text: "Now running the verifier." },
        { type: "tool_use", id: "tool-1", name: "exec", arguments: { command: "npm test" } },
      ],
    });
    expect(withTools?.content).toBe("Now running the verifier.");
    expect(withTools?.progress).toBeUndefined();
  });

  it("keeps unknown or missing stopReason history rows as ordinary assistant messages", () => {
    for (const stopReason of [undefined, "max_tokens", "stop_sequence"]) {
      const normalized = normalizeHistoryMessage({
        role: "assistant",
        ...(stopReason ? { stopReason } : {}),
        timestamp: 13,
        content: [{ type: "text", text: "Ordinary assistant text." }],
      });
      expect(normalized?.content).toBe("Ordinary assistant text.");
      expect(normalized?.progress).toBeUndefined();
    }
  });

  it("hydrated settled progress round-trips through live merge without duplication", () => {
    const hydrated = normalizeHistoryMessage({
      role: "assistant",
      stopReason: "toolUse",
      messageId: "msg-c1",
      runId: "run-9",
      sessionKey: "main",
      timestamp: 14,
      content: [{ type: "text", text: "Working note from history." }],
    });
    expect(hydrated?.progress?.text).toBe("Working note from history.");

    // A live settle marker for the same row must not create a second row.
    const merged = upsertAssistantMessage([hydrated!], {
      role: "assistant",
      content: "",
      messageId: "msg-c1",
      runId: "run-9",
      sessionKey: "main",
      timestamp: 15,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.progress?.text).toBe("Working note from history.");
    expect(merged[0]?.content).toBe("");
  });

  it("keeps commentary state out of the serialized thinking channel", () => {
    let messages: ChatMessage[] = [];
    messages = upsertAssistantMessage(messages, commentary("Visible working note"), { updateProgress: "replace" });
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain("Visible working note");
    expect(serialized).not.toContain('"thinking"');
    expect(messages[0]).not.toHaveProperty("thinking");
  });
});
