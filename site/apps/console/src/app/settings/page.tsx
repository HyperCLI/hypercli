"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Header,
  Footer,
  Button,
  Input,
  Label,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Badge,
  Separator,
  Switch,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  getAuthBackendUrl,
} from "@hypercli/shared-ui";
import { useRouter } from "next/navigation";
import { Navigation } from "../../components/Navigation";
import {
  Settings,
  Wifi,
  WifiOff,
  Bot,
  Key,
  FileText,
  Loader2,
  Save,
  RefreshCw,
  Terminal,
  Clock,
  Trash2,
  Plus,
  AlertTriangle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentPod {
  pod_id: string;
  pod_name: string;
  status: string;
  openclaw_url: string;
  vnc_url: string;
  hostname: string;
}

interface GatewayState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  version: string | null;
  config: Record<string, any> | null;
  sessions: any[];
}

// ---------------------------------------------------------------------------
// Lightweight WS RPC (inline, no external dep needed for console)
// ---------------------------------------------------------------------------

function makeId(): string {
  return crypto.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
}

class GatewayWS {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
  connected = false;

  async connect(url: string, jwt: string): Promise<{ version: string; protocol: number }> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(jwt)}`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      let phase: "challenge" | "hello" = "challenge";

      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout"));
        ws.close();
      }, 10000);

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (phase === "challenge" && msg.event === "connect.challenge") {
          phase = "hello";
          const connectReq = {
            type: "req",
            id: makeId(),
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: { id: "hypercli-console", version: "1.0.3", platform: "browser", mode: "webchat" },
              auth: { token: "traefik-forwarded-auth-not-used" },
              role: "operator",
              scopes: ["operator.admin"],
              caps: ["tool-events"],
            },
          };
          ws.send(JSON.stringify(connectReq));
          return;
        }

        if (phase === "hello" && msg.type === "res") {
          clearTimeout(timeout);
          if (msg.ok) {
            this.connected = true;
            ws.onmessage = this.handleMsg.bind(this);
            ws.onclose = () => { this.connected = false; };
            resolve({ version: msg.payload?.version ?? "?", protocol: msg.payload?.protocol ?? 3 });
          } else {
            reject(new Error(msg.error?.message ?? "Connect failed"));
            ws.close();
          }
          return;
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket error"));
      };

      ws.onclose = () => {
        this.connected = false;
        clearTimeout(timeout);
      };
    });
  }

  private handleMsg(event: MessageEvent) {
    const msg = JSON.parse(event.data);
    if (msg.type === "res") {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.ok ? p.resolve(msg.payload) : p.reject(new Error(msg.error?.message ?? "RPC error"));
      }
    }
  }

  async rpc(method: string, params: Record<string, any> = {}, timeout = 15000): Promise<any> {
    if (!this.connected || !this.ws) throw new Error("Not connected");
    const id = makeId();
    const req = { type: "req", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, timeout);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws!.send(JSON.stringify(req));
    });
  }

  close() {
    this.connected = false;
    this.ws?.close();
    this.ws = null;
  }
}

// ---------------------------------------------------------------------------
// Settings Page
// ---------------------------------------------------------------------------

function getAuthToken(): string | null {
  return document.cookie
    .split("; ")
    .find((row) => row.startsWith("auth_token="))
    ?.split("=")[1] ?? null;
}

export default function SettingsPage() {
  const router = useRouter();

  const [pods, setPods] = useState<AgentPod[]>([]);
  const [selectedPod, setSelectedPod] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gwState, setGwState] = useState<GatewayState>({
    connected: false,
    connecting: false,
    error: null,
    version: null,
    config: null,
    sessions: [],
  });
  const gwRef = useRef<GatewayWS | null>(null);

  // Load pods
  useEffect(() => {
    (async () => {
      try {
        const token = getAuthToken();
        if (!token) return;
        const res = await fetch(`${getAuthBackendUrl()}/lagoon/pods`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to load pods");
        const data = await res.json();
        setPods(data);
        if (data.length > 0 && !selectedPod) {
          setSelectedPod(data[0].pod_id);
        }
      } catch (e: any) {
        console.error("Failed to load pods:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Connect gateway when pod changes
  const connectGateway = useCallback(async (podId: string) => {
    // Disconnect previous
    gwRef.current?.close();
    setGwState((s) => ({ ...s, connected: false, connecting: true, error: null, config: null, sessions: [] }));

    try {
      const token = getAuthToken();
      if (!token) throw new Error("Not authenticated");
      // Get JWT for pod
      const tokenRes = await fetch(`${getAuthBackendUrl()}/lagoon/pods/${podId}/token/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!tokenRes.ok) throw new Error("Failed to get pod token");
      const { token: jwt } = await tokenRes.json();

      const pod = pods.find((p) => p.pod_id === podId);
      const wsUrl = pod?.openclaw_url ?? `wss://openclaw-${podId}.hypercli.com`;

      const gw = new GatewayWS();
      gwRef.current = gw;

      const info = await gw.connect(wsUrl, jwt);
      
      // Fetch config + sessions
      const [config, sessionsRes] = await Promise.all([
        gw.rpc("config.get"),
        gw.rpc("sessions.list"),
      ]);

      setGwState({
        connected: true,
        connecting: false,
        error: null,
        version: info.version,
        config,
        sessions: sessionsRes?.sessions ?? sessionsRes ?? [],
      });
    } catch (e: any) {
      setGwState((s) => ({
        ...s,
        connected: false,
        connecting: false,
        error: e.message,
      }));
    }
  }, [pods]);

  useEffect(() => {
    if (selectedPod) connectGateway(selectedPod);
    return () => { gwRef.current?.close(); };
  }, [selectedPod]);

  // Save config
  const saveConfig = async (patch: Record<string, any>) => {
    if (!gwRef.current?.connected) return;
    setSaving(true);
    try {
      await gwRef.current.rpc("config.patch", { patch });
      // Refresh config
      const config = await gwRef.current.rpc("config.get");
      setGwState((s) => ({ ...s, config }));
    } catch (e: any) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Config Editor State
  // ---------------------------------------------------------------------------
  const config = gwState.config ?? {};
  const models = config.models ?? {};
  const providers = models.providers ?? {};
  const defaultModel = models.default ?? "";

  const [editModel, setEditModel] = useState("");
  const [editProviderKey, setEditProviderKey] = useState("");
  const [editProviderUrl, setEditProviderUrl] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // Sync edit fields when config loads
  useEffect(() => {
    if (config.models) {
      setEditModel(config.models.default ?? "");
    }
  }, [gwState.config]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Navigation />
      <main className="max-w-5xl mx-auto px-4 pt-24 pb-12">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Agent Settings</h1>
          {gwState.connected ? (
            <Badge variant="default" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              <Wifi className="h-3 w-3 mr-1" /> Connected
            </Badge>
          ) : gwState.connecting ? (
            <Badge variant="secondary">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Connecting...
            </Badge>
          ) : (
            <Badge variant="destructive">
              <WifiOff className="h-3 w-3 mr-1" /> Disconnected
            </Badge>
          )}
          {gwState.version && (
            <span className="text-xs text-muted-foreground">v{gwState.version}</span>
          )}
        </div>

        {/* Pod Selector */}
        <div className="mb-6">
          <Label className="text-sm text-muted-foreground mb-2 block">Agent</Label>
          <div className="flex gap-2 flex-wrap">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : pods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agents found. Create one first.</p>
            ) : (
              pods
                .filter((p) => p.status === "running")
                .map((pod) => (
                  <Button
                    key={pod.pod_id}
                    variant={selectedPod === pod.pod_id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedPod(pod.pod_id)}
                  >
                    <Bot className="h-3.5 w-3.5 mr-1.5" />
                    {pod.pod_name}
                  </Button>
                ))
            )}
          </div>
        </div>

        {gwState.error && (
          <div className="mb-6 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {gwState.error}
          </div>
        )}

        {gwState.connected && (
          <Tabs defaultValue="models" className="space-y-4">
            <TabsList>
              <TabsTrigger value="models">
                <Bot className="h-4 w-4 mr-1.5" /> Models
              </TabsTrigger>
              <TabsTrigger value="providers">
                <Key className="h-4 w-4 mr-1.5" /> Providers
              </TabsTrigger>
              <TabsTrigger value="sessions">
                <Terminal className="h-4 w-4 mr-1.5" /> Sessions
              </TabsTrigger>
              <TabsTrigger value="files">
                <FileText className="h-4 w-4 mr-1.5" /> Files
              </TabsTrigger>
            </TabsList>

            {/* Models Tab */}
            <TabsContent value="models" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Default Model</CardTitle>
                  <CardDescription>The model this agent uses for inference</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-3">
                    <Input
                      value={editModel}
                      onChange={(e) => setEditModel(e.target.value)}
                      placeholder="e.g. anthropic/claude-sonnet-4-5"
                      className="flex-1"
                    />
                    <Button
                      onClick={() => saveConfig({ models: { default: editModel } })}
                      disabled={saving || editModel === defaultModel}
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                      Save
                    </Button>
                  </div>
                  {defaultModel && (
                    <p className="text-xs text-muted-foreground">
                      Current: <code className="bg-muted px-1 py-0.5 rounded">{defaultModel}</code>
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Providers Tab */}
            <TabsContent value="providers" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Model Providers</CardTitle>
                  <CardDescription>API keys and endpoints for LLM providers</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(providers).map(([name, prov]: [string, any]) => (
                    <div
                      key={name}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-colors",
                        selectedProvider === name
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-muted-foreground/50"
                      )}
                      onClick={() => {
                        setSelectedProvider(name);
                        setEditProviderKey(prov.apiKey === "__OPENCLAW_REDACTED__" ? "" : prov.apiKey ?? "");
                        setEditProviderUrl(prov.baseUrl ?? "");
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium">{name}</span>
                          {prov.baseUrl && (
                            <span className="ml-2 text-xs text-muted-foreground">{prov.baseUrl}</span>
                          )}
                        </div>
                        <Badge variant={prov.apiKey ? "default" : "destructive"} className="text-xs">
                          {prov.apiKey ? (prov.apiKey === "__OPENCLAW_REDACTED__" ? "Configured" : "Key set") : "No key"}
                        </Badge>
                      </div>
                      {prov.models && (
                        <div className="mt-1 flex gap-1 flex-wrap">
                          {prov.models.slice(0, 5).map((m: any) => (
                            <Badge key={m.id} variant="outline" className="text-xs">
                              {m.name ?? m.id}
                            </Badge>
                          ))}
                          {prov.models.length > 5 && (
                            <span className="text-xs text-muted-foreground">+{prov.models.length - 5} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {selectedProvider && (
                    <div className="mt-4 p-4 rounded-lg border border-dashed space-y-3">
                      <h4 className="font-medium text-sm">Edit: {selectedProvider}</h4>
                      <div>
                        <Label className="text-xs">API Key</Label>
                        <Input
                          type="password"
                          value={editProviderKey}
                          onChange={(e) => setEditProviderKey(e.target.value)}
                          placeholder="sk-..."
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Base URL</Label>
                        <Input
                          value={editProviderUrl}
                          onChange={(e) => setEditProviderUrl(e.target.value)}
                          placeholder="https://api.openai.com/v1"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={() => {
                          const patch: Record<string, any> = {};
                          if (editProviderKey) patch.apiKey = editProviderKey;
                          if (editProviderUrl) patch.baseUrl = editProviderUrl;
                          saveConfig({
                            models: {
                              providers: { [selectedProvider]: patch },
                            },
                          });
                        }}
                        disabled={saving}
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                        Update Provider
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Sessions Tab */}
            <TabsContent value="sessions" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Active Sessions</CardTitle>
                  <CardDescription>Chat sessions running on this agent</CardDescription>
                </CardHeader>
                <CardContent>
                  {gwState.sessions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No active sessions.</p>
                  ) : (
                    <div className="space-y-2">
                      {gwState.sessions.map((session: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                          <div>
                            <span className="font-mono text-sm">{session.key ?? session.sessionKey ?? `Session ${i + 1}`}</span>
                            {session.model && (
                              <Badge variant="outline" className="ml-2 text-xs">{session.model}</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {session.messageCount != null && (
                              <span className="text-xs text-muted-foreground">{session.messageCount} messages</span>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                if (confirm("Reset this session? This clears all chat history.")) {
                                  try {
                                    await gwRef.current?.rpc("sessions.reset", { sessionKey: session.key ?? session.sessionKey });
                                    const sessionsRes = await gwRef.current?.rpc("sessions.list");
                                    setGwState((s) => ({ ...s, sessions: sessionsRes?.sessions ?? sessionsRes ?? [] }));
                                  } catch (e: any) {
                                    alert(`Reset failed: ${e.message}`);
                                  }
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={async () => {
                      const sessionsRes = await gwRef.current?.rpc("sessions.list");
                      setGwState((s) => ({ ...s, sessions: sessionsRes?.sessions ?? sessionsRes ?? [] }));
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Files Tab */}
            <TabsContent value="files">
              <AgentFiles gw={gwRef.current} />
            </TabsContent>
          </Tabs>
        )}
      </main>
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Files Sub-Component
// ---------------------------------------------------------------------------

function AgentFiles({ gw }: { gw: GatewayWS | null }) {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!gw?.connected) return;
    (async () => {
      try {
        const res = await gw.rpc("agents.files.get", { agentId: "main" });
        setFiles(res?.files ?? []);
      } catch {}
    })();
  }, [gw]);

  const loadFile = async (path: string) => {
    if (!gw?.connected) return;
    setLoading(true);
    setSelectedFile(path);
    try {
      const res = await gw.rpc("agents.files.get", { agentId: "main", path });
      setFileContent(res?.content ?? "");
    } catch (e: any) {
      setFileContent(`Error loading file: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!gw?.connected || !selectedFile) return;
    setSaving(true);
    try {
      await gw.rpc("agents.files.set", { agentId: "main", path: selectedFile, content: fileContent });
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent Files</CardTitle>
        <CardDescription>Workspace files (SOUL.md, AGENTS.md, etc.)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-4">
          {/* File list */}
          <div className="w-48 space-y-1">
            {files.map((f) => (
              <button
                key={f}
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded text-sm transition-colors",
                  selectedFile === f
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted text-muted-foreground"
                )}
                onClick={() => loadFile(f)}
              >
                <FileText className="h-3.5 w-3.5 inline mr-1.5" />
                {f}
              </button>
            ))}
          </div>

          {/* Editor */}
          <div className="flex-1">
            {selectedFile ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm">{selectedFile}</span>
                  <Button size="sm" onClick={saveFile} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
                    Save
                  </Button>
                </div>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <textarea
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    className="w-full h-96 p-3 font-mono text-sm bg-muted rounded-lg border resize-y"
                    spellCheck={false}
                  />
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select a file to edit.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
