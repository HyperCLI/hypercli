"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import type { ShellStatus } from "@/hooks/useAgentShell";

const SHELL_BUFFER_MAX_CHARS = 120_000;
const SHELL_PENDING_OUTPUT_MAX_CHARS = 240_000;
const SHELL_OUTPUT_CHUNK_MAX_CHARS = 32_768;
const SHELL_OUTPUT_FRAME_BUDGET_MS = 8;
const SHELL_RESIZE_DEBOUNCE_MS = 50;
const SHELL_IDLE_DISPOSE_MS = 60_000;

interface UseAgentShellTerminalOptions {
  agentId: string | null;
  status: ShellStatus;
  visible: boolean;
  onInput: (data: string) => void;
  onResize: (rows: number, cols: number) => void;
}

export interface AgentShellTerminalDiagnostics {
  bufferedChars: number;
  pendingChars: number;
  droppedPendingChars: number;
  terminalAttached: boolean;
  cachedAgentId: string | null;
  lastRows: number | null;
  lastCols: number | null;
}

const emptyDiagnostics: AgentShellTerminalDiagnostics = {
  bufferedChars: 0,
  pendingChars: 0,
  droppedPendingChars: 0,
  terminalAttached: false,
  cachedAgentId: null,
  lastRows: null,
  lastCols: null,
};

function trimOutputBuffer(buffer: string[], bufferSize: { current: number }) {
  while (bufferSize.current > SHELL_BUFFER_MAX_CHARS && buffer.length > 0) {
    const overflow = bufferSize.current - SHELL_BUFFER_MAX_CHARS;
    const first = buffer[0];
    if (first.length <= overflow) {
      buffer.shift();
      bufferSize.current -= first.length;
    } else {
      buffer[0] = first.slice(overflow);
      bufferSize.current -= overflow;
    }
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function useAgentShellTerminal({
  agentId,
  status,
  visible,
  onInput,
  onResize,
}: UseAgentShellTerminalOptions) {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const dataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const resizeDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const sessionAgentRef = useRef<string | null>(null);
  const statusRef = useRef(status);
  const visibleRef = useRef(visible);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const outputBufferRef = useRef<string[]>([]);
  const outputBufferSizeRef = useRef(0);
  const pendingOutputRef = useRef<string[]>([]);
  const pendingOutputSizeRef = useRef(0);
  const outputFrameRef = useRef<number | null>(null);
  const flushOutputRef = useRef<() => void>(() => undefined);
  const resizeTimerRef = useRef<number | null>(null);
  const latestSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const lastSentSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const idleDisposeTimerRef = useRef<number | null>(null);
  const droppedPendingCharsRef = useRef(0);

  const diagnosticsRef = useRef<AgentShellTerminalDiagnostics>(emptyDiagnostics);

  const updateDiagnostics = useCallback(() => {
    const size = latestSizeRef.current;
    diagnosticsRef.current = {
      bufferedChars: outputBufferSizeRef.current,
      pendingChars: pendingOutputSizeRef.current,
      droppedPendingChars: droppedPendingCharsRef.current,
      terminalAttached: Boolean(terminalRef.current),
      cachedAgentId: sessionAgentRef.current,
      lastRows: size?.rows ?? null,
      lastCols: size?.cols ?? null,
    };
  }, []);

  const cancelOutputFrame = useCallback(() => {
    if (outputFrameRef.current !== null) {
      window.cancelAnimationFrame(outputFrameRef.current);
      outputFrameRef.current = null;
    }
  }, []);

  const clearResizeTimer = useCallback(() => {
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = null;
    }
  }, []);

  const sendShellSize = useCallback((size: { rows: number; cols: number }) => {
    if (statusRef.current !== "connected") return;
    const lastSent = lastSentSizeRef.current;
    if (lastSent?.rows === size.rows && lastSent.cols === size.cols) return;
    onResizeRef.current(size.rows, size.cols);
    lastSentSizeRef.current = size;
  }, []);

  const scheduleResize = useCallback((rows: number, cols: number, immediate = false) => {
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) return;

    const nextSize = { rows, cols };
    const latest = latestSizeRef.current;
    if (!immediate && latest?.rows === rows && latest.cols === cols) return;
    latestSizeRef.current = nextSize;
    updateDiagnostics();

    clearResizeTimer();
    const flush = () => {
      resizeTimerRef.current = null;
      const size = latestSizeRef.current;
      if (size) sendShellSize(size);
    };

    if (immediate) {
      flush();
    } else {
      resizeTimerRef.current = window.setTimeout(flush, SHELL_RESIZE_DEBOUNCE_MS);
    }
  }, [clearResizeTimer, sendShellSize, updateDiagnostics]);

  const fitTerminal = useCallback((immediate = false) => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    try {
      fitAddon.fit();
      scheduleResize(terminal.rows, terminal.cols, immediate);
    } catch {
      // Xterm can throw while the browser is in the middle of detaching layout.
    }
  }, [scheduleResize]);

  const disposeTerminal = useCallback((clearBuffer = false) => {
    cancelOutputFrame();
    clearResizeTimer();
    dataDisposableRef.current?.dispose();
    resizeDisposableRef.current?.dispose();
    dataDisposableRef.current = null;
    resizeDisposableRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;
    latestSizeRef.current = null;
    lastSentSizeRef.current = null;
    if (clearBuffer) {
      outputBufferRef.current = [];
      outputBufferSizeRef.current = 0;
      pendingOutputRef.current = [];
      pendingOutputSizeRef.current = 0;
      sessionAgentRef.current = null;
    }
    updateDiagnostics();
  }, [cancelOutputFrame, clearResizeTimer, updateDiagnostics]);

  const clearOutput = useCallback(() => {
    cancelOutputFrame();
    outputBufferRef.current = [];
    outputBufferSizeRef.current = 0;
    pendingOutputRef.current = [];
    pendingOutputSizeRef.current = 0;
    lastSentSizeRef.current = null;
    terminalRef.current?.clear();
    updateDiagnostics();
  }, [cancelOutputFrame, updateDiagnostics]);

  const appendOutputBuffer = useCallback((text: string) => {
    if (text.length >= SHELL_BUFFER_MAX_CHARS) {
      outputBufferRef.current = [text.slice(-SHELL_BUFFER_MAX_CHARS)];
      outputBufferSizeRef.current = SHELL_BUFFER_MAX_CHARS;
      updateDiagnostics();
      return;
    }

    outputBufferRef.current.push(text);
    outputBufferSizeRef.current += text.length;
    trimOutputBuffer(outputBufferRef.current, outputBufferSizeRef);
    updateDiagnostics();
  }, [updateDiagnostics]);

  const scheduleOutputFlush = useCallback(() => {
    if (outputFrameRef.current !== null) return;
    outputFrameRef.current = window.requestAnimationFrame(() => flushOutputRef.current());
  }, []);

  const flushOutput = useCallback(() => {
    outputFrameRef.current = null;
    const terminal = terminalRef.current;
    if (!terminal || pendingOutputRef.current.length === 0) return;

    const started = nowMs();
    while (pendingOutputRef.current.length > 0) {
      const next = pendingOutputRef.current[0];
      const chunk = next.length > SHELL_OUTPUT_CHUNK_MAX_CHARS
        ? next.slice(0, SHELL_OUTPUT_CHUNK_MAX_CHARS)
        : next;

      terminal.write(chunk);
      pendingOutputSizeRef.current -= chunk.length;

      if (chunk.length === next.length) {
        pendingOutputRef.current.shift();
      } else {
        pendingOutputRef.current[0] = next.slice(chunk.length);
      }

      if (pendingOutputRef.current.length > 0 && nowMs() - started >= SHELL_OUTPUT_FRAME_BUDGET_MS) {
        scheduleOutputFlush();
        break;
      }
    }

    updateDiagnostics();
  }, [scheduleOutputFlush, updateDiagnostics]);

  useEffect(() => {
    flushOutputRef.current = flushOutput;
  }, [flushOutput]);

  const writeOutput = useCallback((text: string) => {
    if (!text) return;
    appendOutputBuffer(text);
    pendingOutputRef.current.push(text);
    pendingOutputSizeRef.current += text.length;

    if (pendingOutputSizeRef.current > SHELL_PENDING_OUTPUT_MAX_CHARS) {
      const combined = pendingOutputRef.current.join("");
      const trimmed = combined.slice(-SHELL_PENDING_OUTPUT_MAX_CHARS);
      droppedPendingCharsRef.current += combined.length - trimmed.length;
      pendingOutputRef.current = [trimmed];
      pendingOutputSizeRef.current = trimmed.length;
    }

    updateDiagnostics();
    scheduleOutputFlush();
  }, [appendOutputBuffer, scheduleOutputFlush, updateDiagnostics]);

  useEffect(() => {
    statusRef.current = status;
    if (terminalRef.current) {
      terminalRef.current.options.disableStdin = status !== "connected" || !visibleRef.current;
    }
    if (status === "connected") {
      const size = latestSizeRef.current ?? (
        terminalRef.current
          ? { rows: terminalRef.current.rows, cols: terminalRef.current.cols }
          : null
      );
      if (size) sendShellSize(size);
    }
  }, [sendShellSize, status]);

  useEffect(() => {
    visibleRef.current = visible;
    if (terminalRef.current) {
      terminalRef.current.options.disableStdin = statusRef.current !== "connected" || !visible;
    }
  }, [visible]);

  useEffect(() => {
    onInputRef.current = onInput;
    onResizeRef.current = onResize;
  }, [onInput, onResize]);

  useEffect(() => {
    if (!agentId || (sessionAgentRef.current && sessionAgentRef.current !== agentId)) {
      disposeTerminal(true);
    }
  }, [agentId, disposeTerminal]);

  useEffect(() => {
    if (!visible) {
      if (idleDisposeTimerRef.current) window.clearTimeout(idleDisposeTimerRef.current);
      idleDisposeTimerRef.current = window.setTimeout(() => {
        idleDisposeTimerRef.current = null;
        disposeTerminal(false);
      }, SHELL_IDLE_DISPOSE_MS);
      return () => {
        if (idleDisposeTimerRef.current) {
          window.clearTimeout(idleDisposeTimerRef.current);
          idleDisposeTimerRef.current = null;
        }
      };
    }

    if (idleDisposeTimerRef.current) {
      window.clearTimeout(idleDisposeTimerRef.current);
      idleDisposeTimerRef.current = null;
    }
    return undefined;
  }, [disposeTerminal, visible]);

  useEffect(() => {
    if (!visible || !containerElement || !agentId || terminalRef.current) return;

    if (sessionAgentRef.current !== agentId) {
      clearOutput();
      sessionAgentRef.current = agentId;
    }

    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
      fontSize: 12,
      lineHeight: 1.45,
      scrollback: 3000,
      disableStdin: statusRef.current !== "connected" || !visibleRef.current,
      theme: {
        background: "#0c1016",
        foreground: "#d8dde7",
        cursor: "#d8dde7",
        selectionBackground: "#2a3445",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerElement);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    updateDiagnostics();

    const initialFrame = window.requestAnimationFrame(() => {
      fitTerminal(true);
      terminal.focus();
    });

    const bufferedOutput = outputBufferRef.current.join("");
    if (bufferedOutput) terminal.write(bufferedOutput);

    dataDisposableRef.current = terminal.onData((data) => {
      if (statusRef.current !== "connected" || !visibleRef.current) return;
      onInputRef.current(data);
    });
    resizeDisposableRef.current = terminal.onResize(({ cols, rows }) => {
      scheduleResize(rows, cols);
    });

    return () => {
      window.cancelAnimationFrame(initialFrame);
    };
  }, [agentId, clearOutput, containerElement, fitTerminal, scheduleResize, updateDiagnostics, visible]);

  useEffect(() => {
    if (!visible || !terminalRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      fitTerminal(true);
      terminalRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitTerminal, visible]);

  useEffect(() => {
    if (!containerElement) return;

    if (typeof ResizeObserver === "undefined") {
      const handleWindowResize = () => fitTerminal();
      window.addEventListener("resize", handleWindowResize);
      return () => window.removeEventListener("resize", handleWindowResize);
    }

    const resizeObserver = new ResizeObserver(() => fitTerminal());
    resizeObserver.observe(containerElement);
    return () => resizeObserver.disconnect();
  }, [containerElement, fitTerminal]);

  useEffect(() => () => {
    if (idleDisposeTimerRef.current) window.clearTimeout(idleDisposeTimerRef.current);
    disposeTerminal(true);
  }, [disposeTerminal]);

  return {
    shellBoxRef: setContainerElement,
    writeOutput,
    clearOutput,
    getDiagnostics: () => diagnosticsRef.current,
  };
}
