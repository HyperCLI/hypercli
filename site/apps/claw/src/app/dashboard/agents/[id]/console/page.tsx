"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  File,
  FolderOpen,
  Loader2,
  MessageSquare,
  Save,
  Send,
  Settings,
  X as XIcon,
} from "lucide-react";

import { useClawAuth } from "@/hooks/useClawAuth";
import { clawFetch } from "@/lib/api";
import { GatewayClient, type ChatEvent } from "@/gateway-client";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

interface Agent {
  id: string;
  name: string;
  state: string;
  hostname: string | null;
  jwt_token?: string | null;
  openclaw_url?: string | null;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: Array<{ name: string; args: string; result?: string }>;
  timestamp?: number;
}

interface WorkspaceFile {
  name: string;
  size: number;
  missing: boolean;
}

type Panel = "chat" | "files" | "config";

// -----------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------

export default function AgentConsolePage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.id as string;
  const { getToken } = useClawAuth();

  // Agent state
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Gateway
  const gwRef = useRef<GatewayClient | null>(null);
  const [gwConnected, setGwConnected] = useState(false);
  const [gwError, setGwError] = useState<string | null>(null);

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Files
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [savingFile, setSavingFile] = useState(false);

  // Config
  const [configSchema, setConfigSchema] = useState<any>(null);
  const [config, setConfig] = useState<any>(null);

  // Panel state
  const [activePanel, setActivePanel] = useState<Panel>("chat");
  const [gwAgentId, setGwAgentId] = useState<string>("main");

  // -----------------------------------------------------------------------
  // Fetch agent details
  // -----------------------------------------------------------------------

  const fetchAgent = useCallback(async () => {
    try {
      const token = await getToken();
      const resp = await clawFetch<Agent>(`/agents/${agentId}`, token);
      setAgent(resp);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [agentId, getToken]);

  useEffect(() => { fetchAgent(); }, [fetchAgent]);

  // -----------------------------------------------------------------------
  // Gateway connection
  // -----------------------------------------------------------------------

  const connectGateway = useCallback(async () => {
    if (!agent || agent.state !== "RUNNING" || !agent.hostname) return;

    const url = agent.openclaw_url || `wss://openclaw-${agent.hostname}`;
    if (!url) {
      setGwError("No gateway URL available");
      return;
    }

    try {
      const subdomain = agent.hostname.split(".")[0];
      const hostCookie = `${subdomain}-token`;
      const shellCookie = `shell-${subdomain}-token`;
      const openclawCookie = `openclaw-${subdomain}-token`;
      const reefCookie = "reef_token";
      const hasCookie = (name: string) =>
        document.cookie.split(";").some((entry) => entry.trim().startsWith(`${encodeURIComponent(name)}=`));
      const configuredCookieDomain = (process.env.NEXT_PUBLIC_HYPERCLAW_COOKIE_DOMAIN || "").trim();
      const normalizedDomain = configuredCookieDomain.replace(/^\./, "");
      const currentHost = typeof window !== "undefined" ? window.location.hostname : "";
      const canUseCrossDomainCookie =
        normalizedDomain &&
        (currentHost === normalizedDomain || currentHost.endsWith(`.${normalizedDomain}`));
      const cookieDomain = canUseCrossDomainCookie
        ? (configuredCookieDomain || `.${normalizedDomain}`)
        : "";

      if (!(hasCookie(hostCookie) || hasCookie(shellCookie) || hasCookie(openclawCookie) || hasCookie(reefCookie))) {
        const authToken = await getToken();
        const tokenResp = await clawFetch<{ token: string }>(`/agents/${agentId}/token`, authToken);
        const tokenValue = encodeURIComponent(tokenResp.token);
        const securePart = window.location.protocol === "https:" ? "; secure" : "";
        const domainPart = cookieDomain ? `; domain=${cookieDomain}` : "";
        const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toUTCString();

        document.cookie = `${hostCookie}=${tokenValue}; expires=${expires}; path=/${domainPart}${securePart}; samesite=lax`;
        document.cookie = `${shellCookie}=${tokenValue}; expires=${expires}; path=/${domainPart}${securePart}; samesite=lax`;
        document.cookie = `${openclawCookie}=${tokenValue}; expires=${expires}; path=/${domainPart}${securePart}; samesite=lax`;
        document.cookie = `${reefCookie}=${tokenValue}; expires=${expires}; path=/${domainPart}${securePart}; samesite=lax`;
      }

      const gw = new GatewayClient({
        url,
      });

      // Set up event handler for streaming chat
      gw.onEvent((event, payload) => {
        if (event === "chat.content") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, content: last.content + (payload.text ?? "") }];
            }
            return [...prev, { role: "assistant", content: payload.text as string ?? "", timestamp: Date.now() }];
          });
        } else if (event === "chat.thinking") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, thinking: (last.thinking ?? "") + (payload.text ?? "") }];
            }
            return [...prev, { role: "assistant", content: "", thinking: payload.text as string ?? "", timestamp: Date.now() }];
          });
        } else if (event === "chat.tool_call") {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              const tc = { name: (payload as any).name ?? "?", args: JSON.stringify(payload) };
              return [...prev.slice(0, -1), { ...last, toolCalls: [...(last.toolCalls ?? []), tc] }];
            }
            return prev;
          });
        } else if (event === "chat.done") {
          setSending(false);
        } else if (event === "chat.error") {
          setSending(false);
          setMessages((prev) => [...prev, { role: "system", content: `Error: ${(payload as any).message ?? "Unknown error"}`, timestamp: Date.now() }]);
        }
      });

      await gw.connect();
      gwRef.current = gw;
      setGwConnected(true);
      setGwError(null);

      // Load agents list to get the gateway agent ID
      const agents = await gw.agentsList();
      if (agents.length > 0) {
        setGwAgentId(agents[0].id);
      }

      // Load files
      const agentIdForFiles = agents.length > 0 ? agents[0].id : "main";
      const filesList = await gw.filesList(agentIdForFiles);
      setFiles(filesList);

      // Load config + schema
      const [cfg, schema] = await Promise.all([
        gw.configGet(),
        gw.configSchema(),
      ]);
      setConfig(cfg);
      setConfigSchema(schema);

    } catch (e: any) {
      setGwError(e.message);
    }
  }, [agent, agentId, getToken]);

  useEffect(() => {
    if (agent?.state === "RUNNING" && !gwConnected) {
      connectGateway();
    }
    return () => {
      gwRef.current?.close();
    };
  }, [agent?.state, connectGateway]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // -----------------------------------------------------------------------
  // Chat handlers
  // -----------------------------------------------------------------------

  const sendMessage = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw || !input.trim() || sending) return;

    const msg = input.trim();
    setInput("");
    setSending(true);
    setMessages((prev) => [...prev, { role: "user", content: msg, timestamp: Date.now() }]);

    try {
      await gw.chatSend(msg);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "system", content: `Error: ${e.message}`, timestamp: Date.now() }]);
      setSending(false);
    }
  }, [input, sending]);

  // -----------------------------------------------------------------------
  // File handlers
  // -----------------------------------------------------------------------

  const openFile = useCallback(async (name: string) => {
    const gw = gwRef.current;
    if (!gw) return;
    try {
      const content = await gw.fileGet(gwAgentId, name);
      setSelectedFile(name);
      setFileContent(content);
      setFileDirty(false);
    } catch (e: any) {
      setSelectedFile(name);
      setFileContent(`Error loading file: ${e.message}`);
    }
  }, [gwAgentId]);

  const saveFile = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw || !selectedFile) return;
    setSavingFile(true);
    try {
      await gw.fileSet(gwAgentId, selectedFile, fileContent);
      setFileDirty(false);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSavingFile(false);
    }
  }, [gwAgentId, selectedFile, fileContent]);

  // -----------------------------------------------------------------------
  // Config handlers
  // -----------------------------------------------------------------------

  const [configJson, setConfigJson] = useState("");
  const [configDirty, setConfigDirty] = useState(false);

  useEffect(() => {
    if (config) {
      setConfigJson(JSON.stringify(config, null, 2));
    }
  }, [config]);

  const saveConfig = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw) return;
    try {
      const patch = JSON.parse(configJson);
      await gw.configPatch(patch);
      setConfigDirty(false);
    } catch (e: any) {
      alert(`Config save failed: ${e.message}`);
    }
  }, [configJson]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-red-400">{error || "Agent not found"}</p>
        <button onClick={() => router.push("/dashboard/agents")} className="text-blue-400 hover:underline">
          ← Back to agents
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-zinc-950">
        <button onClick={() => router.push("/dashboard/agents")} className="text-zinc-400 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <Bot className="w-5 h-5 text-emerald-400" />
        <span className="font-mono text-sm text-white">{agent.name}</span>
        <span className={`text-xs px-2 py-0.5 rounded ${
          agent.state === "RUNNING" ? "bg-emerald-900/50 text-emerald-400" :
          agent.state === "STOPPED" ? "bg-zinc-800 text-zinc-400" :
          "bg-yellow-900/50 text-yellow-400"
        }`}>
          {agent.state}
        </span>
        {gwConnected && <span className="text-xs text-emerald-500">● Gateway</span>}
        {gwError && <span className="text-xs text-red-400">⚠ {gwError}</span>}

        <div className="flex-1" />

        {/* Panel tabs */}
        <div className="flex gap-1">
          {(["chat", "files", "config"] as Panel[]).map((p) => (
            <button
              key={p}
              onClick={() => setActivePanel(p)}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors ${
                activePanel === p ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {p === "chat" && <MessageSquare className="w-3.5 h-3.5" />}
              {p === "files" && <FolderOpen className="w-3.5 h-3.5" />}
              {p === "config" && <Settings className="w-3.5 h-3.5" />}
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden">
        {activePanel === "chat" && (
          <ChatPanel
            messages={messages}
            input={input}
            sending={sending}
            connected={gwConnected}
            onInputChange={setInput}
            onSend={sendMessage}
            chatEndRef={chatEndRef}
          />
        )}

        {activePanel === "files" && (
          <FilesPanel
            files={files}
            selectedFile={selectedFile}
            fileContent={fileContent}
            fileDirty={fileDirty}
            savingFile={savingFile}
            onOpenFile={openFile}
            onContentChange={(c) => { setFileContent(c); setFileDirty(true); }}
            onSave={saveFile}
            onClose={() => setSelectedFile(null)}
          />
        )}

        {activePanel === "config" && (
          <ConfigPanel
            config={configJson}
            schema={configSchema}
            dirty={configDirty}
            onChange={(c) => { setConfigJson(c); setConfigDirty(true); }}
            onSave={saveConfig}
          />
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Chat Panel
// -----------------------------------------------------------------------

function ChatPanel({
  messages,
  input,
  sending,
  connected,
  onInputChange,
  onSend,
  chatEndRef,
}: {
  messages: ChatMessage[];
  input: string;
  sending: boolean;
  connected: boolean;
  onInputChange: (v: string) => void;
  onSend: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600">
            <MessageSquare className="w-8 h-8 mb-2" />
            <p className="text-sm">Send a message to start chatting with your agent</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
              msg.role === "user"
                ? "bg-blue-600 text-white"
                : msg.role === "system"
                  ? "bg-red-900/30 text-red-300 border border-red-800/50"
                  : "bg-zinc-800 text-zinc-200"
            }`}>
              {msg.thinking && (
                <details className="mb-2">
                  <summary className="text-xs text-zinc-500 cursor-pointer">💭 Thinking...</summary>
                  <pre className="text-xs text-zinc-500 whitespace-pre-wrap mt-1">{msg.thinking}</pre>
                </details>
              )}
              {msg.toolCalls?.map((tc, j) => (
                <div key={j} className="mb-2 text-xs bg-zinc-900/50 rounded p-2 font-mono">
                  <span className="text-yellow-400">🔧 {tc.name}</span>
                  {tc.result && <pre className="text-zinc-500 mt-1">{tc.result}</pre>}
                </div>
              ))}
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 rounded-lg px-4 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
            placeholder={connected ? "Type a message..." : "Waiting for gateway connection..."}
            disabled={!connected || sending}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={onSend}
            disabled={!connected || sending || !input.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white px-3 py-2 rounded-lg transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// Files Panel
// -----------------------------------------------------------------------

function FilesPanel({
  files,
  selectedFile,
  fileContent,
  fileDirty,
  savingFile,
  onOpenFile,
  onContentChange,
  onSave,
  onClose,
}: {
  files: WorkspaceFile[];
  selectedFile: string | null;
  fileContent: string;
  fileDirty: boolean;
  savingFile: boolean;
  onOpenFile: (name: string) => void;
  onContentChange: (content: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  if (selectedFile) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <File className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-mono text-white">{selectedFile}</span>
          {fileDirty && <span className="text-xs text-yellow-400">● unsaved</span>}
          <div className="flex-1" />
          <button
            onClick={onSave}
            disabled={!fileDirty || savingFile}
            className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 rounded transition-colors"
          >
            {savingFile ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Save
          </button>
        </div>
        <textarea
          value={fileContent}
          onChange={(e) => onContentChange(e.target.value)}
          className="flex-1 bg-zinc-950 text-zinc-200 font-mono text-sm p-4 resize-none focus:outline-none"
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-1">
      <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Workspace Files</h3>
      {files.length === 0 && <p className="text-sm text-zinc-600">No files</p>}
      {files.map((f) => (
        <button
          key={f.name}
          onClick={() => onOpenFile(f.name)}
          className="flex items-center gap-2 w-full px-3 py-2 rounded hover:bg-zinc-800 transition-colors text-left"
        >
          <File className={`w-4 h-4 ${f.missing ? "text-red-400" : "text-zinc-400"}`} />
          <span className="text-sm text-zinc-200 font-mono flex-1">{f.name}</span>
          <span className="text-xs text-zinc-600">{(f.size / 1024).toFixed(1)}KB</span>
          <ChevronRight className="w-3 h-3 text-zinc-600" />
        </button>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------
// Config Panel
// -----------------------------------------------------------------------

function ConfigPanel({
  config,
  schema,
  dirty,
  onChange,
  onSave,
}: {
  config: string;
  schema: any;
  dirty: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <Settings className="w-4 h-4 text-zinc-400" />
        <span className="text-sm font-semibold text-white">Gateway Configuration</span>
        {dirty && <span className="text-xs text-yellow-400">● unsaved</span>}
        <div className="flex-1" />
        <button
          onClick={onSave}
          disabled={!dirty}
          className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 rounded transition-colors"
        >
          <Save className="w-3 h-3" />
          Apply & Restart
        </button>
      </div>

      {schema?.uiHints && (
        <div className="px-4 py-2 border-b border-zinc-800/50 bg-zinc-900/50">
          <p className="text-xs text-zinc-500">
            Edit the JSON config below. Changes are merged with the existing config and trigger a gateway restart.
          </p>
        </div>
      )}

      <textarea
        value={config}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-zinc-950 text-zinc-200 font-mono text-sm p-4 resize-none focus:outline-none"
        spellCheck={false}
      />
    </div>
  );
}
