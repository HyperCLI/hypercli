"use client";

import React, { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { 
  useAuth, 
  WalletAuth, 
  cookieUtils, 
  TopUpModal, 
  getAuthBackendUrl, 
  getBotApiUrl, 
  getBotWsBase, 
  getLlmApiUrl,
  initializeTheme,
  toggleTheme as toggleThemeUtil,
  subscribeToThemeChanges,
  type Theme
} from "@hypercli/shared-ui";
import { useTurnkey } from "@turnkey/react-wallet-kit";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChatSidebar, ChatWindow, ChatHeader, ChatInput, parseRenderFromText } from "../components";
import { initViewportHeight } from "./viewport-height";

// Bot API types
interface SelectionOption {
  id: string;
  label: string;
  description?: string | null;
}

interface RenderMeta {
  render_id: string;
  state?: string | null;
  template?: string | null;
  gpu_type?: string | null;
  result_url?: string | null;
  error?: string | null;
  render_type?: string | null;
  width?: number | null;
  height?: number | null;
  prompt?: string | null;
  model?: string | null;
}

interface MessageMeta {
  options?: SelectionOption[];
  tool_call?: {
    id?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  };
  pending_tool_call?: {
    name: string;
    status: 'calling' | 'executing' | 'done';
    arguments?: Record<string, unknown>;
  };
  render?: RenderMeta;
}

interface Message {
  id: number | string; // API returns number, temp messages use string
  role: "user" | "assistant";
  content: string;
  type?: string;
  meta?: MessageMeta | null;
  status?: string;
  error?: string | null;
  created_at: string;
}

interface Thread {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface Model {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface Balance {
  user_id: string;
  balance: string;
  balance_units: number;
  rewards_balance: string;
  rewards_balance_units: number;
  total_balance: string;
  total_balance_units: number;
  currency: string;
  decimals: number;
}

interface RenderNotification {
  id: number;
  render_id: string;
  status: string;
  result_url?: string | null;
  error?: string | null;
  created_at: string;
}

const normalizeRenderPayload = (payload: any): RenderMeta | null => {
  if (!payload || typeof payload !== "object") return null;
  const renderId = payload.render_id || payload.id || payload.renderId;
  if (!renderId || typeof renderId !== "string") return null;

  return {
    render_id: renderId,
    state: payload.state || payload.status || "queued",
    template: payload.template || payload.meta?.template || payload.params?.template || null,
    gpu_type: payload.gpu_type || payload.params?.gpu_type || null,
    result_url: payload.result_url || null,
    error: payload.error || null,
    render_type: payload.type || payload.render_type || null,
    width: payload.width || payload.params?.width || null,
    height: payload.height || payload.params?.height || null,
    prompt: payload.prompt || payload.params?.prompt || null,
    model: payload.model || null,
  };
};

// LocalStorage helpers for message persistence (avoids bot API which triggers OpenRouter)
const MESSAGES_STORAGE_KEY = 'hypercli_chat_messages';

const saveMessagesToStorage = (threadId: string, messages: Message[]) => {
  try {
    const allData = JSON.parse(localStorage.getItem(MESSAGES_STORAGE_KEY) || '{}');
    allData[threadId] = messages;
    localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(allData));
  } catch (e) {
    console.error('[Storage] Failed to save messages:', e);
  }
};

const loadMessagesFromStorage = (threadId: string): Message[] => {
  try {
    const allData = JSON.parse(localStorage.getItem(MESSAGES_STORAGE_KEY) || '{}');
    return allData[threadId] || [];
  } catch (e) {
    console.error('[Storage] Failed to load messages:', e);
    return [];
  }
};

const deleteMessagesFromStorage = (threadId: string) => {
  try {
    const allData = JSON.parse(localStorage.getItem(MESSAGES_STORAGE_KEY) || '{}');
    delete allData[threadId];
    localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(allData));
  } catch (e) {
    console.error('[Storage] Failed to delete messages:', e);
  }
};

const clearAllMessagesFromStorage = () => {
  try {
    localStorage.removeItem(MESSAGES_STORAGE_KEY);
  } catch (e) {
    console.error('[Storage] Failed to clear messages:', e);
  }
};

const extractRenderMetaFromResult = (result: unknown): RenderMeta | null => {
  if (!result) return null;

  if (typeof result === "object") {
    return normalizeRenderPayload(result);
  }

  if (typeof result !== "string") return null;
  const trimmed = result.trim();
  if (!trimmed) return null;

  let jsonCandidate = trimmed;
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) {
      jsonCandidate = trimmed.slice(start, end + 1);
    }
  }

  try {
    const payload = JSON.parse(jsonCandidate);
    return normalizeRenderPayload(payload);
  } catch {
    return null;
  }
};

function ChatPageContent() {
  const { isLoading, isAuthenticated } = useAuth();
  const { logout } = useTurnkey();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [initialMessageSent, setInitialMessageSent] = useState(false);

  // Theme
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  // Threads (from bot API)
  const [threads, setThreads] = useState<Thread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);

  // Models
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [loadingModels, setLoadingModels] = useState(true);

  // UI State
  const [pendingMessage, setPendingMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectionStatus, setSelectionStatus] = useState<Record<string, "pending" | "complete">>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const autoSelectedThreadRef = useRef(false);

  // Balance
  const [balance, setBalance] = useState<Balance | null>(null);

  // Track if user logged in via wallet (not just free tier)
  const [isWalletUser, setIsWalletUser] = useState(false);

  // Track if we're using Gemini (local API) vs bot API LLM streaming
  // When using Gemini, we should ignore WebSocket LLM streaming events
  const usingGeminiRef = useRef(false);

  // Persistent WebSocket connection
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const pendingSubscribeRef = useRef<{ messageId: number; resolve: () => void; reject: (err: Error) => void } | null>(null);
  const currentThreadIdRef = useRef<string | null>(null);
  const creatingFreeUserRef = useRef(false);
  const renderPollersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const renderPollAttemptsRef = useRef<Record<string, number>>({});
  const renderPollStartTimeRef = useRef<Record<string, number>>({}); // Track when polling started
  const renderNotificationPollerRef = useRef<NodeJS.Timeout | null>(null);

  // Max time to poll for a render (5 minutes)
  const RENDER_POLL_TIMEOUT_MS = 5 * 60 * 1000;

  // Keep ref in sync with state for use in WebSocket callbacks
  useEffect(() => {
    currentThreadIdRef.current = currentThreadId;
  }, [currentThreadId]);

  useEffect(() => {
    setSelectionStatus({});
  }, [currentThreadId]);

  // Check login type from localStorage
  useEffect(() => {
    const loginType = localStorage.getItem("hypercli_login_type");
    setIsWalletUser(loginType === "wallet");
  }, [isAuthenticated]);

  // Initialize viewport height handling for mobile
  useEffect(() => {
    initViewportHeight();
  }, []);

  // Show sign-in prompt only when not authenticated
  const showSignInPrompt = !isAuthenticated;

  // Load theme and subscribe to changes
  useEffect(() => {
    const currentTheme = initializeTheme();
    setTheme(currentTheme);

    // Subscribe to theme changes from other tabs/apps
    const unsubscribe = subscribeToThemeChanges((newTheme) => {
      setTheme(newTheme);
    });

    return unsubscribe;
  }, []);

  // Fetch threads from bot API
  const fetchThreads = useCallback(async () => {
    try {
      const authToken = cookieUtils.get("auth_token");
      if (!authToken) {
        setLoadingThreads(false);
        return;
      }

      const response = await fetch(getBotApiUrl("/chats"), {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("fetchThreads: Error response", errorText);
        throw new Error("Failed to fetch threads");
      }

      const data = await response.json();
      // API returns flat array of chats
      const threadsData = Array.isArray(data) ? data : data.chats || [];
      setThreads(threadsData);
    } catch (error) {
      console.error("Failed to fetch threads:", error);
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  // Fetch threads when auth token is available (on mount and when auth state changes)
  useEffect(() => {
    const authToken = cookieUtils.get("auth_token");
    if (authToken) {
      fetchThreads();
    }
  }, [isAuthenticated, fetchThreads]);

  // Load chat from URL path (/chat/{id}) or sessionStorage
  useEffect(() => {
    const authToken = cookieUtils.get("auth_token");
    if (!authToken || loadingThreads) return;

    // Check URL path for chat ID (handles direct navigation to /chat/{id})
    const pathMatch = pathname.match(/^\/chat\/([^/]+)/);
    const chatIdFromUrl = pathMatch?.[1];

    // Also check sessionStorage (for redirects from /chat/[id] route)
    const chatIdFromStorage = sessionStorage.getItem("hypercli_load_chat_id");
    if (chatIdFromStorage) {
      sessionStorage.removeItem("hypercli_load_chat_id");
    }

    const chatIdToLoad = chatIdFromUrl || chatIdFromStorage;
    if (chatIdToLoad && chatIdToLoad !== currentThreadId) {
      // Check if this is a handover (has pending auto-send message)
      // If so, skip fetching messages - handleSendMessage will manage them
      const hasPendingAutoSend = !!sessionStorage.getItem("hypercli_autosend_message");
      // Select the thread and update URL if not already there
      selectThread(chatIdToLoad, !chatIdFromUrl, hasPendingAutoSend);
    }
  }, [loadingThreads, pathname, currentThreadId]);

  // Auto-select most recent thread when threads load (if no thread is selected)
  useEffect(() => {
    if (!loadingThreads && threads.length > 0 && !currentThreadId && (pathname === '/' || pathname === '/chat') && !autoSelectedThreadRef.current) {
      // Select the most recent thread (first in the list) without updating URL
      autoSelectedThreadRef.current = true;
      selectThread(threads[0].id, false, false);
    }
  }, [loadingThreads, threads, currentThreadId, pathname]);

  // Auto-create free user if not authenticated
  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    // Prevent multiple free user creation calls (race condition guard)
    if (creatingFreeUserRef.current) return;
    // Prevent reload loops — if we already tried creating a free user recently, don't retry
    const lastAttempt = localStorage.getItem("hypercli_free_user_created_at");
    if (lastAttempt && Date.now() - parseInt(lastAttempt, 10) < 30_000) return;
    creatingFreeUserRef.current = true;

    const createFreeUser = async () => {
      try {
        localStorage.setItem("hypercli_free_user_created_at", String(Date.now()));
        const response = await fetch(getAuthBackendUrl("/auth/free"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!response.ok) throw new Error("Failed to create free user");

        const data = await response.json();
        // Store JWT token in cookie (uses cookieUtils for proper domain handling)
        cookieUtils.setWithMaxAge("auth_token", data.token, data.expires_in);
        // Mark as free user (not wallet)
        localStorage.setItem("hypercli_login_type", "free");
        // Reload to trigger auth
        window.location.reload();
      } catch (e) {
        console.error("Failed to create free user:", e);
        creatingFreeUserRef.current = false;
      }
    };

    createFreeUser();
  }, [isLoading, isAuthenticated]);

  // Fetch models
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const authToken = cookieUtils.get("auth_token");

        if (!authToken) {
          setLoadingModels(false);
          return;
        }

        const response = await fetch(getLlmApiUrl("/models"), {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });

        if (!response.ok) throw new Error("Failed to fetch models");

        const data = await response.json();
        const allModels = data.data || [];
        console.log("[Chat] Available models from API:", allModels.map((m: Model) => m.id));
        // Filter out embedding models (they can't be used for chat)
        let chatModels = allModels.filter(
          (m: Model) => !m.id.toLowerCase().includes("embed")
        );
        
        // Check for model override in URL (e.g., ?model=google/gemma-3-1b-it:free)
        const modelOverride = searchParams.get("model");
        if (modelOverride) {
          console.log("[Chat] Model override from URL:", modelOverride);
          // Add the override model if not already in the list
          if (!chatModels.find((m: Model) => m.id === modelOverride)) {
            chatModels = [
              { id: modelOverride, object: "model", created: Date.now(), owned_by: "override" },
              ...chatModels,
            ];
          }
          setModels(chatModels);
          setSelectedModel(modelOverride);
          localStorage.setItem("hypercli_chat_model", modelOverride);
          setLoadingModels(false);
          return;
        }
        
        setModels(chatModels);

        if (chatModels.length > 0) {
          const savedModel = localStorage.getItem("hypercli_chat_model");
          if (savedModel && chatModels.find((m: Model) => m.id === savedModel)) {
            setSelectedModel(savedModel);
          } else {
            // Use default model from env, or fall back to first model
            const defaultModel = process.env.NEXT_PUBLIC_DEFAULT_MODEL;
            if (defaultModel && chatModels.find((m: Model) => m.id === defaultModel)) {
              setSelectedModel(defaultModel);
            } else {
              setSelectedModel(chatModels[0].id);
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch models:", error);
      } finally {
        setLoadingModels(false);
      }
    };

    const authToken = cookieUtils.get("auth_token");
    if (authToken) {
      fetchModels();
    }
  }, [isAuthenticated, searchParams]);

  // Fetch balance
  const fetchBalance = async () => {
    try {
      const authToken = cookieUtils.get("auth_token");

      if (!authToken) return;

      const response = await fetch(getAuthBackendUrl("/balance"), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        console.log("[Chat] Balance fetched:", data);
        setBalance(data);
      } else {
        console.log("[Chat] Balance fetch failed:", response.status, await response.text());
      }
    } catch (error) {
      console.error("Error fetching balance:", error);
    }
  };

  useEffect(() => {
    const authToken = cookieUtils.get("auth_token");
    if (authToken) {
      fetchBalance();
    }
  }, [isAuthenticated]);

  // Persistent WebSocket connection management
  const connectWebSocket = useCallback(() => {
    const authToken = cookieUtils.get("auth_token");
    if (!authToken || wsRef.current?.readyState === WebSocket.OPEN) return;

    // Clear any pending reconnect
    if (wsReconnectTimeoutRef.current) {
      clearTimeout(wsReconnectTimeoutRef.current);
      wsReconnectTimeoutRef.current = null;
    }

    const wsBase = getBotWsBase();
    if (!wsBase) return;
    const ws = new WebSocket(`${wsBase}/stream?token=${authToken}`);

    ws.onopen = () => {
      console.log("[WS] Connected to stream");
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[Chat WS] Received message:", { type: data.type, hasContent: !!data.content, contentLength: data.content?.length, error: data.error, usingGemini: usingGeminiRef.current });

        if (data.type === "state" || data.type === "token") {
          // IGNORE LLM streaming events when using Gemini
          // The bot API may auto-trigger OpenRouter responses, but we don't want them
          if (usingGeminiRef.current) {
            console.log("[Chat WS] Ignoring LLM streaming - using Gemini");
            return;
          }
          
          // Update the last assistant message with streamed content
          console.log("[Chat WS] State/token update, content:", JSON.stringify(data.content?.substring(0, 100)));
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg.role === "assistant") {
              newMessages[newMessages.length - 1] = {
                ...lastMsg,
                content: data.content || "",
              };
            }
            return newMessages;
          });

          // Resolve pending subscribe if this is the initial state
          if (data.type === "state" && pendingSubscribeRef.current) {
            pendingSubscribeRef.current.resolve();
            pendingSubscribeRef.current = null;
          }
        } else if (data.type === "tool_result") {
          const renderMeta = extractRenderMetaFromResult(data.result);
          if (renderMeta) {
            setMessages((prev) => {
              // Check if there's a pending selection (user hasn't clicked "run" yet)
              const hasPendingSelection = prev.some(
                msg => msg.type === "selection" && msg.role === "assistant"
              );
              
              // If there's a pending selection, don't create the render yet
              // It will be created after the user confirms
              if (hasPendingSelection) {
                console.log('[WebSocket] Render received but selection pending, skipping for now');
                return prev;
              }
              
              // Check if this render already exists
              const existingRenderIndex = prev.findIndex(
                msg => msg.meta?.render?.render_id === renderMeta.render_id
              );
              
              if (existingRenderIndex !== -1) {
                // Update existing render
                const newMessages = [...prev];
                newMessages[existingRenderIndex] = {
                  ...newMessages[existingRenderIndex],
                  meta: {
                    ...newMessages[existingRenderIndex].meta,
                    render: renderMeta,
                  },
                };
                return newMessages;
              }
              
              // Create new render message at the end
              return [
                ...prev,
                {
                  id: `render-${renderMeta.render_id}`,
                  role: "assistant",
                  content: "",
                  type: "render",
                  meta: { render: renderMeta },
                  created_at: new Date().toISOString(),
                },
              ];
            });
          }
        } else if (data.type === "selection") {
          // IGNORE selection events from bot API LLM when using Gemini
          if (usingGeminiRef.current) {
            console.log("[Chat WS] Ignoring selection event - using Gemini");
            return;
          }
          
          setIsStreaming(false);
          setMessages((prev) => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg?.role === "assistant" && !lastMsg.content && !lastMsg.meta?.render) {
              newMessages.pop();
            }
            if (newMessages.some((msg) => msg.id === data.message_id)) {
              return newMessages;
            }
            return [
              ...newMessages,
              {
                id: data.message_id,
                role: "assistant",
                content: data.content || "",
                type: "selection",
                meta: { options: data.options || [] },
                status: "complete",
                created_at: new Date().toISOString(),
              },
            ];
          });
        } else if (data.type === "done") {
          // IGNORE done events from bot API LLM when using Gemini
          if (usingGeminiRef.current) {
            console.log("[Chat WS] Ignoring done event - using Gemini");
            return;
          }
          
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg.role === "assistant") {
              newMessages[newMessages.length - 1] = {
                ...lastMsg,
                content: data.content || "",
              };
            }
            return newMessages;
          });
          setIsStreaming(false);

          // Refresh messages and threads after streaming completes
          const authToken = cookieUtils.get("auth_token");
          const threadId = currentThreadIdRef.current;
          if (authToken && threadId) {
            // Refresh messages to get real IDs
            fetch(getBotApiUrl(`/chats/${threadId}/messages`), {
              headers: { Authorization: `Bearer ${authToken}` },
            })
              .then((res) => res.json())
              .then((serverMessages) => {
                setMessages(Array.isArray(serverMessages) ? serverMessages : serverMessages.messages || []);
              })
              .catch((err) => console.error("Failed to refresh messages:", err));

            // Refresh threads to update titles
            fetchThreads();

            // Refresh balance
            fetchBalance();
          }
        } else if (data.type === "error") {
          // IGNORE error events from bot API LLM when using Gemini
          if (usingGeminiRef.current) {
            console.log("[Chat WS] Ignoring error event - using Gemini:", data.error);
            return;
          }
          
          console.error("[Chat WS] Stream error - FULL DATA:", JSON.stringify(data, null, 2));
          // Parse error for user-friendly display
          const errorMsg = data.error || "An unexpected error occurred";
          let userFriendlyError = errorMsg;
          if (errorMsg.includes("402") || errorMsg.toLowerCase().includes("insufficient") || errorMsg.toLowerCase().includes("credit")) {
            userFriendlyError = "Insufficient credits. Please top up your balance or select a free model.";
          } else if (errorMsg.toLowerCase().includes("rate limit")) {
            userFriendlyError = "Rate limit exceeded. Please wait a moment and try again.";
          } else if (errorMsg.toLowerCase().includes("context") && errorMsg.toLowerCase().includes("length")) {
            userFriendlyError = "Message too long. Please try a shorter message.";
          }
          console.log("[Chat WS] Original error:", errorMsg);
          console.log("[Chat WS] User-friendly error:", userFriendlyError);
          // Update the last assistant message with error content
          setMessages((prev) => {
            console.log("[Chat WS] Error handler - messages count:", prev.length, "last msg role:", prev[prev.length - 1]?.role);
            if (prev.length === 0) return prev;
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg.role === "assistant") {
              newMessages[newMessages.length - 1] = {
                ...lastMsg,
                content: "__ERROR__" + userFriendlyError,
                error: userFriendlyError,
                status: "error",
              };
              console.log("[Chat WS] Updated assistant message with error");
            }
            return newMessages;
          });
          if (pendingSubscribeRef.current) {
            pendingSubscribeRef.current.reject(new Error(data.error));
            pendingSubscribeRef.current = null;
          }
          setIsStreaming(false);
        } else if (data.type === "pong") {
          // Heartbeat response
        }
      } catch (err) {
        console.error("[WS] Failed to parse message:", err);
      }
    };

    ws.onerror = (error) => {
      // Only log errors if we're in a connected state (not during normal close/reconnect)
      if (wsRef.current === ws) {
        console.error("[WS] Connection error:", error.type);
      }
      setWsConnected(false);
    };

    ws.onclose = (event) => {
      // Only log if it wasn't a clean close or if there was an error
      if (!event.wasClean && event.code !== 1000) {
        console.log("[WS] Connection closed unexpectedly", {
          code: event.code,
          reason: event.reason || "No reason provided",
        });
      }
      setWsConnected(false);
      
      // Only clear if this is still the current websocket
      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      // Reconnect after 2 seconds only if authenticated and not manually closed
      if (event.code !== 1000) {
        wsReconnectTimeoutRef.current = setTimeout(() => {
          if (isAuthenticated) {
            connectWebSocket();
          }
        }, 2000);
      }
    };

    wsRef.current = ws;
  }, [isAuthenticated]);

  const waitForWebSocketOpen = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      connectWebSocket();

      const startTime = Date.now();
      const interval = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          clearInterval(interval);
          resolve();
          return;
        }

        if (Date.now() - startTime > 5000) {
          clearInterval(interval);
          reject(new Error("WebSocket not connected"));
        }
      }, 100);
    });
  }, [connectWebSocket]);

  const updateRenderMeta = useCallback((renderId: string, patch: Partial<RenderMeta>) => {
    setMessages((prev) => {
      const newMessages = prev.map((msg) => {
        if (msg.meta?.render?.render_id !== renderId) return msg;
        
        // Log status change for user feedback
        const oldState = msg.meta?.render?.state;
        const newState = patch.state;
        if (oldState !== newState && newState) {
          const statusMessages: Record<string, string> = {
            queued: "Render queued in the system",
            running: "Render is now processing",
            processing: "Render in progress",
            success: "Render completed successfully",
            failed: "Render failed",
            cancelled: "Render cancelled",
          };
          const message = statusMessages[newState.toLowerCase()] || `Status: ${newState}`;
          console.log(`[Render ${renderId.slice(0, 8)}] ${message}`);
        }
        
        return {
          ...msg,
          meta: {
            ...msg.meta,
            render: {
              ...msg.meta.render,
              ...patch,
            },
          },
        };
      });
      
      // Persist to localStorage if we have a current thread
      // This ensures cancelled/completed states survive page refresh
      const threadId = currentThreadIdRef.current;
      if (threadId) {
        saveMessagesToStorage(threadId, newMessages);
      }
      
      return newMessages;
    });
  }, []);

  const upsertRenderFromNotification = useCallback((notification: RenderNotification) => {
    setMessages((prev) => {
      const nextState = notification.status || "queued";
      const renderId = notification.render_id;
      const existingIndex = prev.findIndex((msg) => msg.meta?.render?.render_id === renderId);
      const renderPatch: RenderMeta = {
        render_id: renderId,
        state: nextState,
        result_url: notification.result_url || null,
        error: notification.error || null,
      };

      if (existingIndex !== -1) {
        const existing = prev[existingIndex];
        const updated = {
          ...existing,
          meta: {
            ...existing.meta,
            render: {
              ...existing.meta?.render,
              ...renderPatch,
            },
          },
        };
        const next = [...prev];
        next[existingIndex] = updated;
        return next;
      }

      return [
        ...prev,
        {
          id: `render-${renderId}`,
          role: "assistant",
          content: "",
          type: "render",
          meta: { render: renderPatch },
          created_at: new Date().toISOString(),
        },
      ];
    });
  }, []);

  const stopRenderPolling = useCallback((renderId: string) => {
    const interval = renderPollersRef.current.get(renderId);
    if (interval) {
      clearInterval(interval);
      renderPollersRef.current.delete(renderId);
    }
    delete renderPollAttemptsRef.current[renderId];
    delete renderPollStartTimeRef.current[renderId];
  }, []);

  const startRenderPolling = useCallback(
    (renderId: string) => {
      if (!isAuthenticated || renderPollersRef.current.has(renderId)) return;

      // Track when we started polling
      renderPollStartTimeRef.current[renderId] = Date.now();

      const poll = async () => {
        const authToken = cookieUtils.get("auth_token");
        if (!authToken) {
          stopRenderPolling(renderId);
          return;
        }

        // Check for timeout
        const startTime = renderPollStartTimeRef.current[renderId];
        if (startTime && Date.now() - startTime > RENDER_POLL_TIMEOUT_MS) {
          console.warn(`[Polling] Render ${renderId.slice(0, 8)} timed out after 5 minutes`);
          updateRenderMeta(renderId, {
            state: "failed",
            error: "Render timed out. It may still complete - check your render history.",
          });
          stopRenderPolling(renderId);
          return;
        }

        try {
          // Use local API route to avoid CORS issues
          const response = await fetch(`/api/renders/${renderId}/status`, {
            headers: { Authorization: `Bearer ${authToken}` },
          });

          if (!response.ok) {
            if (response.status === 404) {
              // 404 might mean render not ready yet, allow more retries
              const attempts = (renderPollAttemptsRef.current[renderId] || 0) + 1;
              renderPollAttemptsRef.current[renderId] = attempts;
              console.log(`[Polling] Render ${renderId.slice(0, 8)} not found (${attempts}/10)`);
              if (attempts >= 10) {
                console.warn(`[Polling] Render ${renderId.slice(0, 8)} not found after 10 attempts, marking as not found`);
                // Update render to show it wasn't found
                updateRenderMeta(renderId, {
                  state: "failed",
                  error: "Render not found in system. It may have been cancelled or expired.",
                });
                stopRenderPolling(renderId);
              }
            } else if (response.status === 401) {
              // Auth error, stop polling
              console.error(`[Polling] Auth error for render ${renderId.slice(0, 8)}`);
              stopRenderPolling(renderId);
            }
            return;
          }

          // Reset attempt counter on successful response
          renderPollAttemptsRef.current[renderId] = 0;

          const data = await response.json();
          console.log(`[Polling] Render ${renderId.slice(0, 8)} response:`, data);
          if (data && typeof data === "object") {
            const nextState = data.status || data.state || null;
            const patch: Partial<RenderMeta> = {
              state: nextState,
              result_url: data.result_url || null,
              error: data.error || null,
            };
            
            // Only update template if it exists in the response
            if (data.template) {
              patch.template = data.template;
            }
            
            // Also check for template in other possible locations
            if (!patch.template && data.params?.template) {
              patch.template = data.params.template;
            }
            if (!patch.template && data.meta?.template) {
              patch.template = data.meta.template;
            }
            
            updateRenderMeta(renderId, patch);

            if (nextState && ["success", "completed", "complete", "failed", "cancelled"].includes(nextState.toLowerCase())) {
              console.log(`[Polling] Render ${renderId.slice(0, 8)} finished with status: ${nextState}`);
              stopRenderPolling(renderId);
            }
          }
        } catch (error) {
          const attempts = (renderPollAttemptsRef.current[renderId] || 0) + 1;
          renderPollAttemptsRef.current[renderId] = attempts;
          console.error(`[Polling] Error polling render ${renderId.slice(0, 8)} (${attempts}/5):`, error);
          if (attempts >= 5) {
            console.error(`[Polling] Too many errors for render ${renderId.slice(0, 8)}, stopping`);
            stopRenderPolling(renderId);
          }
        }
      };

      const interval = setInterval(poll, 4000);
      renderPollersRef.current.set(renderId, interval);
      console.log(`[Polling] Started polling for render ${renderId.slice(0, 8)}`);
      void poll();
    },
    [isAuthenticated, stopRenderPolling, updateRenderMeta],
  );

  // Cancel a render
  const cancelRender = useCallback(async (renderId: string) => {
    const authToken = cookieUtils.get("auth_token");
    if (!authToken) return;

    console.log(`[Cancel] Cancelling render ${renderId.slice(0, 8)}`);
    
    try {
      const response = await fetch(`/api/renders/${renderId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });

      // Stop polling regardless of API response
      stopRenderPolling(renderId);

      // Update the render state to cancelled
      updateRenderMeta(renderId, {
        state: "cancelled",
        error: null,
      });

      if (!response.ok) {
        console.warn(`[Cancel] API returned ${response.status}, but render marked as cancelled locally`);
      } else {
        console.log(`[Cancel] Render ${renderId.slice(0, 8)} cancelled successfully`);
      }
    } catch (error) {
      console.error(`[Cancel] Error cancelling render ${renderId.slice(0, 8)}:`, error);
      // Still mark as cancelled locally
      stopRenderPolling(renderId);
      updateRenderMeta(renderId, {
        state: "cancelled",
        error: "Cancellation requested",
      });
    }
  }, [stopRenderPolling, updateRenderMeta]);

  // Connect WebSocket when authenticated
  useEffect(() => {
    const authToken = cookieUtils.get("auth_token");
    if (authToken) {
      connectWebSocket();
    }

    return () => {
      // Cleanup on unmount
      if (wsReconnectTimeoutRef.current) {
        clearTimeout(wsReconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      // Stop all render polling
      renderPollersRef.current.forEach((interval, renderId) => {
        clearInterval(interval);
        console.log(`[Polling] Cleanup: stopped polling for ${renderId.slice(0, 8)}`);
      });
      renderPollersRef.current.clear();
    };
  }, [isAuthenticated, connectWebSocket]);

  // Parse renders from message text content and store in meta
  useEffect(() => {
    setMessages((prev) => {
      let updated = false;
      const newMessages = prev.map((msg) => {
        // Skip if already has render in meta or not assistant message
        if (msg.role !== "assistant" || msg.meta?.render) return msg;
        
        // Try to parse render from content
        const parsed = parseRenderFromText(msg.content);
        if (parsed?.render) {
          console.log(`[Parsing] Found render ${parsed.render.render_id.slice(0, 8)} in message text`);
          updated = true;
          return {
            ...msg,
            meta: {
              ...msg.meta,
              render: parsed.render,
            },
          };
        }
        
        return msg;
      });
      
      return updated ? newMessages : prev;
    });
  }, [messages.length]); // Only run when message count changes

  useEffect(() => {
    if (!isAuthenticated) return;

    for (const msg of messages) {
      const renderId = msg.meta?.render?.render_id;
      const state = msg.meta?.render?.state;
      if (!renderId) continue;
      
      if (state && ["success", "completed", "complete", "failed", "cancelled", "error"].includes(state.toLowerCase())) {
        stopRenderPolling(renderId);
        continue;
      }
      
      startRenderPolling(renderId);
    }
  }, [messages, isAuthenticated, startRenderPolling, stopRenderPolling]);

  useEffect(() => {
    return () => {
      for (const [, interval] of renderPollersRef.current) {
        clearInterval(interval);
      }
      renderPollersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    const pollNotifications = async () => {
      const authToken = cookieUtils.get("auth_token");
      if (!authToken) return;

      try {
        const response = await fetch(getBotApiUrl("/renders/notifications"), {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        if (!response.ok) return;

        const notifications = await response.json();
        if (!Array.isArray(notifications) || notifications.length === 0) return;

        const ids: number[] = [];
        for (const notification of notifications as RenderNotification[]) {
          if (!notification?.render_id) continue;
          ids.push(notification.id);
          upsertRenderFromNotification(notification);
        }

        if (ids.length > 0) {
          await fetch(getBotApiUrl("/renders/notifications/read"), {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(ids),
          });
        }
      } catch (error) {
        console.error("Failed to poll render notifications:", error);
      }
    };

    renderNotificationPollerRef.current = setInterval(pollNotifications, 5000);
    void pollNotifications();

    return () => {
      if (renderNotificationPollerRef.current) {
        clearInterval(renderNotificationPollerRef.current);
        renderNotificationPollerRef.current = null;
      }
    };
  }, [isAuthenticated, upsertRenderFromNotification]);

  // Subscribe to a message stream
  const subscribeToMessage = useCallback(
    async (messageId: number): Promise<void> => {
      await waitForWebSocketOpen();

      return new Promise((resolve, reject) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          reject(new Error("WebSocket not connected"));
          return;
        }

        pendingSubscribeRef.current = { messageId, resolve, reject };
        wsRef.current.send(JSON.stringify({ type: "subscribe", message_id: messageId }));

        // Timeout after 10 seconds
        setTimeout(() => {
          if (pendingSubscribeRef.current?.messageId === messageId) {
            pendingSubscribeRef.current.reject(new Error("Subscribe timeout"));
            pendingSubscribeRef.current = null;
          }
        }, 10000);
      });
    },
    [waitForWebSocketOpen],
  );

  // Handle initial message from URL param - auto-create free user if needed
  // For /chat/<id>?message=, this will auto-send after navigation completes
  useEffect(() => {
    if (initialMessageSent || isLoading) return;

    const encodedMessage = searchParams.get("message");
    if (!encodedMessage) return;

    let decodedMessage: string;
    try {
      decodedMessage = atob(encodedMessage);
      if (!decodedMessage.trim()) return;
    } catch (e) {
      console.error("Failed to decode message:", e);
      return;
    }

    // Check if we're on a specific chat page (handover from new chat creation)
    const pathMatch = pathname.match(/^\/chat\/([^/]+)/);
    const isOnChatPage = !!pathMatch;

    if (isOnChatPage) {
      // Store for auto-send (will be picked up by the auto-send effect below)
      sessionStorage.setItem("hypercli_autosend_message", decodedMessage);
      // Clear URL param but stay on chat page
      router.replace(pathname, { scroll: false });
    } else {
      // On root page - store for pre-fill (existing behavior)
      localStorage.setItem("hypercli_pending_chat_message", decodedMessage);

      // If not authenticated, create a free user
      if (!isAuthenticated) {
        // Prevent multiple free user creation calls (race condition guard)
        if (creatingFreeUserRef.current) return;
        const lastAttempt = localStorage.getItem("hypercli_free_user_created_at");
        if (lastAttempt && Date.now() - parseInt(lastAttempt, 10) < 30_000) return;
        creatingFreeUserRef.current = true;

        const createFreeUser = async () => {
          try {
            localStorage.setItem("hypercli_free_user_created_at", String(Date.now()));
            const response = await fetch(getAuthBackendUrl("/auth/free"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            });

            if (!response.ok) throw new Error("Failed to create free user");

            const data = await response.json();
            // Store JWT token in cookie (uses cookieUtils for proper domain handling)
            cookieUtils.setWithMaxAge("auth_token", data.token, data.expires_in);
            // Mark as free user (not wallet)
            localStorage.setItem("hypercli_login_type", "free");
            // Clear URL param and reload to trigger auth
            router.replace("/");
            window.location.reload();
          } catch (e) {
            console.error("Failed to create free user:", e);
            // Fall back to showing login
            localStorage.removeItem("hypercli_pending_chat_message");
            creatingFreeUserRef.current = false;
          }
        };
        createFreeUser();
      } else {
        // Already authenticated, clear URL param
        router.replace("/");
      }
    }
  }, [searchParams, initialMessageSent, isLoading, isAuthenticated, router, pathname]);

  // Load pending message once authenticated and ready (pre-fill for root page)
  useEffect(() => {
    if (!isAuthenticated || loadingModels || !selectedModel || initialMessageSent) return;

    const pendingMsg = localStorage.getItem("hypercli_pending_chat_message");
    if (pendingMsg) {
      localStorage.removeItem("hypercli_pending_chat_message");
      setInitialMessageSent(true);
      setPendingMessage(pendingMsg);
    }
  }, [isAuthenticated, loadingModels, selectedModel, initialMessageSent]);

  // Auto-send message for chat page handover
  // This fires when we navigate to /chat/<id>?message= and the message is stored in sessionStorage
  useEffect(() => {
    if (!isAuthenticated || loadingModels || !selectedModel || isStreaming || !currentThreadId) return;

    const autoSendMsg = sessionStorage.getItem("hypercli_autosend_message");
    if (autoSendMsg) {
      sessionStorage.removeItem("hypercli_autosend_message");
      setInitialMessageSent(true);
      // Trigger the send with the existing thread
      handleSendMessage(autoSendMsg);
    }
  }, [isAuthenticated, loadingModels, selectedModel, isStreaming, currentThreadId]);

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    localStorage.setItem("hypercli_chat_model", modelId);
  };

  const toggleTheme = () => {
    const newTheme = toggleThemeUtil();
    setTheme(newTheme);
  };

  const startNewThread = () => {
    // Just clear current thread - a new one will be created on first message
    setCurrentThreadId(null);
    setMessages([]);
    // Go to root URL for new chat
    router.push("/", { scroll: false });
  };

  const fetchThreadMessages = async (threadId: string, clearFirst = false) => {
    if (clearFirst) {
      setMessages([]);
    }

    // First, try to load from localStorage (this is where Gemini messages are stored)
    const localMessages = loadMessagesFromStorage(threadId);
    if (localMessages.length > 0) {
      console.log("[Chat] Loaded", localMessages.length, "messages from localStorage for thread:", threadId);
      setMessages(localMessages);
      return; // Use local messages, skip bot API fetch
    }

    // Fall back to bot API (for legacy threads or if localStorage was cleared)
    try {
      const authToken = cookieUtils.get("auth_token");
      if (!authToken) return;

      const response = await fetch(
        getBotApiUrl(`/chats/${threadId}/messages`),
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      if (!response.ok) throw new Error("Failed to fetch messages");

      const data = await response.json();
      const serverMessages = Array.isArray(data) ? data : data.messages || [];
      
      // Merge with existing messages to preserve and update render states
      setMessages((prev) => {
        // If clearFirst was true, we already cleared, so just use server messages
        if (clearFirst) return serverMessages;
        
        // Build a map of existing renders by render_id
        const existingRenderStates = new Map<string, RenderMeta>();
        prev.forEach(msg => {
          const renderId = msg.meta?.render?.render_id;
          if (renderId && msg.meta?.render) {
            existingRenderStates.set(renderId, msg.meta.render);
          }
        });
        
        // Update server messages with any existing render states we have
        const updatedServerMessages = serverMessages.map((serverMsg: Message) => {
          const serverRenderId = serverMsg.meta?.render?.render_id;
          if (serverRenderId && existingRenderStates.has(serverRenderId)) {
            const existingRenderState = existingRenderStates.get(serverRenderId)!;
            // Keep the server's data but preserve template and other fields if server doesn't have them
            return {
              ...serverMsg,
              meta: {
                ...serverMsg.meta,
                render: {
                  ...existingRenderState,
                  ...serverMsg.meta?.render,
                  // Preserve template if server doesn't provide it
                  template: serverMsg.meta?.render?.template || existingRenderState.template,
                },
              },
            };
          }
          return serverMsg;
        });
        
        return updatedServerMessages;
      });
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    }
  };

  const selectThread = async (threadId: string, updateUrl = true, skipFetch = false) => {
    setCurrentThreadId(threadId);

    // Update URL to /chat/{id}
    if (updateUrl) {
      router.push(`/chat/${threadId}`, { scroll: false });
    }

    // Skip fetch if we're doing a handover (auto-send will manage messages)
    if (skipFetch) return;
    fetchThreadMessages(threadId, true);
  };

  const deleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      const authToken = cookieUtils.get("auth_token");
      if (!authToken) return;

      const response = await fetch(
        getBotApiUrl(`/chats/${threadId}`),
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );

      if (!response.ok) throw new Error("Failed to delete thread");

      // Clean up localStorage for this thread
      deleteMessagesFromStorage(threadId);

      setThreads((prev) => prev.filter((t) => t.id !== threadId));

      if (currentThreadId === threadId) {
        setCurrentThreadId(null);
        setMessages([]);
        router.push("/", { scroll: false });
      }
    } catch (error) {
      console.error("Failed to delete thread:", error);
    }
  };

  const clearAllChats = async () => {
    if (!confirm("Are you sure you want to delete all chats? This cannot be undone.")) {
      return;
    }

    try {
      const authToken = cookieUtils.get("auth_token");
      if (!authToken) return;

      // Delete all threads one by one
      const deletePromises = threads.map((thread) =>
        fetch(getBotApiUrl(`/chats/${thread.id}`), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${authToken}` },
        })
      );

      await Promise.all(deletePromises);

      // Clear all messages from localStorage
      clearAllMessagesFromStorage();

      // Clear local state atomically to avoid screen flash
      setCurrentThreadId(null);
      setMessages([]);
      setThreads([]);
      
      // Update URL without triggering a full navigation
      window.history.replaceState(null, '', '/');
    } catch (error) {
      console.error("Failed to clear all chats:", error);
    }
  };

  const handleSendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || isStreaming) return;

    // Clear pending message if it was used
    if (pendingMessage) {
      setPendingMessage("");
    }

    const authToken = cookieUtils.get("auth_token");
    if (!authToken) return;

    setIsStreaming(true);
    
    // Mark that we're using Gemini - ignore ALL WebSocket LLM events
    usingGeminiRef.current = true;
    
    // Generate unique IDs for temp messages to avoid React key collisions
    const tempId = Date.now();
    
    // Add optimistic user message (local only - no API call yet)
    const tempUserMsg: Message = {
      id: `temp-user-${tempId}`,
      role: "user",
      content: userMessage,
      type: "text",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    
    // Add empty assistant message for loading state
    const tempAssistantMsg: Message = {
      id: `temp-assistant-${tempId}`,
      role: "assistant",
      content: "",
      type: "text",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempAssistantMsg]);

    try {
      // Build messages array for chat completions
      // Get recent conversation history (last 10 messages for context)
      const recentMessages = messages.slice(-10).map(m => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content || "",
      })).filter(m => m.content && !m.content.startsWith("__ERROR__"));
      
      // Add the new user message
      const chatMessages = [
        ...recentMessages,
        { role: "user" as const, content: userMessage }
      ];
      
      // Use Gemini-powered chat API with HyperCLI tools
      // This is FREE (Gemini free tier) and supports tool calling for renders
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          messages: chatMessages,
          execute_tools: true, // Auto-execute tools like image/video generation
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || errorData.detail || `Error ${response.status}`);
      }

      const data = await response.json();
      
      // Check if there were tool calls (renders)
      const toolResults = data.tool_results;
      const toolCalls = data.choices?.[0]?.message?.tool_calls || [];
      let renderMeta: RenderMeta | null = null;
      
      if (toolResults && toolResults.length > 0) {
        console.log("[Chat] Tool results:", toolResults);
        // Handle render results - extract render metadata for display
        for (const tr of toolResults) {
          if (tr.success && tr.result) {
            const result = tr.result;
            const renderId = result.id || result.render_id;
            if (renderId) {
              console.log("[Chat] Render created:", renderId);
              // Find the matching tool call to get the arguments
              const matchingCall = toolCalls.find((tc: { function?: { name: string } }) => 
                tc.function?.name === tr.tool
              );
              const args = matchingCall?.function?.arguments 
                ? JSON.parse(matchingCall.function.arguments) 
                : {};
              
              // Build render metadata with parameters
              renderMeta = {
                render_id: renderId,
                state: result.status || result.state || "queued",
                template: result.template || tr.tool,
                gpu_type: result.gpu_type || null,
                render_type: tr.tool === "text_to_video" || tr.tool === "image_to_video" ? "video" : "image",
                width: args.width || result.width || (tr.tool === "text_to_video" ? 640 : 1024),
                height: args.height || result.height || (tr.tool === "text_to_video" ? 640 : 1024),
                prompt: args.prompt || null,
                model: tr.tool === "text_to_image" ? "HiDream/Flux" : 
                       tr.tool === "text_to_video" ? "Wan 2.2" : 
                       tr.tool === "image_to_video" ? "Wan 2.2" : null,
              };
              
              // Start polling for render status
              startRenderPolling(renderId);
            }
          }
        }
      }
      
      const assistantContent = data.choices?.[0]?.message?.content || "";
      
      // Update the assistant message with the response and render metadata
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastMsg = newMessages[newMessages.length - 1];
        if (lastMsg.role === "assistant") {
          newMessages[newMessages.length - 1] = {
            ...lastMsg,
            content: assistantContent,
            meta: renderMeta ? { ...lastMsg.meta, render: renderMeta } : lastMsg.meta,
          };
        }
        return newMessages;
      });

      // NOW save to bot API - AFTER Gemini has fully responded
      // This is fire-and-forget, runs in background, doesn't block UI
      // Only create thread if we got a valid response
      if (assistantContent || renderMeta) {
        saveConversationToHistory(userMessage, assistantContent, authToken).catch(err => {
          console.error("[Chat] Background save failed:", err);
        });
      }

      console.log("[Chat] Response received, length:", assistantContent.length);
      setIsStreaming(false);
      usingGeminiRef.current = false; // Done with Gemini request
      fetchBalance(); // Refresh balance after completion
    } catch (error) {
      console.error("[Chat] Send error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to send message";
      console.log("[Chat] Setting error in catch block:", errorMessage);
      setMessages((prev) => {
        const newMessages = [...prev];
        if (newMessages.length > 0) {
          newMessages[newMessages.length - 1] = {
            ...newMessages[newMessages.length - 1],
            content: "__ERROR__" + errorMessage,
            error: errorMessage,
            status: "error",
          };
        }
        return newMessages;
      });
      setIsStreaming(false);
      usingGeminiRef.current = false; // Done with Gemini request (even on error)
    }
  };

  // Save conversation to bot API history - runs AFTER Gemini responds
  // This is completely async and doesn't interfere with the chat
  const saveConversationToHistory = async (userMessage: string, assistantContent: string, authToken: string) => {
    // Create thread if needed
    let threadId = currentThreadId;
    if (!threadId) {
      const createResponse = await fetch(getBotApiUrl("/chats"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          title: userMessage.slice(0, 50) + (userMessage.length > 50 ? "..." : ""),
        }),
      });
      
      if (!createResponse.ok) {
        console.error("[Chat] Failed to create thread for history");
        return;
      }
      
      const newThread = await createResponse.json();
      threadId = newThread.id;
      setCurrentThreadId(threadId);
      setThreads((prev) => [newThread, ...prev]);
      // Update URL without causing navigation flash
      window.history.replaceState(null, '', `/chat/${threadId}`);
    }
    
    // Save messages to localStorage (not bot API - that triggers OpenRouter)
    // This allows persistence across refreshes without incurring LLM costs
    // We need to capture threadId in a local variable to avoid closure issues
    const finalThreadId = threadId;
    if (finalThreadId) {
      setMessages((currentMessages) => {
        saveMessagesToStorage(finalThreadId, currentMessages);
        console.log("[Chat] Messages saved to localStorage for thread:", finalThreadId);
        return currentMessages;
      });
    }
  };

  const handleSelection = async (messageId: number, option: SelectionOption) => {
    if (!currentThreadId) return;
    const authToken = cookieUtils.get("auth_token");
    if (!authToken) return;

    const selectionKey = String(messageId);
    setSelectionStatus((prev) => ({ ...prev, [selectionKey]: "pending" }));

    try {
      const response = await fetch(
        getBotApiUrl(`/chats/${currentThreadId}/selection`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            message_id: messageId,
            selected_id: option.id,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || "Failed to submit selection");
      }

      setSelectionStatus((prev) => ({ ...prev, [selectionKey]: "complete" }));

      const responseMessage: Message = {
        id: `selection-response-${messageId}-${Date.now()}`,
        role: "user",
        content: option.label,
        type: "selection_response",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, responseMessage]);

      setTimeout(() => {
        const activeThreadId = currentThreadIdRef.current;
        if (activeThreadId) {
          fetchThreadMessages(activeThreadId);
        }
      }, 2000);
    } catch (error) {
      console.error("Selection error:", error);
      setSelectionStatus((prev) => {
        const next = { ...prev };
        delete next[selectionKey];
        return next;
      });
    }
  };

  const handleLogout = async () => {
    // Clear auth cookie
    cookieUtils.remove("auth_token");
    // Clear login type
    localStorage.removeItem("hypercli_login_type");
    // Call Turnkey logout
    if (logout) {
      await logout();
    }
    // Redirect to home
    window.location.href = "/";
  };

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-foreground text-xl">Loading...</div>
      </div>
    );
  }

  // Show loading while creating free user
  if (!isAuthenticated) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-foreground text-xl">Setting up your chat...</div>
      </div>
    );
  }

  return (
    <div className="flex overflow-hidden bg-background relative chat-shell" style={{ height: 'var(--app-height)' }}>
      {/* Backdrop (mobile only) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 transition-opacity md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed md:relative top-0 left-0 h-full w-72 z-50 flex-shrink-0">
          <ChatSidebar
            threads={threads}
            currentThreadId={currentThreadId}
            loadingThreads={loadingThreads}
            balance={balance}
            theme={theme}
            onSelectThread={selectThread}
            onDeleteThread={deleteThread}
            onNewThread={startNewThread}
            onToggleTheme={toggleTheme}
            onTopUp={() => setShowTopUpModal(true)}
            onLogout={handleLogout}
            onHideSidebar={() => setSidebarOpen(false)}
            onClearAllChats={clearAllChats}
          />
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 w-full overflow-hidden">
        <ChatHeader
          showSignIn={showSignInPrompt}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onShowLogin={() => setShowLoginModal(true)}
        />

        <ChatWindow
          messages={messages}
          isStreaming={isStreaming}
          onSelectOption={handleSelection}
          selectionStatus={selectionStatus}
          onSuggestedPromptClick={(prompt) => setPendingMessage(prompt)}
          onCancelRender={cancelRender}
        />

        <ChatInput
          onSendMessage={handleSendMessage}
          disabled={isStreaming}
          initialValue={pendingMessage}
        />
      </div>

      {/* Top Up Modal */}
      <TopUpModal
        isOpen={showTopUpModal}
        onClose={() => setShowTopUpModal(false)}
        onSuccess={() => {
          fetchBalance();
        }}
      />

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-2xl shadow-2xl p-8 max-w-md w-full relative border border-border">
            <button
              onClick={() => setShowLoginModal(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            <WalletAuth
              showTitle={true}
              title="Connect Wallet"
              description="Sign in with your wallet to save your chat history and top up your account"
              onEmailLoginClick={() => setShowLoginModal(false)}
              onAuthSuccess={(_, __, method) => {
                // Only wallet logins should be marked as wallet users.
                if (method === "wallet") {
                  localStorage.setItem("hypercli_login_type", "wallet");
                } else {
                  localStorage.removeItem("hypercli_login_type");
                }
                setShowLoginModal(false);
                window.location.reload();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-foreground text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <ChatPageContent />
    </Suspense>
  );
}
