"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import type { ShellStatus } from "@/hooks/useAgentShell";
import { markShellPerformance, measureShellPerformance } from "@/lib/agent-shell-performance";
import {
  loadAgentShellTerminalRuntime,
  loadAgentShellWebglRuntime,
} from "@/lib/agent-shell-terminal-loader";

const SHELL_BUFFER_MAX_CHARS = 120_000;
const SHELL_PENDING_OUTPUT_MAX_CHARS = 240_000;
const SHELL_BUFFER_MAX_ENTRIES = 4_096;
const SHELL_PENDING_OUTPUT_MAX_ENTRIES = 8_192;
const SHELL_OUTPUT_CHUNK_MAX_CHARS = 16_384;
const SHELL_OUTPUT_BULK_CHUNK_MAX_CHARS = 32_768;
const SHELL_OUTPUT_BULK_THRESHOLD_CHARS = 64_000;
const SHELL_RESIZE_DEBOUNCE_MS = 50;
const SHELL_IDLE_DISPOSE_MS = 60_000;
const SHELL_SCROLLBACK_LINES = 1_500;
const SHELL_TRUNCATION_PREFIX = "\x1bc\r\n[Earlier shell output was truncated.]\r\n";

interface UseAgentShellTerminalOptions {
  agentId: string | null;
  status: ShellStatus;
  visible: boolean;
  prewarm?: boolean;
  onInput: (data: string) => void;
  onResize: (rows: number, cols: number) => void;
}

interface ChunkBuffer {
  chunks: string[];
  head: number;
  size: number;
}

type WebglAddonConstructor = new () => WebglAddon;

function clearChunkBuffer(buffer: ChunkBuffer) {
  buffer.chunks = [];
  buffer.head = 0;
  buffer.size = 0;
}

function compactChunkBuffer(buffer: ChunkBuffer) {
  if (buffer.head > 64 && buffer.head * 2 >= buffer.chunks.length) {
    buffer.chunks = buffer.chunks.slice(buffer.head);
    buffer.head = 0;
  }
}

function trimChunkBuffer(buffer: ChunkBuffer, maxChars: number, maxEntries: number) {
  while (
    (buffer.size > maxChars || buffer.chunks.length - buffer.head > maxEntries) &&
    buffer.head < buffer.chunks.length
  ) {
    const overflow = buffer.size - maxChars;
    const first = buffer.chunks[buffer.head];
    if (buffer.chunks.length - buffer.head > maxEntries || first.length <= overflow) {
      buffer.head += 1;
      buffer.size -= first.length;
    } else {
      buffer.chunks[buffer.head] = first.slice(overflow);
      buffer.size -= overflow;
    }
  }
  compactChunkBuffer(buffer);
}

function appendChunk(buffer: ChunkBuffer, text: string, maxChars: number, maxEntries: number): number {
  const untrimmedSize = buffer.size + text.length;
  if (text.length >= maxChars) {
    buffer.chunks = [text.slice(-maxChars)];
    buffer.head = 0;
    buffer.size = maxChars;
    return untrimmedSize - buffer.size;
  }
  buffer.chunks.push(text);
  buffer.size += text.length;
  trimChunkBuffer(buffer, maxChars, maxEntries);
  return untrimmedSize - buffer.size;
}

function takeBatch(buffer: ChunkBuffer, maxChars: number): string | null {
  const chunks: string[] = [];
  let remaining = maxChars;
  while (remaining > 0 && buffer.head < buffer.chunks.length) {
    const next = buffer.chunks[buffer.head];
    const chunk = next.length > remaining ? next.slice(0, remaining) : next;
    chunks.push(chunk);
    buffer.size -= chunk.length;
    remaining -= chunk.length;
    if (chunk.length === next.length) {
      buffer.head += 1;
    } else {
      buffer.chunks[buffer.head] = next.slice(chunk.length);
    }
  }
  compactChunkBuffer(buffer);
  return chunks.length > 0 ? chunks.join("") : null;
}

function snapshotChunkBuffer(buffer: ChunkBuffer): string {
  return buffer.chunks.slice(buffer.head).join("");
}

export function useAgentShellTerminal({
  agentId,
  status,
  visible,
  prewarm = false,
  onInput,
  onResize,
}: UseAgentShellTerminalOptions) {
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalRetry, setTerminalRetry] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(() => (
    typeof document === "undefined" || document.visibilityState === "visible"
  ));
  const terminalVisible = visible && documentVisible;
  const terminalActive = (visible || prewarm) && documentVisible;
  const terminalRef = useRef<XtermTerminal | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const webglAddonConstructorRef = useRef<WebglAddonConstructor | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const webglContextLossDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const webglDisabledRef = useRef(false);
  const panelVisibleRef = useRef(visible);
  const dataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const resizeDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const renderDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const sessionAgentRef = useRef<string | null>(null);
  const statusRef = useRef(status);
  const visibleRef = useRef(terminalVisible);
  const activeRef = useRef(terminalActive);
  const onInputRef = useRef(onInput);
  const onResizeRef = useRef(onResize);
  const outputBufferRef = useRef<ChunkBuffer>({ chunks: [], head: 0, size: 0 });
  const pendingOutputRef = useRef<ChunkBuffer>({ chunks: [], head: 0, size: 0 });
  const writeInFlightRef = useRef(false);
  const terminalGenerationRef = useRef(0);
  const outputGenerationRef = useRef(0);
  const historyTruncatedRef = useRef(false);
  const pendingTruncatedRef = useRef(false);
  const firstWriteParsedRef = useRef(false);
  const firstRenderMeasuredRef = useRef(false);
  const flushOutputRef = useRef<() => void>(() => undefined);
  const fitFrameRef = useRef<number | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const latestSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const lastSentSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const idleDisposeTimerRef = useRef<number | null>(null);
  const preserveExternalFocusOnCreateRef = useRef(false);

  const updateTerminalReady = useCallback((ready: boolean, generation: number) => {
    queueMicrotask(() => {
      if (terminalGenerationRef.current === generation) setTerminalReady(ready);
    });
  }, []);

  const clearResizeTimer = useCallback(() => {
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = null;
    }
  }, []);

  const sendShellSize = useCallback((size: { rows: number; cols: number }) => {
    if (statusRef.current !== "connected" || !visibleRef.current) return;
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
  }, [clearResizeTimer, sendShellSize]);

  const fitTerminal = useCallback((immediate = false) => {
    if (!activeRef.current) return;
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    try {
      const dimensions = fitAddon.proposeDimensions();
      if (!dimensions || dimensions.rows <= 0 || dimensions.cols <= 0) return;
      if (terminal.rows !== dimensions.rows || terminal.cols !== dimensions.cols) {
        fitAddon.fit();
      }
      scheduleResize(dimensions.rows, dimensions.cols, immediate);
    } catch {
      // Xterm can throw while the browser is in the middle of detaching layout.
    }
  }, [scheduleResize]);

  const ensureWebglRenderer = useCallback(() => {
    if (webglDisabledRef.current || webglAddonRef.current || !activeRef.current) return;
    const terminal = terminalRef.current;
    const container = terminalContainerRef.current;
    const WebglAddon = webglAddonConstructorRef.current;
    if (!terminal || !container || !WebglAddon || container.clientWidth <= 0 || container.clientHeight <= 0) return;

    let webglAddon: WebglAddon | null = null;
    try {
      const candidate = new WebglAddon();
      webglAddon = candidate;
      terminal.loadAddon(candidate);
      webglAddonRef.current = candidate;
      markShellPerformance("webgl-ready");
      measureShellPerformance("intent-to-webgl", "intent", "webgl-ready");
      webglContextLossDisposableRef.current = candidate.onContextLoss(() => {
        if (webglAddonRef.current !== candidate) return;
        webglDisabledRef.current = true;
        webglContextLossDisposableRef.current?.dispose();
        webglContextLossDisposableRef.current = null;
        candidate.dispose();
        webglAddonRef.current = null;
      });
    } catch {
      webglAddon?.dispose();
      webglDisabledRef.current = true;
      webglAddonRef.current = null;
    }
  }, []);

  const scheduleTerminalFit = useCallback(() => {
    if (!activeRef.current) return;
    if (fitFrameRef.current !== null) return;
    fitFrameRef.current = window.requestAnimationFrame(() => {
      fitFrameRef.current = null;
      fitTerminal();
      ensureWebglRenderer();
    });
  }, [ensureWebglRenderer, fitTerminal]);

  const disposeTerminal = useCallback((clearBuffer = false) => {
    if (fitFrameRef.current !== null) {
      window.cancelAnimationFrame(fitFrameRef.current);
      fitFrameRef.current = null;
    }
    clearResizeTimer();
    const generation = terminalGenerationRef.current + 1;
    terminalGenerationRef.current = generation;
    outputGenerationRef.current += 1;
    writeInFlightRef.current = false;
    dataDisposableRef.current?.dispose();
    resizeDisposableRef.current?.dispose();
    renderDisposableRef.current?.dispose();
    webglContextLossDisposableRef.current?.dispose();
    dataDisposableRef.current = null;
    resizeDisposableRef.current = null;
    renderDisposableRef.current = null;
    webglContextLossDisposableRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
    terminalContainerRef.current = null;
    fitAddonRef.current = null;
    webglAddonConstructorRef.current = null;
    webglAddonRef.current = null;
    webglDisabledRef.current = false;
    firstWriteParsedRef.current = false;
    firstRenderMeasuredRef.current = false;
    latestSizeRef.current = null;
    lastSentSizeRef.current = null;
    clearChunkBuffer(pendingOutputRef.current);
    pendingTruncatedRef.current = false;
    updateTerminalReady(false, generation);
    if (clearBuffer) {
      clearChunkBuffer(outputBufferRef.current);
      historyTruncatedRef.current = false;
      sessionAgentRef.current = null;
    }
  }, [clearResizeTimer, updateTerminalReady]);

  const shellBoxRef = useCallback((element: HTMLDivElement | null) => {
    const attachedContainer = terminalContainerRef.current;
    if (attachedContainer && attachedContainer !== element) disposeTerminal(false);
    setContainerElement(element);
  }, [disposeTerminal]);

  const clearOutput = useCallback(() => {
    const outputGeneration = outputGenerationRef.current + 1;
    outputGenerationRef.current = outputGeneration;
    clearChunkBuffer(outputBufferRef.current);
    clearChunkBuffer(pendingOutputRef.current);
    historyTruncatedRef.current = false;
    pendingTruncatedRef.current = false;
    firstWriteParsedRef.current = false;
    firstRenderMeasuredRef.current = false;
    lastSentSizeRef.current = null;
    const terminal = terminalRef.current;
    if (!terminal) {
      writeInFlightRef.current = false;
      return;
    }

    terminal.clear();
    const terminalGeneration = terminalGenerationRef.current;
    writeInFlightRef.current = true;
    terminal.write("\x1bc", () => {
      if (
        terminalGenerationRef.current !== terminalGeneration ||
        outputGenerationRef.current !== outputGeneration ||
        terminalRef.current !== terminal
      ) return;
      writeInFlightRef.current = false;
      flushOutputRef.current();
    });
  }, []);

  const appendOutputBuffer = useCallback((text: string) => {
    if (appendChunk(
      outputBufferRef.current,
      text,
      SHELL_BUFFER_MAX_CHARS,
      SHELL_BUFFER_MAX_ENTRIES,
    ) > 0) {
      historyTruncatedRef.current = true;
    }
  }, []);

  const flushOutput = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal || !visibleRef.current || writeInFlightRef.current) return;

    if (pendingTruncatedRef.current) {
      clearChunkBuffer(pendingOutputRef.current);
      const history = snapshotChunkBuffer(outputBufferRef.current);
      appendChunk(
        pendingOutputRef.current,
        `${SHELL_TRUNCATION_PREFIX}${history}`,
        SHELL_PENDING_OUTPUT_MAX_CHARS,
        SHELL_PENDING_OUTPUT_MAX_ENTRIES,
      );
      pendingTruncatedRef.current = false;
    }

    const chunkSize = pendingOutputRef.current.size >= SHELL_OUTPUT_BULK_THRESHOLD_CHARS
      ? SHELL_OUTPUT_BULK_CHUNK_MAX_CHARS
      : SHELL_OUTPUT_CHUNK_MAX_CHARS;
    const chunk = takeBatch(pendingOutputRef.current, chunkSize);
    if (!chunk) return;

    const terminalGeneration = terminalGenerationRef.current;
    const outputGeneration = outputGenerationRef.current;
    writeInFlightRef.current = true;
    terminal.write(chunk, () => {
      if (
        terminalGenerationRef.current !== terminalGeneration ||
        outputGenerationRef.current !== outputGeneration ||
        terminalRef.current !== terminal
      ) return;
      if (!firstWriteParsedRef.current) {
        firstWriteParsedRef.current = true;
        markShellPerformance("first-write-parsed");
        measureShellPerformance("output-to-write-parsed", "first-output", "first-write-parsed");
      }
      writeInFlightRef.current = false;
      flushOutputRef.current();
    });
  }, []);

  useEffect(() => {
    flushOutputRef.current = flushOutput;
  }, [flushOutput]);

  const writeOutput = useCallback((text: string) => {
    if (!text) return;
    appendOutputBuffer(text);
    if (!terminalRef.current) return;
    if (appendChunk(
      pendingOutputRef.current,
      text,
      SHELL_PENDING_OUTPUT_MAX_CHARS,
      SHELL_PENDING_OUTPUT_MAX_ENTRIES,
    ) > 0) {
      pendingTruncatedRef.current = true;
    }
    if (visibleRef.current) flushOutputRef.current();
  }, [appendOutputBuffer]);

  useEffect(() => {
    const previousStatus = statusRef.current;
    statusRef.current = status;
    if (
      previousStatus !== status &&
      (status === "connecting" || status === "reconnecting")
    ) {
      clearOutput();
    }
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
  }, [clearOutput, sendShellSize, status]);

  useEffect(() => {
    activeRef.current = terminalActive;
    visibleRef.current = terminalVisible;
    if (terminalRef.current) {
      terminalRef.current.options.disableStdin = statusRef.current !== "connected" || !terminalVisible;
    }
    if (terminalVisible) {
      flushOutputRef.current();
    } else {
      terminalRef.current?.blur();
    }
  }, [terminalActive, terminalVisible]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setDocumentVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    onInputRef.current = onInput;
    onResizeRef.current = onResize;
  }, [onInput, onResize]);

  useLayoutEffect(() => {
    if (!visible) return;
    preserveExternalFocusOnCreateRef.current = false;
  }, [visible]);

  useEffect(() => {
    if (!agentId) {
      disposeTerminal(true);
      return;
    }
    if (sessionAgentRef.current === null) {
      sessionAgentRef.current = agentId;
      return;
    }
    if (sessionAgentRef.current !== agentId) {
      disposeTerminal(true);
      sessionAgentRef.current = agentId;
    }
  }, [agentId, disposeTerminal]);

  useEffect(() => {
    if (!terminalVisible) {
      if (idleDisposeTimerRef.current) window.clearTimeout(idleDisposeTimerRef.current);
      if (!terminalRef.current) return undefined;
      idleDisposeTimerRef.current = window.setTimeout(() => {
        idleDisposeTimerRef.current = null;
        preserveExternalFocusOnCreateRef.current = visible && !documentVisible;
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
  }, [disposeTerminal, documentVisible, terminalReady, terminalVisible, visible]);

  useEffect(() => {
    if (!terminalActive || !containerElement || !agentId || terminalRef.current) return;

    let cancelled = false;
    let initialFrame: number | null = null;

    void loadAgentShellTerminalRuntime().then(({ FitAddon: LoadedFitAddon, Terminal }) => {
      if (cancelled || !activeRef.current || terminalRef.current) return;
      markShellPerformance("core-ready");
      measureShellPerformance("intent-to-core", "intent", "core-ready");

      if (sessionAgentRef.current === null) {
        sessionAgentRef.current = agentId;
      } else if (sessionAgentRef.current !== agentId) {
        clearOutput();
        sessionAgentRef.current = agentId;
      }

      const terminal = new Terminal({
        convertEol: false,
        cursorBlink: false,
        cursorStyle: "block",
        cursorInactiveStyle: "block",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
        fontSize: 12,
        lineHeight: 1.45,
        scrollback: SHELL_SCROLLBACK_LINES,
        disableStdin: statusRef.current !== "connected" || !visibleRef.current,
        theme: {
          background: "#0c1016",
          foreground: "#d8dde7",
          cursor: "#d8dde7",
          cursorAccent: "#0c1016",
          selectionBackground: "#2a3445",
        },
      });

      const fitAddon = new LoadedFitAddon();
      terminalRef.current = terminal;
      terminalContainerRef.current = containerElement;
      fitAddonRef.current = fitAddon;
      terminal.loadAddon(fitAddon);
      terminal.open(containerElement);
      if (visible && !preserveExternalFocusOnCreateRef.current) terminal.focus();
      markShellPerformance("terminal-open");
      measureShellPerformance("intent-to-terminal-open", "intent", "terminal-open");
      setTerminalError(null);
      const generation = terminalGenerationRef.current + 1;
      terminalGenerationRef.current = generation;
      fitTerminal(true);
      updateTerminalReady(true, generation);

      void loadAgentShellWebglRuntime().then(({ WebglAddon }) => {
        if (
          terminalGenerationRef.current !== generation ||
          terminalRef.current !== terminal
        ) return;
        webglAddonConstructorRef.current = WebglAddon;
        ensureWebglRenderer();
      }).catch(() => {
        if (terminalGenerationRef.current === generation) webglDisabledRef.current = true;
      });

      const bufferedOutput = snapshotChunkBuffer(outputBufferRef.current);
      clearChunkBuffer(pendingOutputRef.current);
      pendingTruncatedRef.current = false;
      if (bufferedOutput) {
        const replay = historyTruncatedRef.current
          ? `${SHELL_TRUNCATION_PREFIX}${bufferedOutput}`
          : bufferedOutput;
        appendChunk(
          pendingOutputRef.current,
          replay,
          SHELL_PENDING_OUTPUT_MAX_CHARS,
          SHELL_PENDING_OUTPUT_MAX_ENTRIES,
        );
        flushOutputRef.current();
      }

      initialFrame = window.requestAnimationFrame(() => {
        fitTerminal(true);
        ensureWebglRenderer();
        const activeElement = document.activeElement;
        const terminalContainsFocus = Boolean(
          activeElement && terminalContainerRef.current?.contains(activeElement),
        );
        if (
          visibleRef.current &&
          (
            !preserveExternalFocusOnCreateRef.current ||
            terminalContainsFocus ||
            !activeElement ||
            activeElement === document.body
          )
        ) {
          terminal.focus();
        }
        preserveExternalFocusOnCreateRef.current = false;
      });

      dataDisposableRef.current = terminal.onData((data) => {
        if (statusRef.current !== "connected" || !visibleRef.current) return;
        onInputRef.current(data);
      });
      resizeDisposableRef.current = terminal.onResize(({ cols, rows }) => {
        scheduleResize(rows, cols);
      });
      renderDisposableRef.current = terminal.onRender(() => {
        if (!firstWriteParsedRef.current || firstRenderMeasuredRef.current) return;
        firstRenderMeasuredRef.current = true;
        markShellPerformance("first-render");
        measureShellPerformance("output-to-first-render", "first-output", "first-render");
        measureShellPerformance("intent-to-first-render", "intent", "first-render");
      });
    }).catch(() => {
      if (!cancelled) {
        disposeTerminal(false);
        setTerminalError("The terminal could not be loaded. Reopen Shell to retry.");
      }
    });

    return () => {
      cancelled = true;
      if (initialFrame !== null) window.cancelAnimationFrame(initialFrame);
    };
  }, [agentId, clearOutput, containerElement, disposeTerminal, ensureWebglRenderer, fitTerminal, scheduleResize, terminalActive, terminalRetry, updateTerminalReady, visible]);

  const retryTerminal = useCallback(() => {
    setTerminalError(null);
    setTerminalRetry((current) => current + 1);
  }, []);

  useLayoutEffect(() => {
    const becamePanelVisible = visible && !panelVisibleRef.current;
    panelVisibleRef.current = visible;
    if (!terminalVisible) return;
    if (!terminalRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      fitTerminal(true);
      ensureWebglRenderer();
      const activeElement = document.activeElement;
      const terminalContainsFocus = Boolean(
        activeElement && terminalContainerRef.current?.contains(activeElement),
      );
      if (
        becamePanelVisible ||
        terminalContainsFocus ||
        !activeElement ||
        activeElement === document.body
      ) {
        terminalRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ensureWebglRenderer, fitTerminal, terminalVisible, visible]);

  useEffect(() => {
    if (!containerElement || !terminalActive) return;

    if (typeof ResizeObserver === "undefined") {
      const handleWindowResize = () => scheduleTerminalFit();
      window.addEventListener("resize", handleWindowResize);
      return () => window.removeEventListener("resize", handleWindowResize);
    }

    const resizeObserver = new ResizeObserver(scheduleTerminalFit);
    resizeObserver.observe(containerElement);
    return () => resizeObserver.disconnect();
  }, [containerElement, scheduleTerminalFit, terminalActive]);

  useEffect(() => () => {
    if (idleDisposeTimerRef.current) window.clearTimeout(idleDisposeTimerRef.current);
    disposeTerminal(true);
  }, [disposeTerminal]);

  return {
    shellBoxRef,
    writeOutput,
    clearOutput,
    terminalReady,
    terminalError,
    retryTerminal,
  };
}
