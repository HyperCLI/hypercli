import { test, expect } from "@playwright/experimental-ct-react";
import { ChatMessageBubble, ChatThinkingIndicator } from "./ChatMessage";
import type { ChatMessage } from "@/hooks/useGatewayChat";

// ── Fixtures ──

const userMsg: ChatMessage = {
  role: "user",
  content: "Can you help me with something?",
  timestamp: Date.now(),
};

const assistantMsg: ChatMessage = {
  role: "assistant",
  content: "Of course! Here's how to get started:\n\n```bash\nnpm install\n```\n\nThat should do it.",
  timestamp: Date.now(),
};

const thinkingMsg: ChatMessage = {
  role: "assistant",
  content: "The issue is in the connect() method.",
  thinking: "Let me analyze this step by step.\n\nThe WebSocket lifecycle has a race condition.",
  timestamp: Date.now(),
};

const toolCallMsg: ChatMessage = {
  role: "assistant",
  content: "Found the bug on line 142.",
  toolCalls: [
    {
      id: "call_1",
      name: "Read",
      args: '{"file_path": "src/gateway.ts"}',
      result: "async connect() { ... }",
    },
  ],
  timestamp: Date.now(),
};

const toolPendingMsg: ChatMessage = {
  role: "assistant",
  content: "",
  toolCalls: [{ id: "call_2", name: "Bash", args: '{"command": "npm run build"}' }],
  timestamp: Date.now(),
};

const systemMsg: ChatMessage = {
  role: "system",
  content: "Error: WebSocket closed (code 1006)",
  timestamp: Date.now(),
};

// ── ChatMessageBubble Tests ──

test.describe("ChatMessageBubble", () => {
  test("renders user message content", async ({ mount }) => {
    const component = await mount(<ChatMessageBubble message={userMsg} />);
    await expect(component.getByText("Can you help me with something?")).toBeVisible();
  });

  test("renders assistant message with markdown", async ({ mount }) => {
    const component = await mount(<ChatMessageBubble message={assistantMsg} />);
    await expect(component.getByText("npm install")).toBeVisible();
  });

  test("renders system message with error styling", async ({ mount }) => {
    const component = await mount(<ChatMessageBubble message={systemMsg} />);
    await expect(component.getByText(/WebSocket closed/)).toBeVisible();
  });

  test("thinking section toggles on click", async ({ mount }) => {
    const component = await mount(<ChatMessageBubble message={thinkingMsg} />);
    const toggle = component.getByText("Show reasoning");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(component.getByText("Hide reasoning")).toBeVisible();
    await expect(component.getByText(/race condition/)).toBeVisible();
  });

  test("tool call section toggles on click", async ({ mount }) => {
    const component = await mount(<ChatMessageBubble message={toolCallMsg} />);
    await expect(component.getByText("Read")).toBeVisible();
    await component.getByText("Read").click();
    await expect(component.getByText(/gateway\.ts/)).toBeVisible();
  });

  test("pending tool call shows spinner", async ({ mount }) => {
    const component = await mount(<ChatMessageBubble message={toolPendingMsg} />);
    await expect(component.getByText("Bash")).toBeVisible();
  });

  // ── Variant tests ──

  test("bubblesVariant v1 applies rounded-2xl", async ({ mount }) => {
    const component = await mount(
      <ChatMessageBubble message={userMsg} bubblesVariant="v1" />,
    );
    await expect(component).toBeVisible();
  });

  test("bubblesVariant v2 applies rounded-3xl", async ({ mount }) => {
    const component = await mount(
      <ChatMessageBubble message={userMsg} bubblesVariant="v2" />,
    );
    await expect(component).toBeVisible();
  });

  test("nameVariant v1 shows agent monogram", async ({ mount }) => {
    const component = await mount(
      <ChatMessageBubble message={assistantMsg} nameVariant="v1" agentName="TestBot" />,
    );
    await expect(component.getByText("T")).toBeVisible();
    await expect(component.getByText("TestBot")).toBeVisible();
  });

  test("nameVariant v2 shows avatar circle", async ({ mount }) => {
    const component = await mount(
      <ChatMessageBubble message={assistantMsg} nameVariant="v2" agentName="Agent" />,
    );
    await expect(component.getByText("A")).toBeVisible();
  });

  test("timestampVariant v1 shows always-visible time", async ({ mount }) => {
    const component = await mount(
      <ChatMessageBubble message={assistantMsg} timestampVariant="v1" />,
    );
    // Should show HH:MM format
    await expect(component.locator("text=/\\d{1,2}:\\d{2}/")).toBeVisible();
  });

  test("streamingVariant v2 shows pulsing dot when streaming", async ({ mount }) => {
    const component = await mount(
      <ChatMessageBubble message={assistantMsg} streamingVariant="v2" isStreaming={true} />,
    );
    await expect(component).toBeVisible();
  });

  test("themeVariant v2 applies green user + dark assistant", async ({ mount }) => {
    const user = await mount(
      <ChatMessageBubble message={userMsg} themeVariant="v2" />,
    );
    await expect(user).toBeVisible();

    const assistant = await mount(
      <ChatMessageBubble message={assistantMsg} themeVariant="v2" />,
    );
    await expect(assistant).toBeVisible();
  });

  test("all variants combined render without errors", async ({ mount }) => {
    const component = await mount(
      <ChatMessageBubble
        message={thinkingMsg}
        bubblesVariant="v2"
        themeVariant="v2"
        nameVariant="v2"
        timestampVariant="v2"
        animationVariant="v2"
        streamingVariant="v2"
        agentName="TestBot"
      />,
    );
    await expect(component).toBeVisible();
  });
});

// ── ChatThinkingIndicator Tests ──

test.describe("ChatThinkingIndicator", () => {
  test("off variant renders default dots", async ({ mount }) => {
    const component = await mount(<ChatThinkingIndicator variant="off" />);
    await expect(component.getByText("Thinking")).toBeVisible();
  });

  test("v1 variant renders brain shimmer", async ({ mount }) => {
    const component = await mount(<ChatThinkingIndicator variant="v1" />);
    await expect(component.getByText("Thinking...")).toBeVisible();
  });

  test("v2 variant renders dark pill", async ({ mount }) => {
    const component = await mount(<ChatThinkingIndicator variant="v2" />);
    await expect(component).toBeVisible();
  });

  test("v3 variant renders gradient text", async ({ mount }) => {
    const component = await mount(<ChatThinkingIndicator variant="v3" />);
    await expect(component.getByText("Working...")).toBeVisible();
  });
});
