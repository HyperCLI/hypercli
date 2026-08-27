import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentShellTerminal } from "./useAgentShellTerminal";

const xtermMocks = vi.hoisted(() => ({
  terminals: [] as Array<{
    options: Record<string, unknown>;
    loadAddon: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writeCallbacks: Array<() => void>;
    dispose: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    blur: ReturnType<typeof vi.fn>;
  }>,
  webglAddons: [] as Array<{
    dispose: ReturnType<typeof vi.fn>;
    emitContextLoss: () => void;
  }>,
  fitAddons: [] as Array<{
    fit: ReturnType<typeof vi.fn>;
    proposeDimensions: ReturnType<typeof vi.fn>;
  }>,
  failNextWebglActivation: false,
  failNextCoreActivation: false,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    options: Record<string, unknown>;
    rows = 24;
    cols = 80;
    writeCallbacks: Array<() => void> = [];
    write = vi.fn((_data: string, callback?: () => void) => {
      if (callback) this.writeCallbacks.push(callback);
    });
    loadAddon = vi.fn((addon: unknown) => {
      if (xtermMocks.failNextWebglActivation && xtermMocks.webglAddons.includes(addon as never)) {
        xtermMocks.failNextWebglActivation = false;
        throw new Error("WebGL unavailable");
      }
    });
    open = vi.fn(() => {
      if (xtermMocks.failNextCoreActivation) {
        xtermMocks.failNextCoreActivation = false;
        throw new Error("Core terminal unavailable");
      }
    });
    focus = vi.fn();
    blur = vi.fn();
    clear = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    onRender = vi.fn(() => ({ dispose: vi.fn() }));

    constructor(options: Record<string, unknown>) {
      this.options = options;
      xtermMocks.terminals.push(this);
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ rows: 24, cols: 80 }));

    constructor() {
      xtermMocks.fitAddons.push(this);
    }
  },
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class MockWebglAddon {
    dispose = vi.fn();
    private contextLossHandler: (() => void) | null = null;
    onContextLoss = vi.fn((handler: () => void) => {
      this.contextLossHandler = handler;
      return { dispose: vi.fn(() => { this.contextLossHandler = null; }) };
    });
    emitContextLoss = () => this.contextLossHandler?.();

    constructor() {
      xtermMocks.webglAddons.push(this);
    }
  },
}));

describe("useAgentShellTerminal", () => {
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextAnimationFrameId: number;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    xtermMocks.terminals.length = 0;
    xtermMocks.webglAddons.length = 0;
    xtermMocks.fitAddons.length = 0;
    xtermMocks.failNextWebglActivation = false;
    xtermMocks.failNextCoreActivation = false;
    animationFrames = new Map();
    nextAnimationFrameId = 1;
    requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrames.set(id, callback);
      return id;
    });
    cancelAnimationFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      animationFrames.delete(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  const runAnimationFrames = () => {
    const pending = [...animationFrames.values()];
    animationFrames.clear();
    act(() => {
      for (const callback of pending) callback(0);
    });
  };

  const renderTerminal = (visible = true, status: "connected" | "reconnecting" = "connected") => renderHook(
    ({ isVisible, shellStatus }) => useAgentShellTerminal({
      agentId: "agent-1",
      status: shellStatus,
      visible: isVisible,
      onInput: vi.fn(),
      onResize: vi.fn(),
    }),
    { initialProps: { isVisible: visible, shellStatus: status } },
  );

  it("attaches deterministically and preserves output received before the terminal exists", async () => {
    const shell = renderTerminal();
    act(() => shell.result.current.writeOutput("early output\n"));
    act(() => shell.result.current.shellBoxRef(document.createElement("div")));

    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    const terminal = xtermMocks.terminals[0];
    expect(terminal.options.scrollback).toBe(1_500);
    runAnimationFrames();
    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith("early output\n", expect.any(Function));

    act(() => shell.result.current.writeOutput("later output\n"));
    runAnimationFrames();
    expect(terminal.write).toHaveBeenCalledTimes(1);

    act(() => terminal.writeCallbacks.shift()?.());
    runAnimationFrames();
    expect(terminal.write.mock.calls.map(([text]) => text)).toEqual([
      "early output\n",
      "later output\n",
    ]);
  });

  it("waits for each xterm write callback and coalesces queued output", async () => {
    const shell = renderTerminal();
    act(() => shell.result.current.shellBoxRef(document.createElement("div")));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    runAnimationFrames();

    const terminal = xtermMocks.terminals[0];
    act(() => {
      shell.result.current.writeOutput("first");
      shell.result.current.writeOutput("second");
      shell.result.current.writeOutput("third");
    });
    expect(terminal.write.mock.calls.map(([text]) => text)).toEqual(["first"]);

    act(() => terminal.writeCallbacks.shift()?.());
    runAnimationFrames();
    expect(terminal.write.mock.calls.map(([text]) => text)).toEqual(["first", "secondthird"]);

    act(() => terminal.writeCallbacks.shift()?.());
    runAnimationFrames();
    expect(terminal.write.mock.calls.map(([text]) => text)).toEqual(["first", "secondthird"]);
  });

  it("pauses terminal rendering while hidden and bounds startup history", async () => {
    const shell = renderTerminal(false);
    const output = `${"a".repeat(180_000)}${"b".repeat(120_000)}`;
    act(() => shell.result.current.writeOutput(output));
    act(() => shell.result.current.shellBoxRef(document.createElement("div")));
    expect(xtermMocks.terminals).toHaveLength(0);

    shell.rerender({ isVisible: true, shellStatus: "connected" });
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    const terminal = xtermMocks.terminals[0];

    for (let index = 0; index < 20; index += 1) {
      runAnimationFrames();
      act(() => terminal.writeCallbacks.shift()?.());
      if (animationFrames.size === 0 && terminal.writeCallbacks.length === 0) break;
    }

    const rendered = terminal.write.mock.calls.map(([text]) => text).join("");
    expect(rendered).toBe(`\x1bc\r\n[Earlier shell output was truncated.]\r\n${"b".repeat(120_000)}`);
    expect(terminal.write.mock.calls.every(([text]) => text.length <= 32_768)).toBe(true);
    expect(terminal.write.mock.calls.some(([text]) => text.length > 16_384)).toBe(true);
  });

  it("prewarms WebGL while hidden without painting output until Shell opens", async () => {
    const shell = renderHook(
      ({ visible }) => useAgentShellTerminal({
        agentId: "agent-1",
        status: "connected",
        visible,
        prewarm: true,
        onInput: vi.fn(),
        onResize: vi.fn(),
      }),
      { initialProps: { visible: false } },
    );
    const container = document.createElement("div");
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    act(() => shell.result.current.shellBoxRef(container));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    expect(xtermMocks.webglAddons).toHaveLength(1);

    const terminal = xtermMocks.terminals[0];
    runAnimationFrames();
    expect(terminal.focus).not.toHaveBeenCalled();
    act(() => shell.result.current.writeOutput("ready\n"));
    expect(terminal.write).not.toHaveBeenCalled();

    shell.rerender({ visible: true });
    expect(terminal.write).toHaveBeenCalledWith("ready\n", expect.any(Function));
  });

  it("reattaches to a replacement host and replays retained output once", async () => {
    const shell = renderTerminal();
    const firstContainer = document.createElement("div");
    act(() => shell.result.current.shellBoxRef(firstContainer));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    const firstTerminal = xtermMocks.terminals[0];
    runAnimationFrames();

    act(() => shell.result.current.writeOutput("retained output\n"));
    runAnimationFrames();
    act(() => firstTerminal.writeCallbacks.shift()?.());

    act(() => shell.result.current.shellBoxRef(null));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(false));
    expect(firstTerminal.dispose).toHaveBeenCalledTimes(1);

    act(() => shell.result.current.shellBoxRef(document.createElement("div")));
    await waitFor(() => expect(xtermMocks.terminals).toHaveLength(2));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    const secondTerminal = xtermMocks.terminals[1];
    runAnimationFrames();

    expect(secondTerminal.write.mock.calls.map(([text]) => text)).toEqual(["retained output\n"]);
  });

  it("queues a terminal reset behind stale in-flight output before rendering new output", async () => {
    const shell = renderTerminal();
    act(() => shell.result.current.shellBoxRef(document.createElement("div")));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    runAnimationFrames();
    const terminal = xtermMocks.terminals[0];

    act(() => shell.result.current.writeOutput("stale output"));
    runAnimationFrames();
    act(() => shell.result.current.clearOutput());
    act(() => shell.result.current.writeOutput("fresh output"));
    runAnimationFrames();
    expect(terminal.write.mock.calls.map(([text]) => text)).toEqual(["stale output", "\x1bc"]);

    act(() => terminal.writeCallbacks.shift()?.());
    expect(terminal.write).toHaveBeenCalledTimes(2);
    act(() => terminal.writeCallbacks.shift()?.());
    expect(terminal.write.mock.calls.map(([text]) => text)).toEqual([
      "stale output",
      "\x1bc",
      "fresh output",
    ]);
  });

  it("does not resize the remote shell while the terminal is hidden", async () => {
    const onResize = vi.fn();
    const shell = renderHook(
      ({ visible, status }) => useAgentShellTerminal({
        agentId: "agent-1",
        status,
        visible,
        onInput: vi.fn(),
        onResize,
      }),
      { initialProps: { visible: true, status: "connected" as "connected" | "reconnecting" } },
    );
    act(() => shell.result.current.shellBoxRef(document.createElement("div")));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    runAnimationFrames();
    expect(onResize).toHaveBeenCalledWith(24, 80);

    shell.rerender({ visible: false, status: "reconnecting" });
    shell.rerender({ visible: false, status: "connected" });
    runAnimationFrames();
    expect(onResize).toHaveBeenCalledTimes(1);

    shell.rerender({ visible: true, status: "connected" });
    runAnimationFrames();
    expect(onResize).toHaveBeenCalledTimes(2);
  });

  it("coalesces repeated ResizeObserver notifications into one fit proposal", async () => {
    let resizeCallback: ResizeObserverCallback | null = null;
    vi.stubGlobal("ResizeObserver", class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });

    try {
      const shell = renderTerminal();
      act(() => shell.result.current.shellBoxRef(document.createElement("div")));
      await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
      runAnimationFrames();
      const fitAddon = xtermMocks.fitAddons[0];
      fitAddon.proposeDimensions.mockClear();

      act(() => {
        resizeCallback?.([], {} as ResizeObserver);
        resizeCallback?.([], {} as ResizeObserver);
        resizeCallback?.([], {} as ResizeObserver);
      });
      expect(fitAddon.proposeDimensions).not.toHaveBeenCalled();

      runAnimationFrames();
      expect(fitAddon.proposeDimensions).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not schedule resize frames while the terminal is inactive", async () => {
    let resizeCallback: ResizeObserverCallback | null = null;
    vi.stubGlobal("ResizeObserver", class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });

    try {
      const shell = renderTerminal();
      act(() => shell.result.current.shellBoxRef(document.createElement("div")));
      await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
      runAnimationFrames();
      requestAnimationFrameSpy.mockClear();

      shell.rerender({ isVisible: false, shellStatus: "connected" });
      act(() => resizeCallback?.([], {} as ResizeObserver));
      expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("enables WebGL only after the terminal host has a real size", async () => {
    const shell = renderTerminal();
    const container = document.createElement("div");
    act(() => shell.result.current.shellBoxRef(container));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    expect(xtermMocks.webglAddons).toHaveLength(0);

    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    runAnimationFrames();

    expect(xtermMocks.webglAddons).toHaveLength(1);
  });

  it("falls back to the default renderer after WebGL context loss", async () => {
    const shell = renderTerminal();
    const container = document.createElement("div");
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    act(() => shell.result.current.shellBoxRef(container));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));

    const webglAddon = xtermMocks.webglAddons[0];
    expect(webglAddon).toBeDefined();
    act(() => webglAddon.emitContextLoss());

    expect(webglAddon.dispose).toHaveBeenCalledTimes(1);
    expect(shell.result.current.terminalReady).toBe(true);
  });

  it("disposes a WebGL addon whose activation fails", async () => {
    const shell = renderTerminal();
    const container = document.createElement("div");
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 600 },
    });
    xtermMocks.failNextWebglActivation = true;
    act(() => shell.result.current.shellBoxRef(container));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));

    const webglAddon = xtermMocks.webglAddons[0];
    expect(webglAddon?.dispose).toHaveBeenCalledTimes(1);
    expect(shell.result.current.terminalReady).toBe(true);
  });

  it("disposes a partially initialized terminal when core setup fails", async () => {
    xtermMocks.failNextCoreActivation = true;
    const shell = renderTerminal();
    act(() => shell.result.current.shellBoxRef(document.createElement("div")));

    await waitFor(() => expect(shell.result.current.terminalError).toBeTruthy());
    expect(xtermMocks.terminals[0].dispose).toHaveBeenCalledTimes(1);
    expect(shell.result.current.terminalReady).toBe(false);

    act(() => shell.result.current.retryTerminal());
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    expect(xtermMocks.terminals).toHaveLength(2);
  });

  it("pauses output and blurs while the browser document is hidden", async () => {
    let visibility: DocumentVisibilityState = "visible";
    const visibilitySpy = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const shell = renderTerminal();
    act(() => shell.result.current.shellBoxRef(document.createElement("div")));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    const terminal = xtermMocks.terminals[0];
    runAnimationFrames();
    const focusCallsBeforeVisibilityChange = terminal.focus.mock.calls.length;
    const dialogInput = document.createElement("input");
    document.body.appendChild(dialogInput);
    dialogInput.focus();

    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(terminal.blur).toHaveBeenCalledTimes(1);

    act(() => shell.result.current.writeOutput("background output"));
    expect(terminal.write).not.toHaveBeenCalled();

    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(terminal.write.mock.calls.map(([text]) => text)).toEqual(["background output"]);
    runAnimationFrames();
    expect(terminal.focus).toHaveBeenCalledTimes(focusCallsBeforeVisibilityChange);
    dialogInput.remove();
    visibilitySpy.mockRestore();
  });

  it("does not steal external focus when recreating an idle-disposed terminal", async () => {
    let visibility: DocumentVisibilityState = "visible";
    const visibilitySpy = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const shell = renderTerminal();
    act(() => shell.result.current.shellBoxRef(document.createElement("div")));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    runAnimationFrames();

    const dialogInput = document.createElement("input");
    document.body.appendChild(dialogInput);
    dialogInput.focus();
    vi.useFakeTimers();
    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(xtermMocks.terminals[0].dispose).toHaveBeenCalledTimes(1);

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(xtermMocks.terminals).toHaveLength(2);
    runAnimationFrames();
    expect(xtermMocks.terminals[1].focus).not.toHaveBeenCalled();

    vi.useRealTimers();
    dialogInput.remove();
    visibilitySpy.mockRestore();
  });

  it("focuses the recreated terminal when the user reopens Shell after idle disposal", async () => {
    const shell = renderTerminal();
    act(() => shell.result.current.shellBoxRef(document.createElement("div")));
    await waitFor(() => expect(shell.result.current.terminalReady).toBe(true));
    expect(xtermMocks.terminals).toHaveLength(1);
    runAnimationFrames();

    vi.useFakeTimers();
    shell.rerender({ isVisible: false, shellStatus: "connected" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(xtermMocks.terminals[0].dispose).toHaveBeenCalledTimes(1);

    const shellButton = document.createElement("button");
    document.body.appendChild(shellButton);
    shellButton.focus();
    await act(async () => {
      shell.rerender({ isVisible: true, shellStatus: "connected" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(xtermMocks.terminals).toHaveLength(2);
    runAnimationFrames();
    expect(xtermMocks.terminals[1].focus).toHaveBeenCalled();

    shellButton.remove();
    vi.useRealTimers();
  });
});
