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
      firstSocket.onmessage?.({ data: "agent-1 log" } as MessageEvent);
      await Promise.resolve();
    });
    expect(result.current.logs).toEqual(["agent-1 log"]);

    rerender({ agentId: "agent-2" });

    await waitFor(() => expect(result.current.logs).toEqual([]));
    await waitFor(() => expect(result.current.status).toBe("connected"));
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
