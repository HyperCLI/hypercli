import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSessionClient, AgentSessionSummary } from "@hypercli.com/sdk/session";
import type { HermesAgent } from "@hypercli.com/sdk/agents";
import { useHermesSession } from "./useHermesSession";

function fakeClient(overrides: Partial<AgentSessionClient> = {}): AgentSessionClient {
  return {
    runtimeKind: "hermes",
    state: "connected",
    connected: true,
    native: null,
    connect: vi.fn(async () => undefined),
    close: vi.fn(),
    sessionsList: vi.fn(async () => [] as AgentSessionSummary[]),
    sessionsCreate: vi.fn(async () => ({ key: "sess-new", label: null, model: null })),
    sessionsPatch: vi.fn(async (patch) => ({ key: patch.key, label: patch.label ?? null, model: patch.model ?? null })),
    sessionsDelete: vi.fn(async () => undefined),
    chatHistory: vi.fn(async () => []),
    chatSend: vi.fn(async function* () {
      yield { type: "done" as const };
    }),
    chatAbort: vi.fn(async () => undefined),
    modelsList: vi.fn(async () => []),
    ...overrides,
  };
}

function fakeAgent(client: AgentSessionClient): HermesAgent {
  return { connect: vi.fn(async () => client) } as unknown as HermesAgent;
}

describe("useHermesSession (AgentGatewaySession adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the hermes backend and connects with an auto-created first session", async () => {
    const client = fakeClient({
      chatHistory: vi.fn(async () => [
        { role: "user", text: "hello", messageId: "m1" },
        { role: "assistant", text: "hi", messageId: "m2" },
      ]),
    });
    const agent = fakeAgent(client);

    const { result } = renderHook(() => useHermesSession(agent, true));

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.backend).toBe("hermes");
    expect(result.current.activeSessionKey).toBe("sess-new");
    expect(client.sessionsCreate).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.historyPhase).toBe("ready");
    expect(result.current.messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(result.current.activeSessionCanSend).toBe(true);
    expect(result.current.sessionsFetched).toBe(true);
  });

  it("adopts the most recent existing session and maps session records", async () => {
    const client = fakeClient({
      sessionsList: vi.fn(async () => [
        { key: "sess-1", label: "Older" },
        { key: "sess-2", label: "Newer" },
      ]),
    });
    const agent = fakeAgent(client);

    const { result } = renderHook(() => useHermesSession(agent, true));

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.activeSessionKey).toBe("sess-2");
    expect(client.sessionsCreate).not.toHaveBeenCalled();
    expect(result.current.sessions[0]).toMatchObject({ key: "sess-2", label: "Newer" });
  });

  it("honors a requested session key from the route", async () => {
    const client = fakeClient({
      sessionsList: vi.fn(async () => [
        { key: "sess-1", label: "Older" },
        { key: "sess-2", label: "Newer" },
      ]),
    });
    const agent = fakeAgent(client);

    const { result } = renderHook(() => useHermesSession(agent, true, "sess-1"));

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.activeSessionKey).toBe("sess-1"));
  });

  it("streams content into ChatMessage rows and finishes on done", async () => {
    const client = fakeClient({
      sessionsList: vi.fn(async () => [{ key: "sess-1", label: "Chat" }]),
      chatSend: vi.fn(async function* () {
        yield { type: "content" as const, text: "Hel" };
        yield { type: "content" as const, text: "lo" };
        yield { type: "tool_call" as const, data: { name: "terminal", args: { command: "ls" } } };
        yield { type: "done" as const };
      }),
    });
    const agent = fakeAgent(client);

    const { result } = renderHook(() => useHermesSession(agent, true));
    await waitFor(() => expect(result.current.connected).toBe(true));

    await act(async () => {
      await result.current.sendMessage("hello there");
    });

    expect(result.current.sending).toBe(false);
    expect(result.current.messages[0]).toMatchObject({ role: "user", content: "hello there" });
    const assistant = result.current.messages[1];
    expect(assistant).toMatchObject({ role: "assistant", content: "Hello" });
    expect(assistant.toolCalls).toEqual([{ name: "terminal", args: JSON.stringify({ command: "ls" }) }]);
    expect(client.chatSend).toHaveBeenCalledWith("hello there", "sess-1", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("marks aborted turns interrupted and swallows the no-active-run abort miss", async () => {
    let release!: () => void;
    const client = fakeClient({
      sessionsList: vi.fn(async () => [{ key: "sess-1" }]),
      chatAbort: vi.fn(async () => { throw new Error("Hermes chat abort requires an active run id"); }),
      chatSend: vi.fn(async function* () {
        yield { type: "content" as const, text: "partial" };
        await new Promise<void>((resolve) => { release = resolve; });
        yield { type: "done" as const };
      }),
    });
    const agent = fakeAgent(client);

    const { result } = renderHook(() => useHermesSession(agent, true));
    await waitFor(() => expect(result.current.connected).toBe(true));

    let sendDone: Promise<void> | null = null;
    act(() => {
      sendDone = result.current.sendMessage("hi") as unknown as Promise<void>;
    });
    await waitFor(() => expect(result.current.sending).toBe(true));

    await act(async () => {
      await result.current.abortMessage();
      release();
      await sendDone;
    });

    const assistant = result.current.messages[1];
    expect(assistant).toMatchObject({ role: "assistant", content: "partial", status: "interrupted" });
    expect(result.current.aborting).toBe(false);
  });

  it("surfaces connect failures and recovers through retry", async () => {
    const failing = fakeClient();
    const agent = {
      connect: vi.fn()
        .mockRejectedValueOnce(new Error("route not ready"))
        .mockResolvedValue(failing),
    } as unknown as HermesAgent;

    const { result } = renderHook(() => useHermesSession(agent, true));

    await waitFor(() => expect(result.current.error).toBe("route not ready"));
    expect(result.current.connected).toBe(false);
    expect(result.current.activeSessionCanSend).toBe(false);

    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it("carries stable inert defaults for openclaw-only members", async () => {
    const client = fakeClient();
    const agent = fakeAgent(client);

    const { result, rerender } = renderHook(() => useHermesSession(agent, true));
    await waitFor(() => expect(result.current.connected).toBe(true));

    const first = result.current;
    rerender();
    const second = result.current;

    expect(first.config).toBeNull();
    expect(first.cronJobs).toEqual([]);
    expect(first.reportedChannelsReady).toBe(true);
    expect(first.temporaryChatState).toBe("inactive");
    expect(first.skillsProvider).toBeNull();
    // Composer send gate reads these as a number and arrays.
    expect(first.pendingAttachmentReads).toBe(0);
    expect(first.pendingFiles).toEqual([]);
    expect(first.pendingAttachments).toEqual([]);
    // Inert identities must not change between renders (effect-dep safety).
    expect(second.cronJobs).toBe(first.cronJobs);
    expect(second.reportedChannels).toBe(first.reportedChannels);
    expect(second.endTemporaryChat).toBe(first.endTemporaryChat);
    expect(second.saveConfig).toBe(first.saveConfig);
  });

  it("does not reconnect or wipe messages when the roster rehydrates the same agent", async () => {
    const client = fakeClient({
      sessionsList: vi.fn(async () => [{ key: "sess-1", label: "Chat" }]),
      chatHistory: vi.fn(async () => [{ role: "user", text: "kept", messageId: "m1" }]),
    });
    const firstAgent = { id: "agent-1", launchEpoch: 3, connect: vi.fn(async () => client) } as unknown as HermesAgent;
    const rehydratedAgent = { id: "agent-1", launchEpoch: 3, connect: vi.fn(async () => client) } as unknown as HermesAgent;

    const { result, rerender } = renderHook(
      ({ current }: { current: HermesAgent }) => useHermesSession(current, true),
      { initialProps: { current: firstAgent } },
    );
    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    rerender({ current: rehydratedAgent });

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]).toMatchObject({ content: "kept" });
    expect(rehydratedAgent.connect).not.toHaveBeenCalled();
    expect(client.close).not.toHaveBeenCalled();
  });

  it("resets when disabled and closes the client on agent change", async () => {
    const client = fakeClient();
    const agent = fakeAgent(client);

    const { result, rerender } = renderHook(
      ({ current, enabled }: { current: HermesAgent | null; enabled: boolean }) => useHermesSession(current, enabled),
      { initialProps: { current: null as HermesAgent | null, enabled: false } },
    );
    expect(result.current.connected).toBe(false);

    rerender({ current: agent, enabled: true });
    await waitFor(() => expect(result.current.connected).toBe(true));

    rerender({ current: null, enabled: false });
    await waitFor(() => expect(result.current.connected).toBe(false));
    expect(result.current.messages).toEqual([]);
    expect(client.close).toHaveBeenCalled();
  });
});
