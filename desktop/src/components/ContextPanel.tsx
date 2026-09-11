import { useEffect, useRef, useState, type ReactNode } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  Bell,
  CalendarClock,
  Camera,
  Cpu,
  FileText,
  Folder,
  Maximize2,
  Mic,
  Monitor,
  RefreshCw,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { agentDesktopUrl, agentFileRead, agentFileReadBytes, agentFileWrite, agentFiles, agentShellUrl, claimAgentShellSocket, hasAgentVoice, releaseAgentShellSocket, routinesDelete, routinesList, routinesUpdate, setAgentLaunchOverrides, validateAgentVoiceFile, type AgentFileEntry, type AgentSummary, type Routine } from "../api";
import { setVoiceRepliesEnabled, voiceRepliesEnabled } from "../lib/voice-replies";
import { describeRoutine } from "../schedule";
import { NewScheduledJobModal } from "./NewScheduledJobModal";
import { PERSONA_COLORS, PERSONA_ICONS, setPersona, usePersona } from "../personas";
import { Avatar } from "./Avatar";
import { MANAGED_RUNTIMES, RUNNING, isAgentRuntimeInactiveState, isDeletedState, runtimeLabel } from "../agent-utils";
import type { ManagedAgentRuntime } from "../../../ts-sdk/src/agents.ts";
import { useAgentLogs } from "../useAgentLogs";

type Tab = "agent" | "status" | "settings";
type MachineTab = "logs" | "shell";
type FilePreviewKind = "text" | "html" | "image" | "pdf" | "binary";
type FilePreview = {
  entry: AgentFileEntry;
  kind: FilePreviewKind;
  content: string | null;
  url: string | null;
  bytes: Uint8Array | null;
  error: string | null;
  loading: boolean;
};

export type ContextTab = Tab;

const TEXT_TABS: { id: Tab; label: string }[] = [
  { id: "agent", label: "Agent" },
  { id: "status", label: "Status" },
  { id: "settings", label: "Settings" },
];

function plainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function truthyEnv(value: unknown) {
  return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function falseyEnv(value: unknown) {
  return typeof value === "string" && ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

function routesHaveDesktop(routes: unknown) {
  if (!plainRecord(routes)) return false;
  if (plainRecord(routes.desktop)) return true;
  return Object.values(routes).some((route) => plainRecord(route) && route.prefix === "desktop");
}

function agentHasDesktop(agent: AgentSummary) {
  const launchConfig = agent.launchConfig;
  if (plainRecord(launchConfig)) {
    const env = launchConfig.env;
    const desktopEnv = plainRecord(env) ? env.HYPER_DESKTOP_ENABLED : undefined;
    if (falseyEnv(desktopEnv)) return false;
    if (truthyEnv(desktopEnv)) return true;
    if (routesHaveDesktop(launchConfig.routes)) return true;
  }
  if (routesHaveDesktop(agent.routes)) return true;
  return agent.has_desktop === true;
}

function useLocalBool(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key);
    return stored === null ? initial : stored === "1";
  });
  const set = (v: boolean) => {
    localStorage.setItem(key, v ? "1" : "0");
    setValue(v);
  };
  return [value, set];
}

export function ContextPanel({
  agent,
  tab,
  onTab,
  onArchive,
  onRestore,
  onStop,
  onDelete,
  onSetAgentDesktopEnabled,
  onSetAgentRuntime,
  onUploadAgentAvatar,
  onDeleteAgentAvatar,
  onUploadAgentVoice,
  onDeleteAgentVoice,
  voiceApiUnavailable,
}: {
  agent: AgentSummary | null;
  tab: ContextTab;
  onTab: (tab: ContextTab) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  onSetAgentDesktopEnabled: (id: string, enabled: boolean) => void;
  onSetAgentRuntime: (id: string, runtime: ManagedAgentRuntime, resetImage: boolean) => void;
  onUploadAgentAvatar: (id: string, file: File) => void;
  onDeleteAgentAvatar: (id: string) => void;
  onUploadAgentVoice: (id: string, file: File) => void;
  onDeleteAgentVoice: (id: string) => void;
  /** The avatar-audio routes answered 404/405 — show a disabled hint. */
  voiceApiUnavailable: boolean;
}) {
  return (
    <aside className="app-pane-right">
      <header className="app-header">
        <div data-tauri-drag-region className="drag-fill" />
        <div className="app-header-content px-4">
          <div className="segmented-tabs w-full">
            {TEXT_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => onTab(t.id)}
                className={`segmented-tab flex-1 ${tab === t.id ? "segmented-tab-active" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {!agent ? (
          <div className="pt-10 text-center text-[12px] text-text-secondary px-4">
            Select an agent to inspect it.
          </div>
        ) : tab === "agent" ? (
          <div className="h-full overflow-y-auto">
            <DesktopSection agent={agent} />
            <RoutinesTab agent={agent} />
            <FilesTab agent={agent} />
          </div>
        ) : tab === "status" ? (
          <StatusTabPanel agent={agent} />
        ) : (
          <SettingsTab
            agent={agent}
            onArchive={onArchive}
            onRestore={onRestore}
            onStop={onStop}
            onDelete={onDelete}
            onSetAgentDesktopEnabled={onSetAgentDesktopEnabled}
            onSetAgentRuntime={onSetAgentRuntime}
            onUploadAgentAvatar={onUploadAgentAvatar}
            onDeleteAgentAvatar={onDeleteAgentAvatar}
            onUploadAgentVoice={onUploadAgentVoice}
            onDeleteAgentVoice={onDeleteAgentVoice}
            voiceApiUnavailable={voiceApiUnavailable}
          />
        )}
      </div>
    </aside>
  );
}

function StatusTabPanel({ agent }: { agent: AgentSummary }) {
  const [tab, setTab] = useState<MachineTab>("logs");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-4 pt-3">
        <div className="segmented-tabs w-full">
          {(["logs", "shell"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`segmented-tab flex-1 capitalize ${tab === id ? "segmented-tab-active" : ""}`}
            >
              {id}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "logs" ? <LogsTab agent={agent} active /> : <ShellTab agent={agent} />}
      </div>
    </div>
  );
}

function desktopRoute(agent: AgentSummary) {
  const launchConfig = agent.launchConfig;
  const fromLaunch = plainRecord(launchConfig) ? launchConfig.routes : undefined;
  const routes = plainRecord(fromLaunch) ? fromLaunch : plainRecord(agent.routes) ? agent.routes : null;
  if (!routes) return null;
  if (plainRecord(routes.desktop)) return routes.desktop;
  return Object.values(routes).find((route) => plainRecord(route) && route.prefix === "desktop") ?? null;
}

function DesktopSection({ agent }: { agent: AgentSummary }) {
  const desktopEnabled = agentHasDesktop(agent);
  const hasRoute = desktopRoute(agent) !== null;
  const running = agent.state === RUNNING;
  const available = hasRoute && running;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setUrl(null);
    setError(null);
    setLoading(false);
  }, [agent.id, agent.state, hasRoute]);

  useEffect(() => {
    if (!available || url || loading || error) return;
    setLoading(true);
    agentDesktopUrl(agent.id)
      .then((result) => setUrl(result.url))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [available, url, loading, error, agent.id]);

  const retry = () => {
    setUrl(null);
    setError(null);
  };

  if (!desktopEnabled) return null;

  return (
    <section className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-start gap-2">
          <Monitor size={14} className="mt-0.5 shrink-0 text-text-secondary" />
          <div>
            <div className="text-[12px] font-medium">Desktop</div>
            {(!running || !hasRoute) && (
              <div className="text-[10px] text-text-secondary leading-snug">
                {running ? "Enabled — stop agent to apply." : "Enabled — applies next start."}
              </div>
            )}
          </div>
        </div>
      </div>
      {available ? (
        <>
          <div
            className="relative aspect-[8/5] cursor-pointer overflow-hidden rounded-lg border border-border bg-[#05070a] group"
            onClick={() => url && setExpanded(true)}
            title="Click to interact"
          >
            {url ? (
              <>
                <iframe
                  title={`${agent.name} desktop`}
                  src={url}
                  className="pointer-events-none absolute left-0 top-0 h-[800px] w-[1280px] origin-top-left border-0"
                  style={{ transform: "scale(var(--desktop-scale, 0.25))" }}
                  ref={(el) => {
                    if (!el?.parentElement) return;
                    const parent = el.parentElement;
                    const update = () => {
                      el.style.setProperty("--desktop-scale", String(parent.clientWidth / 1280));
                    };
                    update();
                    const observer = new ResizeObserver(update);
                    observer.observe(parent);
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                  <Maximize2 size={20} className="text-white drop-shadow" />
                </div>
              </>
            ) : (
              <div className="flex h-full cursor-default items-center justify-center text-[11px] text-text-secondary">
                {loading ? "Connecting desktop..." : error ? "Desktop unavailable" : "Loading desktop..."}
              </div>
            )}
          </div>
          {expanded && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setExpanded(false)}>
              <div className="relative h-[85vh] w-[90vw] max-w-[1280px]" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setExpanded(false)}
                  className="absolute -top-9 right-0 rounded-md bg-card px-2.5 py-1 text-[11px] text-text-secondary hover:text-foreground"
                >
                  Close
                </button>
                <div className="relative h-full w-full overflow-hidden rounded-lg border border-border bg-[#05070a]">
                  <iframe
                    title={`${agent.name} desktop (interactive)`}
                    src={url ?? undefined}
                    className="absolute left-0 top-0 h-[800px] w-[1280px] origin-top-left border-0"
                    style={{ transform: "scale(var(--desktop-modal-scale, 1))" }}
                    ref={(el) => {
                      if (!el?.parentElement) return;
                      const parent = el.parentElement;
                      const update = () => {
                        const scale = Math.min(parent.clientWidth / 1280, parent.clientHeight / 800);
                        el.style.setProperty("--desktop-modal-scale", String(scale));
                        el.style.left = `${(parent.clientWidth - 1280 * scale) / 2}px`;
                        el.style.top = `${(parent.clientHeight - 800 * scale) / 2}px`;
                      };
                      update();
                      const observer = new ResizeObserver(update);
                      observer.observe(parent);
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed border-border bg-card text-[12px] text-text-secondary">
          {running ? "Desktop route applies next start." : "Desktop disabled while powered off."}
        </div>
      )}
      {error && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-error-bg px-2.5 py-2 text-[11px] text-error">
          <span className="break-words">{error}</span>
          <button onClick={retry} className="shrink-0 font-medium hover:underline">Retry</button>
        </div>
      )}
    </section>
  );
}

function ShellTab({ agent }: { agent: AgentSummary }) {
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const sendShellData = (data: string) => {
    const socket = socketRef.current;
    if (data && socket?.readyState === WebSocket.OPEN) socket.send(data);
  };

  const resizeShell = () => {
    const socket = socketRef.current;
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    try {
      fit.fit();
    } catch {
      return;
    }
    const next = { rows: terminal.rows, cols: terminal.cols };
    const previous = sizeRef.current;
    sizeRef.current = next;
    if (
      socket?.readyState === WebSocket.OPEN &&
      (!previous || previous.rows !== next.rows || previous.cols !== next.cols)
    ) {
      socket.send(`\x1b[8;${next.rows};${next.cols}t`);
    }
  };

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      theme: {
        background: "#05070a",
        foreground: "#d8fbd8",
        cursor: "#d8fbd8",
        selectionBackground: "#2d5f3a",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;
    resizeShell();
    const focusTerminal = () => terminal.focus();
    const pasteToShell = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text");
      if (!text) return;
      event.preventDefault();
      sendShellData(text);
    };
    const rightClickPaste = (event: MouseEvent) => {
      event.preventDefault();
      terminal.focus();
      void navigator.clipboard?.readText()
        .then(sendShellData)
        .catch(() => undefined);
    };
    host.addEventListener("pointerdown", focusTerminal);
    host.addEventListener("paste", pasteToShell);
    host.addEventListener("contextmenu", rightClickPaste);
    const hostSizeRef = { w: 0, h: 0 };
    let resizeRaf = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        const terminal = terminalRef.current;
        const fit = fitRef.current;
        if (!terminal || !fit) return;
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (w === 0 || h === 0) return;
        if (w === hostSizeRef.w && h === hostSizeRef.h) return;
        hostSizeRef.w = w;
        hostSizeRef.h = h;
        const dims = fit.proposeDimensions();
        if (dims && (dims.cols !== terminal.cols || dims.rows !== terminal.rows)) resizeShell();
      });
    });
    resizeObserver.observe(host);
    return () => {
      host.removeEventListener("pointerdown", focusTerminal);
      host.removeEventListener("paste", pasteToShell);
      host.removeEventListener("contextmenu", rightClickPaste);
      resizeObserver.disconnect();
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      terminalRef.current = null;
      fitRef.current = null;
      terminal.dispose();
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const disposable = terminal.onData((data) => {
      sendShellData(data);
    });
    return () => disposable.dispose();
  }, []);

  useEffect(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    socketRef.current?.close();
    socketRef.current = null;
    setError(null);
    setConnected(false);
    terminalRef.current?.reset();
    if (agent.state !== RUNNING) return;

    let cancelled = false;
    let attempt = 0;
    const connect = () => {
      if (cancelled) return;
      let socket: WebSocket | null = null;
      void agentShellUrl(agent.id).then((url) => {
        if (cancelled) return;
        socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        socketRef.current = socket;
        claimAgentShellSocket(agent.id, socket);
        setError(null);
        socket.onopen = () => {
          if (cancelled || socketRef.current !== socket) return;
          attempt = 0;
          setConnected(true);
          resizeShell();
        };
        socket.onmessage = async (event) => {
          if (cancelled || socketRef.current !== socket) return;
          const text = typeof event.data === "string"
            ? event.data
            : event.data instanceof Blob
              ? await event.data.text()
              : new TextDecoder().decode(event.data as ArrayBuffer);
          if (text) terminalRef.current?.write(text);
        };
        socket.onerror = () => {
          if (socketRef.current === socket) socketRef.current?.close();
        };
        socket.onclose = (event) => {
          if (cancelled || socketRef.current !== socket) return;
          if (socket) releaseAgentShellSocket(agent.id, socket);
          socketRef.current = null;
          setConnected(false);
          const reason = event.reason ? `: ${event.reason}` : "";
          if (event.code !== 1000) setError(`Shell disconnected (${event.code})${reason}`);
          if (event.code === 1000 || event.code === 1008) return;
          const delay = Math.min(1_000 * 2 ** attempt, 10_000);
          attempt += 1;
          reconnectTimerRef.current = setTimeout(connect, delay);
        };
      }).catch((error) => {
        if (!cancelled) setError(error instanceof Error ? error.message : String(error));
      });
    };
    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      const socket = socketRef.current;
      if (socket) {
        releaseAgentShellSocket(agent.id, socket);
        socket.close();
        socketRef.current = null;
      }
    };
  }, [agent.id, agent.state, reconnectNonce]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <Caption>SHELL</Caption>
          <div className="mt-1 text-[11px] text-text-secondary">
            {agent.state === RUNNING
              ? connected ? "Interactive shell connected" : "Connecting interactive shell"
              : "Start the agent to open a shell"}
          </div>
          <div className="mt-0.5 text-[10px] text-text-secondary">
            Copy/paste: Ctrl+Shift+C / Ctrl+Shift+V
          </div>
        </div>
        <button
          onClick={() => {
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            setError(null);
            setReconnectNonce((value) => value + 1);
          }}
          disabled={agent.state !== RUNNING}
          className="ui-secondary-button flex items-center gap-1.5 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <RefreshCw size={12} />
          Reconnect
        </button>
      </div>
      {error && <div className="mb-3 rounded-md bg-error-bg px-2.5 py-2 text-[11px] text-error">{error}</div>}
      {agent.state !== RUNNING ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-card text-[12px] text-text-secondary">
          Shell unavailable while powered off.
        </div>
      ) : (
        <div
          ref={terminalHostRef}
          tabIndex={0}
          className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-[#05070a] p-3 outline-none"
        />
      )}
    </div>
  );
}

function FilesTab({ agent }: { agent: AgentSummary }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<AgentFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const loadNonceRef = useRef(0);
  const previewNonceRef = useRef(0);
  const filesMountedRef = useRef(true);

  const load = async (nextPath = path) => {
    const nonce = ++loadNonceRef.current;
    setLoading(true);
    setError(null);
    try {
      const files = await agentFiles(agent.id, nextPath);
      if (nonce !== loadNonceRef.current) return;
      setPath(nextPath);
      setEntries(files.sort(compareFileEntries));
    } catch (e) {
      if (nonce !== loadNonceRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      if (nonce === loadNonceRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    filesMountedRef.current = true;
    return () => {
      filesMountedRef.current = false;
      previewNonceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    loadNonceRef.current += 1;
    previewNonceRef.current += 1;
    setPath("");
    setEntries([]);
    setError(null);
    setPreview(null);
    if (!isDeletedState(agent.state)) void load("");
  }, [agent.id, agent.state]);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  const openFile = async (entry: AgentFileEntry) => {
    const nonce = ++previewNonceRef.current;
    setOpeningPath(entry.path);
    setError(null);
    setPreview({ entry, kind: previewKind(entry), content: null, url: null, bytes: null, error: null, loading: true });
    try {
      const kind = previewKind(entry);
      const mimeType = mimeTypeForFile(entry);
      if (kind === "text" || kind === "html") {
        const content = await agentFileRead(agent.id, entry.path);
        if (!filesMountedRef.current || nonce !== previewNonceRef.current) return;
        const openContent = kind === "html" ? sandboxHtml(content) : content;
        const url = URL.createObjectURL(new Blob([openContent], { type: mimeType }));
        setPreview({ entry, kind, content, url, bytes: null, error: null, loading: false });
        return;
      }
      const bytes = await agentFileReadBytes(agent.id, entry.path);
      if (!filesMountedRef.current || nonce !== previewNonceRef.current) return;
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      setPreview({ entry, kind, content: null, url, bytes, error: null, loading: false });
    } catch (e) {
      if (!filesMountedRef.current || nonce !== previewNonceRef.current) return;
      setPreview({ entry, kind: previewKind(entry), content: null, url: null, bytes: null, error: e instanceof Error ? e.message : String(e), loading: false });
    } finally {
      if (filesMountedRef.current && nonce === previewNonceRef.current) setOpeningPath(null);
    }
  };

  const parent = parentPath(path);

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const dragDepthRef = useRef(0);

  const uploadFiles = async (files: FileList | File[]) => {
    // Same gate as browsing (FSM.md capability table: files require only that
    // the agent exists — storage outlives the container). A refusal then comes
    // from the backend, where it carries a reason, never a silent no-op here.
    if (isDeletedState(agent.state)) return;
    for (const file of Array.from(files)) {
      const target = path ? `${path}/${file.name}` : file.name;
      setUploading(file.name);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await agentFileWrite(agent.id, target, bytes);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading(null);
      }
    }
    void load(path);
  };

  return (
    <div className="flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Caption>FILES</Caption>
          <div className="mt-1 truncate font-mono text-[10.5px] text-text-secondary">/{path || ""}</div>
        </div>
        <button
          onClick={() => void load(path)}
          disabled={loading}
          className="ui-icon-button-sm disabled:opacity-40"
          aria-label="Refresh files"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        {uploading && (
          <span className="shrink-0 text-[10px] text-text-secondary">Uploading {uploading}…</span>
        )}
      </div>
      {error && <div className="mb-3 rounded-md bg-error-bg px-2.5 py-2 text-[11px] text-error">{error}</div>}
      <div
        className={`min-h-0 max-h-72 overflow-hidden rounded-lg border bg-card ${dragOver ? "border-accent ring-1 ring-accent" : "border-border"}`}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepthRef.current += 1;
          if (!isDeletedState(agent.state)) setDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepthRef.current = 0;
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
        }}
      >
        {dragOver && (
          <div className="border-b border-accent bg-accent/10 px-3 py-1.5 text-center text-[11px] text-accent">
            Drop to upload to /{path || ""}
          </div>
        )}
        {path && (
          <button
            onClick={() => void load(parent)}
            className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-[12px] hover:bg-active-row"
          >
            <Folder size={14} className="text-text-secondary" />
            ..
          </button>
        )}
        <div className="max-h-full overflow-y-auto">
          {isDeletedState(agent.state) ? (
            <div className="px-3 py-8 text-center text-[11px] text-text-secondary">
              This agent is deleted.
            </div>
          ) : loading && entries.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11px] text-text-secondary">Loading files...</div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-8 text-center text-[11px] text-text-secondary">
              {error ? "Could not load this folder." : "No files here. Drop files to upload."}
            </div>
          ) : (
            entries.map((entry) => (
              <button
                key={`${entry.type}:${entry.path}`}
                onClick={() => entry.type === "directory" ? void load(entry.path) : void openFile(entry)}
                disabled={openingPath === entry.path}
                className="flex w-full items-center gap-2 border-b border-border/70 px-3 py-2 text-left text-[12px] last:border-b-0 enabled:hover:bg-active-row disabled:opacity-60"
              >
                {entry.type === "directory" ? (
                  <Folder size={14} className="shrink-0 text-accent" />
                ) : (
                  <FileText size={14} className="shrink-0 text-text-secondary" />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.type === "file" && openingPath === entry.path ? (
                  <RefreshCw size={12} className="shrink-0 animate-spin text-text-secondary" />
                ) : entry.type === "file" && (
                  <span className="shrink-0 text-[10px] text-text-secondary">
                    {entry.size_formatted ?? formatBytes(entry.size)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
      {preview && (
        <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0 truncate font-mono text-[11px] text-text-secondary">/{preview.entry.path}</div>
            <div className="flex shrink-0 items-center gap-1.5">
              {preview.url && canOpenPreview(preview) && (
                <button onClick={() => window.open(preview.url ?? "", "_blank", "noopener,noreferrer")} className="text-[10px] text-accent hover:underline">
                  Open in window
                </button>
              )}
              {!preview.loading && !preview.error && (
                <button onClick={() => downloadPreview(preview)} className="text-[10px] text-accent hover:underline">
                  Download
                </button>
              )}
              <button
                onClick={() => {
                  previewNonceRef.current += 1;
                  setOpeningPath(null);
                  setPreview(null);
                }}
                className="ui-icon-button-sm"
                aria-label="Close file preview"
              >
                ×
              </button>
            </div>
          </div>
          {preview.loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-[11px] text-text-secondary">
              <RefreshCw size={13} className="animate-spin" />
              Loading preview...
            </div>
          ) : preview.error ? (
            <div className="m-3 rounded-md bg-error-bg px-2.5 py-2 text-[11px] text-error">{preview.error}</div>
          ) : preview.kind === "html" ? (
            <iframe
              title={`Preview of ${preview.entry.name}`}
              sandbox=""
              srcDoc={sandboxHtml(preview.content ?? "")}
              className="h-full w-full bg-white"
            />
          ) : preview.kind === "image" && preview.url ? (
            <div className="flex h-full items-center justify-center bg-black/60 p-3">
              <img src={preview.url} alt={preview.entry.name} className="max-h-full max-w-full rounded object-contain" />
            </div>
          ) : preview.kind === "pdf" && preview.url ? (
            <iframe title={`Preview of ${preview.entry.name}`} src={preview.url} className="h-full w-full bg-white" />
          ) : preview.kind === "binary" ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-text-secondary">
              Binary preview is not available. Open it in a window or download it.
            </div>
          ) : (
            <pre className="h-full overflow-auto whitespace-pre-wrap p-3 text-[11px] leading-relaxed text-foreground">
              {preview.content}
            </pre>
          )}
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-text-secondary">
        Browses {agent.name}'s persisted workspace, including stopped agents when file storage is available.
      </p>
    </div>
  );
}

function compareFileEntries(a: AgentFileEntry, b: AgentFileEntry) {
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function parentPath(path: string) {
  return path.split("/").filter(Boolean).slice(0, -1).join("/");
}

function formatBytes(size: number | undefined) {
  if (size === undefined) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function fileExtension(entry: AgentFileEntry) {
  const name = entry.name || entry.path;
  const match = /\.([^.\/]+)$/.exec(name);
  return match?.[1]?.toLowerCase() ?? "";
}

function previewKind(entry: AgentFileEntry): FilePreviewKind {
  const ext = fileExtension(entry);
  if (ext === "html" || ext === "htm") return "html";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["txt", "md", "markdown", "json", "js", "jsx", "ts", "tsx", "css", "csv", "log", "xml", "yaml", "yml", "py", "rs", "go", "sh"].includes(ext)) return "text";
  return "binary";
}

function mimeTypeForFile(entry: AgentFileEntry) {
  const ext = fileExtension(entry);
  if (ext === "html" || ext === "htm") return "text/html;charset=utf-8";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "pdf") return "application/pdf";
  if (ext === "json") return "application/json;charset=utf-8";
  if (ext === "md" || ext === "markdown") return "text/markdown;charset=utf-8";
  return previewKind(entry) === "text" ? "text/plain;charset=utf-8" : "application/octet-stream";
}

function downloadPreview(preview: FilePreview) {
  const source = preview.bytes ? preview.bytes.slice().buffer : preview.content ?? "";
  const url = URL.createObjectURL(new Blob([source], { type: mimeTypeForFile(preview.entry) }));
  const link = document.createElement("a");
  link.href = url;
  link.download = preview.entry.name || "download";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function canOpenPreview(preview: FilePreview) {
  return fileExtension(preview.entry) !== "svg";
}

function sandboxHtml(source: string) {
  return [
    "<!doctype html>",
    '<meta charset="utf-8">',
    '<meta name="referrer" content="no-referrer">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; connect-src \'none\'; form-action \'none\'; frame-src \'none\'; img-src data: blob:; media-src data: blob:; object-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'">',
    source.replace(/<base\b[^>]*>/gi, ""),
  ].join("");
}

function LogsTab({ agent, active }: { agent: AgentSummary; active: boolean }) {
  // The SDK's full inactive set — the inline `!== "STOPPED" && !== "ARCHIVED"`
  // used to mint a token and dial for `FAILED`/`DELETED`/`ARCHIVING` agents.
  const streamable = active && !isAgentRuntimeInactiveState(agent.state);
  const logs = useAgentLogs(agent, streamable);
  const scrollRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.lines.length]);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <Caption>LOGS</Caption>
          <div className="mt-1 text-[11px] text-text-secondary">
            {logs.phase === "connecting"
              ? "Connecting"
              : logs.phase === "connected"
                ? "Live"
                : logs.phase === "closed"
                  ? "Disconnected"
                  : logs.phase === "error"
                    ? "Failed"
                    : isAgentRuntimeInactiveState(agent.state)
                      ? "Offline"
                      : "Idle"}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={logs.clear} className="text-[11px] text-text-secondary hover:text-foreground transition-colors">
            Clear
          </button>
          <button onClick={logs.retry} disabled={!streamable} className="text-[11px] font-medium text-accent hover:underline disabled:text-text-secondary disabled:no-underline">
            Retry
          </button>
        </div>
      </div>
      {logs.error && (
        <div className="mb-2 rounded-md bg-error-bg px-2.5 py-2 text-[11px] text-error">
          {logs.error}
        </div>
      )}
      {logs.lines.length > 0 ? (
        <pre
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card p-3 font-mono text-[10.5px] leading-relaxed text-text-secondary whitespace-pre-wrap"
        >
          {logs.lines.join("\n")}
        </pre>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-border bg-card px-4 text-center">
          <div className="max-w-[220px] text-text-secondary">
            <div className="text-[12px] font-medium text-foreground">
              {streamable ? "Waiting for logs" : "No live logs"}
            </div>
            <div className="mt-1 text-[11px] leading-relaxed">
              {logs.phase === "connecting"
                ? "Loading retained logs and attaching live output."
                : streamable
                  ? "Connected, but this runtime has not published retained log lines yet."
                  : "Start the agent to stream logs."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Caption({ children }: { children: string }) {
  return <div className="side-caption">{children}</div>;
}

function formatRoutineTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function RoutinesTab({ agent }: { agent: AgentSummary }) {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ routine: Routine | null } | null>(null);

  const load = () => {
    routinesList(agent.id)
      .then((items) => {
        setRoutines(items);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, [agent.id]);

  const toggle = async (routine: Routine) => {
    try {
      await routinesUpdate(routine.id, { enabled: !routine.enabled });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (routine: Routine) => {
    try {
      await routinesDelete(routine.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Caption>{routines ? `${routines.length} ROUTINE${routines.length === 1 ? "" : "S"}` : "ROUTINES"}</Caption>
        <button
          onClick={() => setModal({ routine: null })}
          className="text-[11px] font-medium text-accent hover:underline"
        >
          + New routine
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-error-bg px-2.5 py-2 text-[11px] text-error">{error}</div>
      )}

      {routines === null && !error ? (
        <div className="soft-card px-4 py-6 text-center text-[11px] text-text-secondary">Loading routines…</div>
      ) : routines !== null && routines.length === 0 ? (
        <div className="soft-card px-4 py-6 text-center">
          <CalendarClock size={20} className="mx-auto text-text-secondary mb-2" />
          <div className="text-[12px] font-medium mb-0.5">Your work, on autopilot</div>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            Make AI proactive instead of reactive. Your agent can monitor, report, follow up, and trigger workflows
            automatically on schedules — without waiting for someone to ask.
          </p>
          <button
            onClick={() => setModal({ routine: null })}
            className="ui-secondary-button mt-3 text-[11px] font-medium"
          >
            New Scheduled Job +
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {(routines ?? []).map((routine) => (
            <div
              key={routine.id}
              className="soft-card px-3 py-2.5 cursor-pointer hover:border-border-strong transition-colors"
              onClick={() => setModal({ routine })}
              title="Edit scheduled job"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {routine.name ? (
                    <>
                      <div className="text-[12px] font-medium leading-snug break-words">{routine.name}</div>
                      <div className="mt-0.5 text-[11px] leading-snug break-words text-text-secondary">{routine.prompt}</div>
                    </>
                  ) : (
                    <div className="text-[12px] leading-snug break-words">{routine.prompt}</div>
                  )}
                  <div className="mt-1 text-[10px] text-text-secondary">
                    {describeRoutine(routine)}
                    {routine.session_id ? ` · session ${routine.session_id}` : ""}
                  </div>
                  <div className="text-[10px] text-text-secondary">
                    Next run {formatRoutineTime(routine.next_run_at)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    role="switch"
                    aria-checked={routine.enabled}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(routine);
                    }}
                    className={`shrink-0 w-7 h-[16px] rounded-full relative transition-colors ${routine.enabled ? "bg-accent" : "bg-border-strong"}`}
                  >
                    <span className={`absolute top-[2px] w-[12px] h-[12px] rounded-full bg-white transition-all ${routine.enabled ? "left-[13px]" : "left-[2px]"}`} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(routine);
                    }}
                    className="ui-icon-button-sm text-text-secondary hover:text-error"
                    title="Delete routine"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <NewScheduledJobModal
          agent={agent}
          routine={modal.routine}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function SettingsTab({
  agent,
  onArchive,
  onRestore,
  onStop,
  onDelete,
  onSetAgentDesktopEnabled,
  onSetAgentRuntime,
  onUploadAgentAvatar,
  onDeleteAgentAvatar,
  onUploadAgentVoice,
  onDeleteAgentVoice,
  voiceApiUnavailable,
}: {
  agent: AgentSummary;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  onSetAgentDesktopEnabled: (id: string, enabled: boolean) => void;
  onSetAgentRuntime: (id: string, runtime: ManagedAgentRuntime, resetImage: boolean) => void;
  onUploadAgentAvatar: (id: string, file: File) => void;
  onDeleteAgentAvatar: (id: string) => void;
  onUploadAgentVoice: (id: string, file: File) => void;
  onDeleteAgentVoice: (id: string) => void;
  voiceApiUnavailable: boolean;
}) {
  const persona = usePersona(agent.id);
  const [notify, setNotify] = useLocalBool(`desktop-ng-notify:${agent.id}`, true);
  const [voiceReplies, setVoiceReplies] = useState(() => voiceRepliesEnabled(agent.id));
  const [identityModal, setIdentityModal] = useState<"avatar" | "voice" | null>(null);
  const [avatarStyleOpen, setAvatarStyleOpen] = useState(false);
  const [runtimeModalOpen, setRuntimeModalOpen] = useState(false);
  const desktopEnabled = agentHasDesktop(agent);
  const voiceSet = hasAgentVoice(agent);
  useEffect(() => {
    setVoiceReplies(voiceRepliesEnabled(agent.id));
    setIdentityModal(null);
  }, [agent.id]);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-3">
          <Avatar
            name={agent.name}
            url={agent.avatar_url}
            size={44}
            color={persona.color}
            icon={persona.icon}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIdentityModal("avatar")}
              className="ui-icon-button flex items-center gap-1.5 px-2 py-1 text-[11px]"
            >
              <Camera size={12} />
              Change avatar
            </button>
            <button
              type="button"
              disabled={voiceApiUnavailable}
              onClick={() => setIdentityModal("voice")}
              className="ui-icon-button flex items-center gap-1.5 px-2 py-1 text-[11px] disabled:opacity-40"
            >
              <Mic size={12} />
              Change voice
            </button>
          </div>
        </div>

      {!agent.avatar_url && (
        <div className="rounded-lg border border-border bg-card">
          <button
            type="button"
            onClick={() => setAvatarStyleOpen((value) => !value)}
            className="flex w-full items-center justify-between px-3 py-2 text-left"
          >
            <span className="text-[12px] font-medium">Generated avatar</span>
            <span className="text-[11px] text-text-secondary">{avatarStyleOpen ? "Hide" : "Edit"}</span>
          </button>
          {avatarStyleOpen && (
            <div className="space-y-3 border-t border-border px-3 py-3">
              <div>
                <div className="text-[11px] text-text-secondary mb-1.5">Color</div>
                <div className="flex flex-wrap gap-2">
                  {PERSONA_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setPersona(agent.id, { color })}
                      className="w-5 h-5 rounded-full transition-colors"
                      style={{
                        backgroundColor: color,
                        boxShadow:
                          persona.color === color
                            ? `0 0 0 2px var(--surface), 0 0 0 4px ${color}`
                            : undefined,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-text-secondary mb-1.5">Icon</div>
                <div className="flex flex-wrap gap-1.5">
                  {PERSONA_ICONS.map((icon) => (
                    <button
                      key={icon}
                      onClick={() => setPersona(agent.id, { icon })}
                      className={`w-7 h-7 rounded-md border flex items-center justify-center transition-colors ${
                        persona.icon === icon
                          ? "border-accent bg-accent-tint"
                          : "border-border hover:bg-active-row"
                      }`}
                    >
                      <Avatar name={agent.name} size={16} color={persona.color} icon={icon} />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <div className="text-[11px] text-text-secondary mb-1.5">Name</div>
        <input
          value={agent.name}
          disabled
          className="ui-field-muted"
        />
      </div>

      <div>
        <div className="text-[11px] text-text-secondary mb-1.5">Title</div>
        <input
          key={`title-${agent.id}`}
          defaultValue={persona.title ?? ""}
          onBlur={(e) => setPersona(agent.id, { title: e.target.value || undefined })}
          placeholder="Title — e.g. Sales pipeline"
          className="ui-field"
        />
      </div>

      <div>
        <div className="text-[11px] text-text-secondary mb-1.5">Description</div>
        <textarea
          key={`desc-${agent.id}`}
          defaultValue={persona.description ?? ""}
          onBlur={(e) => setPersona(agent.id, { description: e.target.value || undefined })}
          placeholder="Description — what this agent owns"
          rows={4}
          className="ui-field resize-none"
        />
        <p className="mt-1 text-[10px] text-text-secondary leading-snug">
          This is the routing table for the whole team — keep it specific.
        </p>
      </div>

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            <Cpu size={14} className="shrink-0 text-text-secondary" />
            <div>
              <div className="text-[12px] font-medium">Runtime</div>
              <div className="text-[10px] text-text-secondary leading-snug">
                {runtimeLabel(agent.runtime)}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRuntimeModalOpen(true)}
            className="shrink-0 text-[11px] text-text-secondary hover:text-text-primary transition-colors"
          >
            Change runtime
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="min-w-0 flex items-center gap-2">
          <Monitor size={14} className="shrink-0 text-text-secondary" />
          <div>
            <div className="text-[12px] font-medium">Desktop</div>
            <div className="text-[10px] text-text-secondary leading-snug">
              {desktopEnabled ? "Enabled — applies next start." : "Disabled for this agent."}
            </div>
          </div>
        </div>
        <button
          role="switch"
          aria-checked={desktopEnabled}
          onClick={() => onSetAgentDesktopEnabled(agent.id, !desktopEnabled)}
          className={`shrink-0 w-8 h-[18px] rounded-full relative transition-colors ${desktopEnabled ? "bg-accent" : "bg-border-strong"}`}
        >
          <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${desktopEnabled ? "left-[16px]" : "left-[2px]"}`} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="min-w-0 flex items-center gap-2">
          <Volume2 size={14} className="shrink-0 text-text-secondary" />
          <div>
            <div className="text-[12px] font-medium">Voice replies</div>
            <div className="text-[10px] text-text-secondary leading-snug">
              {voiceSet
                ? "Agent replies read aloud — applies immediately."
                : "Upload audio to have your agent speak"}
            </div>
          </div>
        </div>
        <button
          role="switch"
          aria-checked={voiceReplies}
          disabled={!voiceSet}
          title={voiceSet ? undefined : "Upload audio to have your agent speak"}
          onClick={() => {
            setVoiceRepliesEnabled(agent.id, !voiceReplies);
            setVoiceReplies(!voiceReplies);
          }}
          className={`shrink-0 w-8 h-[18px] rounded-full relative transition-colors disabled:opacity-40 ${
            voiceReplies ? "bg-accent" : "bg-border-strong"
          }`}
        >
          <span
            className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${
              voiceReplies ? "left-[16px]" : "left-[2px]"
            }`}
          />
        </button>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="min-w-0 flex items-center gap-2">
          <Bell size={14} className="shrink-0 text-text-secondary" />
          <div>
            <div className="text-[12px] font-medium">Notifications</div>
            <div className="text-[10px] text-text-secondary leading-snug">
              Get notified when this agent finishes or needs input.
            </div>
          </div>
        </div>
        <button
          role="switch"
          aria-checked={notify}
          onClick={() => setNotify(!notify)}
          className={`shrink-0 w-8 h-[18px] rounded-full relative transition-colors ${
            notify ? "bg-accent" : "bg-border-strong"
          }`}
        >
          <span
            className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all ${
              notify ? "left-[16px]" : "left-[2px]"
            }`}
          />
        </button>
      </div>

      <button
        disabled
        className="w-full rounded-lg border border-border-strong text-[12px] font-medium py-2 disabled:opacity-40 transition-colors"
      >
        Share as template
      </button>

      </div>
      <div className="shrink-0 border-t border-border bg-surface p-3">
        <DangerZone agent={agent} onArchive={onArchive} onRestore={onRestore} onStop={onStop} onDelete={onDelete} />
      </div>
      {identityModal === "avatar" && (
        <AvatarPickerModal
          agent={agent}
          onClose={() => setIdentityModal(null)}
          onUpload={onUploadAgentAvatar}
          onDelete={onDeleteAgentAvatar}
        />
      )}
      {identityModal === "voice" && (
        <VoicePickerModal
          agent={agent}
          voiceApiUnavailable={voiceApiUnavailable}
          onClose={() => setIdentityModal(null)}
          onUpload={onUploadAgentVoice}
          onDelete={onDeleteAgentVoice}
        />
      )}
      {runtimeModalOpen && (
        <ChangeRuntimeModal
          agent={agent}
          onSetAgentRuntime={onSetAgentRuntime}
          onClose={() => setRuntimeModalOpen(false)}
        />
      )}
    </div>
  );
}

function IdentityModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <main
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal-card relative flex max-h-[86vh] w-[360px] max-w-[calc(100vw-32px)] flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold">{title}</div>
            <div className="text-[11px] text-text-secondary">{subtitle}</div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        <button
          onClick={onClose}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-text-secondary hover:bg-active-row hover:text-foreground transition-colors"
        >
          <X size={15} />
        </button>
      </main>
    </div>
  );
}

function AvatarPickerModal({
  agent,
  onClose,
  onUpload,
  onDelete,
}: {
  agent: AgentSummary;
  onClose: () => void;
  onUpload: (id: string, file: File) => void;
  onDelete: (id: string) => void;
}) {
  const persona = usePersona(agent.id);
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <IdentityModalShell title="Change avatar" subtitle="PNG, JPEG, WebP or GIF." onClose={onClose}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          onUpload(agent.id, file);
          onClose();
        }}
      />
      <div className="flex justify-center">
        <Avatar
          name={agent.name}
          url={agent.avatar_url}
          size={56}
          color={persona.color}
          icon={persona.icon}
        />
      </div>
      <div className="mt-4 flex items-center justify-between">
        {agent.avatar_url ? (
          <button
            type="button"
            onClick={() => {
              onDelete(agent.id);
              onClose();
            }}
            className="text-[12px] text-error hover:underline"
          >
            Remove avatar
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="ui-secondary-button"
        >
          Choose image
        </button>
      </div>
    </IdentityModalShell>
  );
}

function VoicePickerModal({
  agent,
  voiceApiUnavailable,
  onClose,
  onUpload,
  onDelete,
}: {
  agent: AgentSummary;
  voiceApiUnavailable: boolean;
  onClose: () => void;
  onUpload: (id: string, file: File) => void;
  onDelete: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const voiceSet = hasAgentVoice(agent);
  const status = voiceApiUnavailable
    ? "Voice upload is not available in this environment."
    : voiceSet
      ? "Voice set"
      : "No voice yet";

  return (
    <IdentityModalShell title="Change voice" subtitle={status} onClose={onClose}>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.mp4,video/mp4,video/webm"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          const problem = validateAgentVoiceFile(file);
          if (problem) {
            setHint(problem);
            return;
          }
          setHint(null);
          onUpload(agent.id, file);
          onClose();
        }}
      />
      {hint && (
        <p className="text-[10px] text-error leading-snug">{hint}</p>
      )}
      <div className={`flex items-center justify-between ${hint ? "mt-3" : ""}`}>
        {voiceSet && !voiceApiUnavailable ? (
          <button
            type="button"
            onClick={() => {
              onDelete(agent.id);
              onClose();
            }}
            className="text-[12px] text-error hover:underline"
          >
            Remove voice
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={voiceApiUnavailable}
          onClick={() => inputRef.current?.click()}
          className="ui-secondary-button disabled:opacity-40"
        >
          Choose audio
        </button>
      </div>
    </IdentityModalShell>
  );
}

function launchConfigText(config: unknown, key: string): string {
  if (!plainRecord(config)) return "";
  const value = config[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value.join(" ");
  return "";
}

function splitCommand(input: string): string[] {
  const words: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) words.push(match[1] ?? match[2] ?? match[3]);
  return words;
}

function launchConfigEnv(config: unknown): Record<string, string> {
  if (!plainRecord(config) || !plainRecord(config.env)) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(config.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function envRecordToText(env: Record<string, string>): string {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n");
}

function parseEnvText(text: string): { env: Record<string, string> } | { error: string } {
  const env: Record<string, string> = {};
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq < 1) return { error: `Line ${index + 1}: expected KEY=VALUE.` };
    env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return { env };
}

function envTextMatches(text: string, current: Record<string, string>): boolean {
  const parsed = parseEnvText(text);
  if ("error" in parsed) return false;
  const keys = Object.keys(parsed.env);
  return keys.length === Object.keys(current).length && keys.every((key) => parsed.env[key] === current[key]);
}

function ChangeRuntimeModal({
  agent,
  onSetAgentRuntime,
  onClose,
}: {
  agent: AgentSummary;
  onSetAgentRuntime: (id: string, runtime: ManagedAgentRuntime, resetImage: boolean) => void;
  onClose: () => void;
}) {
  const current = agent.runtime ?? "generic";
  const currentImage = launchConfigText(agent.launchConfig, "image");
  const currentEntrypoint = launchConfigText(agent.launchConfig, "entrypoint");
  const currentCommand = launchConfigText(agent.launchConfig, "command");
  const currentEnv = launchConfigEnv(agent.launchConfig);
  const [selected, setSelected] = useState(current);
  const [resetImage, setResetImage] = useState(false);
  const [image, setImage] = useState(currentImage);
  const [entrypoint, setEntrypoint] = useState(currentEntrypoint);
  const [command, setCommand] = useState(currentCommand);
  const [envText, setEnvText] = useState(() => envRecordToText(currentEnv));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSelected(agent.runtime ?? "generic");
    setResetImage(false);
    setImage(launchConfigText(agent.launchConfig, "image"));
    setEntrypoint(launchConfigText(agent.launchConfig, "entrypoint"));
    setCommand(launchConfigText(agent.launchConfig, "command"));
    setEnvText(envRecordToText(launchConfigEnv(agent.launchConfig)));
    setError(null);
    setSaving(false);
  }, [agent.id]);
  const trimmedImage = image.trim();
  const trimmedEntrypoint = entrypoint.trim();
  const trimmedCommand = command.trim();
  const imageDirty = trimmedImage !== currentImage;
  const entrypointDirty = trimmedEntrypoint !== currentEntrypoint;
  const commandDirty = trimmedCommand !== currentCommand;
  const envDirty = !envTextMatches(envText, currentEnv);
  const dirty = selected !== current || resetImage || imageDirty || entrypointDirty || commandDirty || envDirty;
  const stopped = agent.state === "STOPPED";

  const apply = async () => {
    if (!dirty || saving) return;
    const parsedEnv = parseEnvText(envText);
    if ("error" in parsedEnv) {
      setError(parsedEnv.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Runtime/reset first, then launch overrides — reset_image is itself an
      // image write, so an explicit image must land after it.
      if (selected !== current || resetImage) {
        onSetAgentRuntime(agent.id, selected as ManagedAgentRuntime, resetImage);
      }
      if (imageDirty || entrypointDirty || commandDirty || envDirty) {
        await setAgentLaunchOverrides(agent.id, {
          ...(imageDirty ? { image: trimmedImage || null } : {}),
          ...(entrypointDirty ? { entrypoint: trimmedEntrypoint ? splitCommand(trimmedEntrypoint) : null } : {}),
          ...(commandDirty ? { command: trimmedCommand ? splitCommand(trimmedCommand) : null } : {}),
          ...(envDirty ? { env: parsedEnv.env } : {}),
        });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : typeof e === "string" ? e : "Could not apply the runtime change.");
      setSaving(false);
    }
  };

  return (
    <IdentityModalShell
      title="Change runtime"
      subtitle={`Current: ${runtimeLabel(agent.runtime)}`}
      onClose={onClose}
    >
      <div className="space-y-3">
        <div>
          <div className="text-[11px] text-text-secondary mb-1.5">Runtime</div>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="ui-field w-full"
          >
            {MANAGED_RUNTIMES.map((runtime) => (
              <option key={runtime} value={runtime}>
                {runtimeLabel(runtime)}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-start gap-2 text-[11px] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={resetImage}
            onChange={(e) => setResetImage(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Reset image to this runtime's default on next start
            {resetImage && !stopped && (
              <span className="block text-[10px] text-error mt-0.5">
                Requires the agent stopped — stop it first.
              </span>
            )}
          </span>
        </label>
        <div className="border-t border-border pt-3 text-[11px] font-medium text-text-secondary">
          Overrides
        </div>
        <div>
          <div className="text-[11px] text-text-secondary mb-1.5">Custom image</div>
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="ghcr.io/you/image:tag"
            className="ui-field w-full"
          />
        </div>
        <div>
          <div className="text-[11px] text-text-secondary mb-1.5">Custom entrypoint</div>
          <input
            value={entrypoint}
            onChange={(e) => setEntrypoint(e.target.value)}
            placeholder="/entrypoint.sh"
            className="ui-field w-full"
          />
        </div>
        <div>
          <div className="text-[11px] text-text-secondary mb-1.5">Custom command</div>
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="/usr/local/bin/opencode"
            className="ui-field w-full"
          />
        </div>
        <div>
          <div className="text-[11px] text-text-secondary mb-1.5">Custom env</div>
          <textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            placeholder="KEY=VALUE"
            rows={5}
            spellCheck={false}
            className="ui-field w-full resize-none font-mono"
          />
          <p className="mt-1 text-[10px] text-text-secondary leading-snug">
            One KEY=VALUE per line — replaces all env on next start.
          </p>
        </div>
        {error && <p className="text-[11px] text-error leading-snug">{error}</p>}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-[12px] text-text-secondary hover:text-foreground transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!dirty || saving}
            className="onboarding-primary min-w-20 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      </div>
    </IdentityModalShell>
  );
}

function DangerZone({
  agent,
  onArchive,
  onRestore,
  onStop,
  onDelete,
}: {
  agent: AgentSummary;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState<"stop" | "archive" | "delete" | null>(null);
  const [visible, setVisible] = useState(false);
  const stopped = agent.state === "STOPPED";
  const archived = agent.state === "ARCHIVED";
  const failed = agent.state === "FAILED";
  const deleted = isDeletedState(agent.state);
  const running = agent.state === RUNNING;
  // A failed agent is stopped-compute too: blocking archive and delete on it
  // used to say "stop the agent first" — a dead end with no way out.
  const inactive = stopped || failed;
  useEffect(() => {
    setConfirm(null);
    setVisible(false);
  }, [agent.id]);

  return (
    <div className="space-y-3">
      <Caption>AGENT</Caption>
      <dl className="soft-card divide-y divide-border">
        <Row label="Runtime" value={runtimeLabel(agent.runtime)} />
        {agent.size && <Row label="Size" value={agent.size} />}
        {agent.hostname && <Row label="Host" value={agent.hostname} mono />}
      </dl>
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="side-caption text-error">
            DANGER ZONE
          </div>
          <button
            onClick={() => {
              setConfirm(null);
              setVisible((v) => !v);
            }}
            className="text-[11px] text-text-secondary hover:text-text-primary transition-colors"
          >
            {visible ? "Hide" : "Show"}
          </button>
        </div>
        {visible && (
        <div className="rounded-lg border border-error/40 bg-error-bg/40 divide-y divide-border">
          {deleted ? (
            <div className="px-3 py-2.5 text-[11px] text-text-secondary">
              This agent is deleted. Only its row remains.
            </div>
          ) : archived ? (
            <DangerRow
              title="Restore agent"
              description="Bring storage back from the archive."
              action="Restore"
              onClick={() => onRestore(agent.id)}
            />
          ) : (
            <>
              <DangerRow
                title="Stop agent"
                description={running ? "Shut down compute; files stay available." : "Agent is not running."}
                action={confirm === "stop" ? "Confirm" : "Stop"}
                disabled={!running}
                onClick={() => {
                  if (confirm === "stop") {
                    setConfirm(null);
                    onStop(agent.id);
                  } else setConfirm("stop");
                }}
              />
              <DangerRow
                title="Archive agent"
                description={inactive ? "Pack storage away; restore anytime." : "Stop the agent first."}
                action={confirm === "archive" ? "Confirm" : "Archive"}
                disabled={!inactive}
                onClick={() => {
                  if (confirm === "archive") {
                    setConfirm(null);
                    onArchive(agent.id);
                  } else setConfirm("archive");
                }}
              />
              <DangerRow
                title="Delete agent"
                description={
                  inactive || archived ? "Gone for good. Files in the archive stay." : "Stop the agent first."
                }
                action={confirm === "delete" ? "Confirm" : "Delete"}
                disabled={!inactive && !archived}
                onClick={() => {
                  if (confirm === "delete") {
                    setConfirm(null);
                    onDelete(agent.id);
                  } else setConfirm("delete");
                }}
              />
            </>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
      <dt className="text-text-secondary shrink-0">{label}</dt>
      <dd className={`truncate ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}

function DangerRow({
  title,
  description,
  action,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  action: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[12px] font-medium">{title}</div>
        <div className="text-[11px] text-text-secondary">{description}</div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className="ui-danger-button"
      >
        {action}
      </button>
    </div>
  );
}
