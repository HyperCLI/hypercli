import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Deployments } from "@hypercli.com/sdk/agents";
import { renderHookWithClient } from "@/test/utils";
import { useAgentShell } from "./useAgentShell";
import { useAgentShellActivation } from "./useAgentShellActivation";

type MockSocket = WebSocket & {
  send: ReturnType<typeof vi.fn>;
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
    send: vi.fn(),
    close: vi.fn(),
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
  } as unknown as MockSocket;
}

describe("useAgentShell", () => {
  it("closes a websocket that resolves after the shell is disabled", async () => {
    const pending = deferred<WebSocket>();
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockReturnValue(pending.promise),
    } as unknown as Deployments;

    const { result, rerender } = renderHookWithClient(
      ({ enabled }) => useAgentShell(deployments, { agentId: "agent-1", enabled }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledWith("agent-1"));

    rerender({ enabled: false });
    await act(async () => {
      pending.resolve(socket);
      await Promise.resolve();
    });

    expect(socket.close).toHaveBeenCalledTimes(1);
    act(() => result.current.send("ls\n"));
    expect(socket.send).not.toHaveBeenCalled();
    expect(result.current.status).toBe("disconnected");
  });

  it("keeps input attached to the current agent when a previous connection resolves late", async () => {
    const firstPending = deferred<WebSocket>();
    const secondPending = deferred<WebSocket>();
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    const deployments = {
      shellConnect: vi.fn((agentId: string) =>
        agentId === "agent-1" ? firstPending.promise : secondPending.promise,
      ),
    } as unknown as Deployments;

    const { result, rerender } = renderHookWithClient(
      ({ agentId }) => useAgentShell(deployments, { agentId, enabled: true }),
      { initialProps: { agentId: "agent-1" as string | null } },
    );

    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledWith("agent-1"));

    rerender({ agentId: "agent-2" });
    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledWith("agent-2"));

    await act(async () => {
      secondPending.resolve(secondSocket);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe("connected"));

    act(() => result.current.send("pwd\n"));
    expect(secondSocket.send).toHaveBeenCalledWith("pwd\n");

    await act(async () => {
      firstPending.resolve(firstSocket);
      await Promise.resolve();
    });

    expect(firstSocket.close).toHaveBeenCalledTimes(1);
    expect(firstSocket.send).not.toHaveBeenCalled();
    expect(secondSocket.send).toHaveBeenCalledTimes(1);
  });

  it("sends resize sequences only through the active websocket", async () => {
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;

    const { result } = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true }),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));

    act(() => result.current.resize(24, 80));

    expect(socket.send).toHaveBeenCalledWith("\x1b[8;24;80t");
  });

  it("decodes binary websocket output", async () => {
    const onData = vi.fn();
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;

    const { result } = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true, onData }),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    await waitFor(() => expect(socket.onmessage).toEqual(expect.any(Function)));

    const messageHandler = socket.onmessage as (event: MessageEvent) => void;
    await act(async () => {
      messageHandler({
        data: new TextEncoder().encode("ready\n").buffer,
      } as MessageEvent);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(onData).toHaveBeenCalledWith("ready\n"));
  });

  it("reconnects transient shell closes but not terminal closes", async () => {
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;

    const transient = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true }),
    );

    await waitFor(() => expect(transient.result.current.status).toBe("connected"));

    act(() => {
      socket.onclose?.({ code: 1006, reason: "" } as CloseEvent);
    });

    expect(transient.result.current.status).toBe("reconnecting");
    transient.unmount();

    const terminalSocket = createSocket();
    const terminalDeployments = {
      shellConnect: vi.fn().mockResolvedValue(terminalSocket),
    } as unknown as Deployments;

    const terminal = renderHookWithClient(
      () => useAgentShell(terminalDeployments, { agentId: "agent-1", enabled: true }),
    );

    await waitFor(() => expect(terminal.result.current.status).toBe("connected"));

    act(() => {
      terminalSocket.onclose?.({ code: 1000, reason: "normal closure" } as CloseEvent);
    });

    expect(terminal.result.current.status).toBe("disconnected");
  });

  it("keeps an activated shell socket open while the user switches to another panel", async () => {
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;

    const { result, rerender } = renderHookWithClient(
      ({ activeTab }) => {
        const enabled = useAgentShellActivation({
          agentId: "agent-1",
          agentState: "RUNNING",
          activeTab,
        });
        return useAgentShell(deployments, { agentId: "agent-1", enabled });
      },
      { initialProps: { activeTab: "shell" } },
    );

    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledWith("agent-1"));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    rerender({ activeTab: "files" });

    expect(socket.close).not.toHaveBeenCalled();
    act(() => result.current.send("pwd\n"));
    expect(socket.send).toHaveBeenCalledWith("pwd\n");
  });
});
