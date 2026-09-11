import { describe, expect, it } from "vitest";
import type { RuntimeChatEvent } from "./api";
import { ChatTraceFolder, detailOf, imageMarkdownOf, settleOpenToolCalls, type ChatMessage } from "./chat-trace";

function foldAll(events: RuntimeChatEvent[]): ChatMessage[] {
  const folder = new ChatTraceFolder();
  let messages: ChatMessage[] = [];
  for (const event of events) {
    messages = folder.foldRuntimeEvent(messages, event).messages;
  }
  return messages;
}

describe("ChatTraceFolder", () => {
  it("preserves thinking → tool → message → tools → message chronology across message segments", () => {
    const messages = foldAll([
      { type: "thinking", text: "plan" },
      { type: "tool_call", data: { toolCallId: "t1", title: "bash" } },
      { type: "content", text: "first reply" },
      { type: "tool_call", data: { toolCallId: "t2", title: "bash" } },
      { type: "tool_call", data: { toolCallId: "t3", title: "bash" } },
      { type: "content", text: "second reply" },
    ]);

    expect(messages).toHaveLength(2);
    const [first, second] = messages;
    expect(first.thoughts).toEqual(["plan"]);
    expect(first.toolCalls.map((tool) => tool.id)).toEqual(["t1"]);
    expect(first.text).toBe("first reply");
    expect(second.thoughts).toEqual([]);
    expect(second.toolCalls.map((tool) => tool.id)).toEqual(["t2", "t3"]);
    expect(second.text).toBe("second reply");
  });

  it("keeps a plain multi-chunk reply in a single message", () => {
    const messages = foldAll([
      { type: "content", text: "hello " },
      { type: "content", text: "world" },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("hello world");
  });

  it("correlates id-less tool events by name so results land live", () => {
    const messages = foldAll([
      { type: "tool_call", data: { title: "bash" } },
      { type: "tool_call", data: { title: "read" } },
      { type: "tool_result", data: { title: "bash" } },
    ]);
    const tools = messages[0].toolCalls;
    expect(tools).toHaveLength(2);
    expect(tools[0].status).toBe("completed");
    expect(tools[1].status).toBe("in_progress");
  });

  it("settles all still-open tool calls when the runtime reports done", () => {
    const messages = foldAll([
      { type: "tool_call", data: { title: "bash" } },
      { type: "tool_call", data: { toolCallId: "t2", title: "bash" } },
      { type: "done", data: {} },
    ]);
    const statuses = messages[0].toolCalls.map((tool) => tool.status);
    expect(statuses).toEqual(["completed", "completed"]);
  });
});

describe("settleOpenToolCalls", () => {
  it("sweeps pending and in_progress tools without touching completed ones", () => {
    const base: ChatMessage[] = foldAll([{ type: "content", text: "hi" }]);
    const withTools: ChatMessage[] = [
      {
        ...base[0],
        toolCalls: [
          { id: "a", title: "bash", status: "in_progress" },
          { id: "b", title: "bash", status: "completed" },
          { id: "c", title: "bash", status: "pending" },
        ],
      },
    ];
    const settled = settleOpenToolCalls(withTools, "interrupted");
    expect(settled[0].toolCalls.map((tool) => tool.status)).toEqual(["interrupted", "completed", "interrupted"]);
  });
});

describe("detailOf", () => {
  it("never stringifies array items to [object Object]", () => {
    expect(detailOf([{ command: "ls -la" }, { path: "/tmp/x.png" }])).toBe("ls -la /tmp/x.png");
    expect(detailOf([])).toBeUndefined();
  });
});

describe("imageMarkdownOf", () => {
  it("converts base64 image blocks to data-URI markdown", () => {
    expect(imageMarkdownOf({ type: "image", data: "QUJD", mimeType: "image/png" })).toBe(
      "![image](data:image/png;base64,QUJD)",
    );
  });

  it("prefers a uri over inline data", () => {
    expect(imageMarkdownOf({ type: "image", uri: "https://x/y.png", data: "QUJD" })).toBe(
      "![image](https://x/y.png)",
    );
  });

  it("ignores text and audio blocks", () => {
    expect(imageMarkdownOf({ type: "text", text: "hi" })).toBeUndefined();
    expect(imageMarkdownOf({ type: "audio", data: "QUJD" })).toBeUndefined();
  });
});

describe("tool diff extraction", () => {
  it("attaches edit diffs from tool_call args", () => {
    const messages = foldAll([
      {
        type: "tool_call",
        data: {
          toolCallId: "t1",
          title: "edit",
          args: { filePath: "/workspace/app.ts", oldString: "a\n", newString: "b\n" },
        },
      },
    ]);
    expect(messages[0].toolCalls[0].diffs).toEqual([
      { path: "/workspace/app.ts", oldText: "a\n", newText: "b\n" },
    ]);
  });

  it("attaches diff content blocks from tool_result data", () => {
    const messages = foldAll([
      { type: "tool_call", data: { toolCallId: "t1", title: "edit" } },
      {
        type: "tool_result",
        data: {
          toolCallId: "t1",
          title: "edit",
          content: [{ type: "diff", path: "/w/x.ts", oldText: "1\n", newText: "2\n" }],
        },
      },
    ]);
    expect(messages[0].toolCalls[0].diffs).toEqual([
      { path: "/w/x.ts", oldText: "1\n", newText: "2\n" },
    ]);
  });

  it("leaves diffs undefined for non-file tools", () => {
    const messages = foldAll([
      { type: "tool_call", data: { toolCallId: "t1", title: "bash", args: { command: "ls" } } },
    ]);
    expect(messages[0].toolCalls[0].diffs).toBeUndefined();
  });
});
