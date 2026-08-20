import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Deployments } from "@hypercli.com/sdk/agents";
import { renderHookWithClient } from "@/test/utils";
import { useAgentLogs } from "./useAgentLogs";

type MockSocket = WebSocket & {
  close: ReturnType<typeof vi.fn>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function logFrame(line: string): MessageEvent {
  return { data: JSON.stringify({ event: "log", log: line }) } as MessageEvent;
}

function createSocket(): MockSocket {
  return {
    readyState: WebSocket.OPEN,
    close: vi.fn(),
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
  } as unknown as MockSocket;
}

describe("useAgentLogs", () => {
  it("closes a websocket that resolves after logs are disabled", async () => {
    const pending = deferred<WebSocket>();
    const socket = createSocket();
    const deployments = {
      logsConnect: vi.fn().mockReturnValue(pending.promise),
    } as unknown as Deployments;

    const { result, rerender } = renderHookWithClient(
      ({ enabled }) => useAgentLogs(deployments, "agent-1", enabled),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(deployments.logsConnect).toHaveBeenCalledWith("agent-1"));

    rerender({ enabled: false });
    await act(async () => {
      pending.resolve(socket);
      await Promise.resolve();
    });

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("disconnected");
  });

  it("keeps the current agent connection when a previous connection resolves late", async () => {
    const firstPending = deferred<WebSocket>();
    const secondPending = deferred<WebSocket>();
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    const deployments = {
      logsConnect: vi.fn((agentId: string) =>
        agentId === "agent-1" ? firstPending.promise : secondPending.promise,
      ),
    } as unknown as Deployments;

    const { result, rerender } = renderHookWithClient(
      ({ agentId }) => useAgentLogs(deployments, agentId, true),
      { initialProps: { agentId: "agent-1" as string | null } },
    );

    await waitFor(() => expect(deployments.logsConnect).toHaveBeenCalledWith("agent-1"));

    rerender({ agentId: "agent-2" });
    await waitFor(() => expect(deployments.logsConnect).toHaveBeenCalledWith("agent-2"));

    await act(async () => {
      secondPending.resolve(secondSocket);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe("connected"));

    await act(async () => {
      firstPending.resolve(firstSocket);
      await Promise.resolve();
    });

    expect(firstSocket.close).toHaveBeenCalledTimes(1);
    expect(secondSocket.close).not.toHaveBeenCalled();
    expect(result.current.status).toBe("connected");
  });

  it("clears old log lines when opening a new agent log stream", async () => {
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    const deployments = {
      logsConnect: vi.fn((agentId: string) => Promise.resolve(agentId === "agent-1" ? firstSocket : secondSocket)),
    } as unknown as Deployments;

    const { result, rerender } = renderHookWithClient(
      ({ agentId }) => useAgentLogs(deployments, agentId, true),
      { initialProps: { agentId: "agent-1" as string | null } },
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    await act(async () => {
      firstSocket.onmessage?.(logFrame("agent-1 log"));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.logs).toEqual(["agent-1 log"]));

    rerender({ agentId: "agent-2" });

    await waitFor(() => expect(result.current.logs).toEqual([]));
    await waitFor(() => expect(result.current.status).toBe("connected"));
  });

  it("renders log envelopes and never renders the history_end marker", async () => {
    const socket = createSocket();
    const deployments = {
      logsConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;
    const { result } = renderHookWithClient(
      () => useAgentLogs(deployments, "agent-1", true),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    await act(async () => {
      socket.onmessage?.(logFrame("history line"));
      socket.onmessage?.({ data: JSON.stringify({ event: "history_end" }) } as MessageEvent);
      socket.onmessage?.(logFrame("live line"));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.logs).toEqual(["history line", "live line"]));
    expect(result.current.logs.join("\n")).not.toContain("history_end");
  });

  it("surfaces error frames instead of rendering them as log lines", async () => {
    const socket = createSocket();
    const deployments = {
      logsConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;
    const { result } = renderHookWithClient(
      () => useAgentLogs(deployments, "agent-1", true),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    await act(async () => {
      socket.onmessage?.({
        data: JSON.stringify({ event: "error", detail: "log stream unavailable" }),
      } as MessageEvent);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.error).toBe("log stream unavailable"));
    expect(result.current.logs).toEqual([]);
  });

  it("renders a non-JSON frame raw without crashing", async () => {
    const socket = createSocket();
    const deployments = {
      logsConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;
    const { result } = renderHookWithClient(
      () => useAgentLogs(deployments, "agent-1", true),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    await act(async () => {
      socket.onmessage?.({ data: "not json {" } as MessageEvent);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.logs).toEqual(["not json {"]));
    expect(result.current.error).toBeNull();
  });

  it("bounds a single oversized log event by character count", async () => {
    const socket = createSocket();
    const deployments = {
      logsConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;
    const { result } = renderHookWithClient(
      () => useAgentLogs(deployments, "agent-1", true),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    act(() => {
      socket.onmessage?.(logFrame(`prefix-${"x".repeat(1_000_000)}`));
    });

    await waitFor(() => expect(result.current.logs).toHaveLength(1));
    expect(result.current.logs[0]).toHaveLength(1_000_000);
    expect(result.current.logs[0]).not.toContain("prefix-");
  });

  it("reconnects transient closes but not terminal closes", async () => {
    const socket = createSocket();
    const deployments = {
      logsConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;

    const transient = renderHookWithClient(
      () => useAgentLogs(deployments, "agent-1", true),
    );

    await waitFor(() => expect(transient.result.current.status).toBe("connected"));

    act(() => {
      socket.onclose?.({ code: 1006, reason: "" } as CloseEvent);
    });

    expect(transient.result.current.status).toBe("reconnecting");
    transient.unmount();

    const terminalSocket = createSocket();
    const terminalDeployments = {
      logsConnect: vi.fn().mockResolvedValue(terminalSocket),
    } as unknown as Deployments;

    const terminal = renderHookWithClient(
      () => useAgentLogs(terminalDeployments, "agent-1", true),
    );

    await waitFor(() => expect(terminal.result.current.status).toBe("connected"));

    act(() => {
      terminalSocket.onclose?.({ code: 1000, reason: "normal closure" } as CloseEvent);
    });

    expect(terminal.result.current.status).toBe("disconnected");
  });
});
