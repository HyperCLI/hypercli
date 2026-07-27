import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
  } as unknown as MockSocket;
}

describe("useAgentShell", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes a websocket that resolves after the shell is disabled", async () => {
    const pending = deferred<WebSocket>();
    const socket = createSocket();
    const shellConnect = vi.fn().mockReturnValue(pending.promise);
    const deployments = {
      shellConnect,
    } as unknown as Deployments;

    const { result, rerender } = renderHookWithClient(
      ({ enabled }) => useAgentShell(deployments, { agentId: "agent-1", enabled }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledWith(
      "agent-1",
      undefined,
      { signal: expect.any(AbortSignal) },
    ));
    const signal = shellConnect.mock.calls[0][2]?.signal;

    rerender({ enabled: false });
    expect(signal?.aborted).toBe(true);
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

    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledWith(
      "agent-1",
      undefined,
      { signal: expect.any(AbortSignal) },
    ));

    rerender({ agentId: "agent-2" });
    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledWith(
      "agent-2",
      undefined,
      { signal: expect.any(AbortSignal) },
    ));

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
    expect(socket.binaryType).toBe("arraybuffer");
  });

  it("preserves UTF-8 characters split across websocket frames", async () => {
    const onData = vi.fn();
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;

    const { result } = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true, onData }),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    const messageHandler = socket.onmessage as (event: MessageEvent) => void;

    act(() => {
      messageHandler({ data: new Uint8Array([0xe2]).buffer } as MessageEvent);
      messageHandler({ data: new Uint8Array([0x82, 0xac]).buffer } as MessageEvent);
    });

    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith("€");
  });

  it("keeps first output immediate and coalesces the rest of a websocket burst", async () => {
    const onData = vi.fn();
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;
    const { result } = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true, onData }),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    const messageHandler = socket.onmessage as (event: MessageEvent) => void;

    act(() => {
      messageHandler({ data: "first" } as MessageEvent);
      messageHandler({ data: "second" } as MessageEvent);
      messageHandler({ data: "third" } as MessageEvent);
    });

    expect(onData).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenNthCalledWith(1, "first");
    await waitFor(() => expect(onData).toHaveBeenCalledTimes(2));
    expect(onData).toHaveBeenNthCalledWith(2, "secondthird");
  });

  it("keeps asynchronous blob output ordered with following frames", async () => {
    const onData = vi.fn();
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;

    const { result } = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true, onData }),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    const messageHandler = socket.onmessage as (event: MessageEvent) => void;
    const blob = new Blob([]);
    Object.defineProperty(blob, "text", { value: vi.fn().mockResolvedValue("first") });

    act(() => {
      messageHandler({ data: blob } as MessageEvent);
      messageHandler({ data: new TextEncoder().encode("second").buffer } as MessageEvent);
    });

    await waitFor(() => expect(onData).toHaveBeenCalledTimes(2));
    expect(onData.mock.calls.map(([data]) => data)).toEqual(["first", "second"]);
  });

  it("drains delayed blob output received before a normal socket close", async () => {
    const onData = vi.fn();
    const decoded = deferred<string>();
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;

    const { result } = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true, onData }),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    const blob = new Blob([]);
    Object.defineProperty(blob, "text", { value: vi.fn().mockReturnValue(decoded.promise) });

    act(() => {
      socket.onmessage?.({ data: blob } as MessageEvent);
      socket.onclose?.({ code: 1000, reason: "normal closure" } as CloseEvent);
    });
    await act(async () => {
      decoded.resolve("final output");
      await decoded.promise;
      await Promise.resolve();
    });

    await waitFor(() => expect(onData).toHaveBeenCalledWith("final output"));
  });

  it("drops delayed blob output after an explicit shell cleanup", async () => {
    const onData = vi.fn();
    const decoded = deferred<string>();
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;
    const shell = renderHookWithClient(
      ({ enabled }) => useAgentShell(deployments, { agentId: "agent-1", enabled, onData }),
      { initialProps: { enabled: true } },
    );
    await waitFor(() => expect(shell.result.current.status).toBe("connected"));
    const blob = new Blob([]);
    Object.defineProperty(blob, "text", { value: vi.fn().mockReturnValue(decoded.promise) });
    act(() => socket.onmessage?.({ data: blob } as MessageEvent));

    await act(async () => {
      shell.rerender({ enabled: false });
      await Promise.resolve();
    });
    await act(async () => {
      decoded.resolve("stale output");
      await decoded.promise;
      await Promise.resolve();
    });

    expect(onData).not.toHaveBeenCalled();
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

  it("falls back to sh when bash closes as unavailable after opening", async () => {
    const bashSocket = createSocket();
    const shSocket = createSocket();
    const shellConnect = vi.fn((_: string, shell?: string) => Promise.resolve(
      shell === "/bin/sh" ? shSocket : bashSocket,
    ));
    const deployments = { shellConnect } as unknown as Deployments;

    const { result } = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));

    act(() => {
      bashSocket.onclose?.({ code: 1006, reason: "/bin/bash not found" } as CloseEvent);
    });

    await waitFor(() => expect(shellConnect).toHaveBeenCalledTimes(2));
    expect(shellConnect).toHaveBeenLastCalledWith(
      "agent-1",
      "/bin/sh",
      { signal: expect.any(AbortSignal) },
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
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

    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledWith(
      "agent-1",
      undefined,
      { signal: expect.any(AbortSignal) },
    ));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    rerender({ activeTab: "files" });

    expect(socket.close).not.toHaveBeenCalled();
    act(() => result.current.send("pwd\n"));
    expect(socket.send).toHaveBeenCalledWith("pwd\n");
  });

  it("keeps a healthy hidden socket but defers reconnect until Shell is active again", async () => {
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    const deployments = {
      shellConnect: vi.fn()
        .mockResolvedValueOnce(firstSocket)
        .mockResolvedValueOnce(secondSocket),
    } as unknown as Deployments;
    const shell = renderHookWithClient(
      ({ reconnectEnabled }) => useAgentShell(deployments, {
        agentId: "agent-1",
        enabled: true,
        reconnectEnabled,
      }),
      { initialProps: { reconnectEnabled: true } },
    );
    await waitFor(() => expect(shell.result.current.status).toBe("connected"));

    shell.rerender({ reconnectEnabled: false });
    expect(firstSocket.close).not.toHaveBeenCalled();
    act(() => firstSocket.onclose?.({ code: 1006, reason: "network lost" } as CloseEvent));
    expect(shell.result.current.status).toBe("disconnected");

    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(deployments.shellConnect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    shell.rerender({ reconnectEnabled: true });
    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(shell.result.current.status).toBe("connected"));
  });

  it("cancels a scheduled reconnect when Shell becomes hidden during backoff", async () => {
    const firstSocket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(firstSocket),
    } as unknown as Deployments;
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const shell = renderHookWithClient(
      ({ reconnectEnabled }) => useAgentShell(deployments, {
        agentId: "agent-1",
        enabled: true,
        reconnectEnabled,
      }),
      { initialProps: { reconnectEnabled: true } },
    );
    await waitFor(() => expect(shell.result.current.status).toBe("connected"));

    vi.useFakeTimers();
    act(() => firstSocket.onclose?.({ code: 1006, reason: "network lost" } as CloseEvent));
    expect(shell.result.current.status).toBe("reconnecting");
    shell.rerender({ reconnectEnabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(deployments.shellConnect).toHaveBeenCalledTimes(1);
    expect(shell.result.current.status).toBe("disconnected");
    vi.useRealTimers();
    random.mockRestore();
  });

  it("reconnects an abnormal closure instead of matching it as a normal close", async () => {
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    const deployments = {
      shellConnect: vi.fn()
        .mockResolvedValueOnce(firstSocket)
        .mockResolvedValueOnce(secondSocket),
    } as unknown as Deployments;
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const shell = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true }),
    );
    await waitFor(() => expect(shell.result.current.status).toBe("connected"));

    vi.useFakeTimers();
    act(() => firstSocket.onclose?.({ code: 1006, reason: "abnormal closure" } as CloseEvent));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(deployments.shellConnect).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    random.mockRestore();
    shell.unmount();
  });

  it("increases backoff when sockets flap before the stability window", async () => {
    const sockets = [createSocket(), createSocket(), createSocket()];
    const deployments = {
      shellConnect: vi.fn()
        .mockResolvedValueOnce(sockets[0])
        .mockResolvedValueOnce(sockets[1])
        .mockResolvedValueOnce(sockets[2]),
    } as unknown as Deployments;
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const shell = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true }),
    );
    await waitFor(() => expect(shell.result.current.status).toBe("connected"));

    vi.useFakeTimers();
    act(() => sockets[0].onclose?.({ code: 1006, reason: "network lost" } as CloseEvent));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(deployments.shellConnect).toHaveBeenCalledTimes(2);
    expect(shell.result.current.status).toBe("connected");

    act(() => sockets[1].onclose?.({ code: 1006, reason: "network lost" } as CloseEvent));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(deployments.shellConnect).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(deployments.shellConnect).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
    random.mockRestore();
    shell.unmount();
  });

  it("does not automatically retry a permanent setup failure", async () => {
    const deployments = {
      shellConnect: vi.fn().mockRejectedValue({ statusCode: 403 }),
    } as unknown as Deployments;
    const shell = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true }),
    );

    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(shell.result.current.status).toBe("disconnected"));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(deployments.shellConnect).toHaveBeenCalledTimes(1);
  });

  it("does not retry a terminal close reported before the socket opens", async () => {
    const deployments = {
      shellConnect: vi.fn().mockRejectedValue({ closeCode: 4403, closeReason: "forbidden" }),
    } as unknown as Deployments;
    const shell = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true }),
    );

    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(shell.result.current.status).toBe("disconnected"));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(deployments.shellConnect).toHaveBeenCalledTimes(1);
  });

  it("does not retry a permanent authentication failure without structured metadata", async () => {
    const deployments = {
      shellConnect: vi.fn().mockRejectedValue(new Error("Token exchange failed: 401 - invalid token")),
    } as unknown as Deployments;
    const shell = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true }),
    );

    await waitFor(() => expect(shell.result.current.status).toBe("disconnected"));
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(deployments.shellConnect).toHaveBeenCalledTimes(1);
  });

  it("starts the shell connection from navigation intent before the tab changes", async () => {
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;

    const { result, rerender } = renderHookWithClient(
      ({ intent }) => {
        const enabled = useAgentShellActivation({
          agentId: "agent-1",
          agentState: "RUNNING",
          activeTab: "chat",
          intent,
        });
        return useAgentShell(deployments, { agentId: "agent-1", enabled });
      },
      { initialProps: { intent: false } },
    );

    expect(deployments.shellConnect).not.toHaveBeenCalled();
    rerender({ intent: true });

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(deployments.shellConnect).toHaveBeenCalledTimes(1);
  });

  it("does not start overlapping connection attempts while one is pending", async () => {
    const pending = deferred<WebSocket>();
    const deployments = {
      shellConnect: vi.fn().mockReturnValue(pending.promise),
    } as unknown as Deployments;

    const shell = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true }),
    );

    await waitFor(() => expect(deployments.shellConnect).toHaveBeenCalledTimes(1));
    act(() => window.dispatchEvent(new Event("online")));
    await Promise.resolve();

    expect(deployments.shellConnect).toHaveBeenCalledTimes(1);
    shell.unmount();
  });

  it("uses a freshly authenticated client for each connection attempt", async () => {
    const socket = createSocket();
    const staleDeployments = {
      shellConnect: vi.fn(),
    } as unknown as Deployments;
    const freshShellConnect = vi.fn().mockResolvedValue(socket);
    const freshDeployments = {
      shellConnect: freshShellConnect,
    } as unknown as Deployments;
    const getDeployments = vi.fn().mockResolvedValue(freshDeployments);

    const { result } = renderHookWithClient(
      () => useAgentShell(staleDeployments, {
        agentId: "agent-1",
        enabled: true,
        getDeployments,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(getDeployments).toHaveBeenCalledTimes(1);
    expect(getDeployments).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(staleDeployments.shellConnect).not.toHaveBeenCalled();
    expect(freshShellConnect).toHaveBeenCalledWith(
      "agent-1",
      undefined,
      { signal: expect.any(AbortSignal) },
    );
  });

  it("keeps a healthy socket when deployment source identities change", async () => {
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    const firstDeployments = { shellConnect: vi.fn() } as unknown as Deployments;
    const latestDeployments = { shellConnect: vi.fn() } as unknown as Deployments;
    const firstGetter = vi.fn().mockResolvedValue({
      shellConnect: vi.fn().mockResolvedValue(firstSocket),
    } as unknown as Deployments);
    const latestShellConnect = vi.fn().mockResolvedValue(secondSocket);
    const latestGetter = vi.fn().mockResolvedValue({ shellConnect: latestShellConnect } as unknown as Deployments);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const shell = renderHookWithClient(
      ({ deployments, getDeployments }) => useAgentShell(deployments, {
        agentId: "agent-1",
        enabled: true,
        getDeployments,
      }),
      { initialProps: { deployments: firstDeployments, getDeployments: firstGetter } },
    );

    await waitFor(() => expect(shell.result.current.status).toBe("connected"));
    shell.rerender({ deployments: latestDeployments, getDeployments: latestGetter });

    expect(firstSocket.close).not.toHaveBeenCalled();
    expect(latestGetter).not.toHaveBeenCalled();

    vi.useFakeTimers();
    act(() => firstSocket.onclose?.({ code: 1006, reason: "network lost" } as CloseEvent));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(latestGetter).toHaveBeenCalledTimes(1);
    expect(latestShellConnect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    random.mockRestore();
    shell.unmount();
  });

  it("defers reconnect while the document is hidden", async () => {
    let visibility: DocumentVisibilityState = "visible";
    const visibilitySpy = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const firstSocket = createSocket();
    const secondSocket = createSocket();
    const deployments = {
      shellConnect: vi.fn()
        .mockResolvedValueOnce(firstSocket)
        .mockResolvedValueOnce(secondSocket),
    } as unknown as Deployments;
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const shell = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true }),
    );

    try {
      await waitFor(() => expect(shell.result.current.status).toBe("connected"));
      vi.useFakeTimers();
      visibility = "hidden";
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      act(() => firstSocket.onclose?.({ code: 1006, reason: "network lost" } as CloseEvent));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(deployments.shellConnect).toHaveBeenCalledTimes(1);
      expect(shell.result.current.status).toBe("reconnecting");

      visibility = "visible";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
      });
      expect(deployments.shellConnect).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
      random.mockRestore();
      visibilitySpy.mockRestore();
      shell.unmount();
    }
  });

  it("aborts a stale credential request when the shell is disabled", async () => {
    const pending = deferred<Deployments | null>();
    const getDeployments = vi.fn().mockReturnValue(pending.promise);
    const shell = renderHookWithClient(
      ({ enabled }) => useAgentShell(null, {
        agentId: "agent-1",
        enabled,
        getDeployments,
      }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(getDeployments).toHaveBeenCalledTimes(1));
    const signal = getDeployments.mock.calls[0][0] as AbortSignal;
    await act(async () => {
      shell.rerender({ enabled: false });
      await Promise.resolve();
    });

    expect(signal.aborted).toBe(true);
    expect(shell.result.current.status).toBe("disconnected");
  });

  it("times out credential acquisition so reconnects are not blocked", async () => {
    vi.useFakeTimers();
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const getDeployments = vi.fn((signal: AbortSignal) => new Promise<Deployments | null>((_, reject) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      signal.addEventListener("abort", () => {
        activeRequests -= 1;
        reject(signal.reason);
      }, { once: true });
    }));
    const shell = renderHookWithClient(
      () => useAgentShell(null, {
        agentId: "agent-1",
        enabled: true,
        getDeployments,
      }),
    );

    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(getDeployments).toHaveBeenCalledTimes(1);
      const signal = getDeployments.mock.calls[0][0] as AbortSignal;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });

      expect(signal.aborted).toBe(true);
      expect(shell.result.current.status).toBe("reconnecting");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });
      expect(getDeployments).toHaveBeenCalledTimes(2);
      expect(activeRequests).toBe(1);
      expect(maxActiveRequests).toBe(1);
    } finally {
      shell.unmount();
      vi.useRealTimers();
    }
  });

  it("queues and chunks large input while the websocket buffer is saturated", async () => {
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;
    const { result } = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    const mutableSocket = socket as WebSocket & { bufferedAmount: number };
    mutableSocket.bufferedAmount = 300_000;
    const pasted = `${"a".repeat(16_383)}😀${"b".repeat(20_000)}`;

    vi.useFakeTimers();
    act(() => result.current.send(pasted));
    expect(socket.send).not.toHaveBeenCalled();

    mutableSocket.bufferedAmount = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8);
    });
    vi.useRealTimers();

    const sentChunks = socket.send.mock.calls.map(([data]) => data as string);
    expect(sentChunks.every((chunk) => chunk.length <= 16_384)).toBe(true);
    expect(sentChunks.join("")).toBe(pasted);
  });

  it("rejects an overflowing paste instead of sending a truncated command", async () => {
    const socket = createSocket();
    const deployments = {
      shellConnect: vi.fn().mockResolvedValue(socket),
    } as unknown as Deployments;
    const onInputRejected = vi.fn();
    const { result } = renderHookWithClient(
      () => useAgentShell(deployments, { agentId: "agent-1", enabled: true, onInputRejected }),
    );
    await waitFor(() => expect(result.current.status).toBe("connected"));
    const mutableSocket = socket as WebSocket & { bufferedAmount: number };
    mutableSocket.bufferedAmount = 300_000;
    const pasted = "x".repeat(1_000_001);

    vi.useFakeTimers();
    try {
      act(() => result.current.send(pasted));
      expect(socket.send).not.toHaveBeenCalled();
      expect(onInputRejected).toHaveBeenCalledTimes(1);

      mutableSocket.bufferedAmount = 0;
      act(() => result.current.send("safe"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8);
      });

      const sent = socket.send.mock.calls.map(([data]) => data as string).join("");
      expect(sent).toBe("safe");
    } finally {
      vi.useRealTimers();
    }
  });
});
