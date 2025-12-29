"use client";

import React, { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useAuth, WalletAuth, cookieUtils, TopUpModal } from "@hypercli/shared-ui";
import { useTurnkey } from "@turnkey/react-wallet-kit";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChatSidebar, ChatWindow, ChatHeader, ChatInput } from "../components";
import { initViewportHeight } from "./viewport-height";

// Bot API types
interface Message {
  id: number | string; // API returns number, temp messages use string
  role: "user" | "assistant";
  content: string;
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Balance
  const [balance, setBalance] = useState<Balance | null>(null);

  // Track if user logged in via wallet (not just free tier)
  const [isWalletUser, setIsWalletUser] = useState(false);

  // Persistent WebSocket connection
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const pendingSubscribeRef = useRef<{ messageId: number; resolve: () => void; reject: (err: Error) => void } | null>(null);
  const currentThreadIdRef = useRef<string | null>(null);
  const creatingFreeUserRef = useRef(false);

  // Keep ref in sync with state for use in WebSocket callbacks
  useEffect(() => {
    currentThreadIdRef.current = currentThreadId;
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

  // Free user = authenticated but not via wallet
  const isFreeUser = isAuthenticated && !isWalletUser;

  // Load theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem("hypercli_chat_theme") as "light" | "dark" | null;
    if (savedTheme) {
      setTheme(savedTheme);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("hypercli_chat_theme", theme);
  }, [theme]);

  // Fetch threads from bot API
  const fetchThreads = async () => {
    try {
      const authToken = cookieUtils.get("auth_token");
      if (!authToken) {
        setLoadingThreads(false);
        return;
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BOT_API_URL}/chats`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!response.ok) throw new Error("Failed to fetch threads");

      const data = await response.json();
      // API returns flat array of chats
      setThreads(Array.isArray(data) ? data : data.chats || []);
    } catch (error) {
      console.error("Failed to fetch threads:", error);
    } finally {
      setLoadingThreads(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchThreads();
    }
  }, [isAuthenticated]);

  // Load chat from URL path (/chat/{id}) or sessionStorage
  useEffect(() => {
    if (!isAuthenticated || loadingThreads) return;

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
  }, [isAuthenticated, loadingThreads, pathname]);

  // Auto-create free user if not authenticated
  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    // Prevent multiple free user creation calls (race condition guard)
    if (creatingFreeUserRef.current) return;
    creatingFreeUserRef.current = true;

    const createFreeUser = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_AUTH_BACKEND}/auth/free`, {
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

        const response = await fetch(`${process.env.NEXT_PUBLIC_LLM_API_URL}/models`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });

        if (!response.ok) throw new Error("Failed to fetch models");

        const data = await response.json();
        const allModels = data.data || [];
        // Filter out embedding models (they can't be used for chat)
        const chatModels = allModels.filter(
          (m: Model) => !m.id.toLowerCase().includes("embed")
        );
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

    if (isAuthenticated) {
      fetchModels();
    }
  }, [isAuthenticated]);

  // Fetch balance
  const fetchBalance = async () => {
    try {
      const authToken = cookieUtils.get("auth_token");

      if (!authToken) return;

      const response = await fetch(`${process.env.NEXT_PUBLIC_AUTH_BACKEND}/balance`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        setBalance(data);
      }
    } catch (error) {
      console.error("Error fetching balance:", error);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
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

    const wsUrl = process.env.NEXT_PUBLIC_BOT_API_URL?.replace(/^http/, "ws");
    const ws = new WebSocket(`${wsUrl}/stream?token=${authToken}`);

    ws.onopen = () => {
      console.log("[WS] Connected to stream");
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "state" || data.type === "token") {
          // Update the last assistant message with streamed content
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
        } else if (data.type === "done") {
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
            fetch(`${process.env.NEXT_PUBLIC_BOT_API_URL}/chats/${threadId}/messages`, {
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
          console.error("[WS] Stream error:", data.error);
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
      console.error("[WS] Connection error:", error);
      setWsConnected(false);
    };

    ws.onclose = () => {
      console.log("[WS] Connection closed, scheduling reconnect");
      setWsConnected(false);
      wsRef.current = null;

      // Reconnect after 2 seconds
      wsReconnectTimeoutRef.current = setTimeout(() => {
        if (isAuthenticated) {
          connectWebSocket();
        }
      }, 2000);
    };

    wsRef.current = ws;
  }, [isAuthenticated]);

  // Connect WebSocket when authenticated
  useEffect(() => {
    if (isAuthenticated) {
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
    };
  }, [isAuthenticated, connectWebSocket]);

  // Subscribe to a message stream
  const subscribeToMessage = useCallback((messageId: number): Promise<void> => {
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
  }, []);

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
        creatingFreeUserRef.current = true;

        const createFreeUser = async () => {
          try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_AUTH_BACKEND}/auth/free`, {
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
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const startNewThread = () => {
    // Just clear current thread - a new one will be created on first message
    setCurrentThreadId(null);
    setMessages([]);
    // Go to root URL for new chat
    router.push("/", { scroll: false });
  };

  const selectThread = async (threadId: string, updateUrl = true, skipFetch = false) => {
    setCurrentThreadId(threadId);

    // Update URL to /chat/{id}
    if (updateUrl) {
      router.push(`/chat/${threadId}`, { scroll: false });
    }

    // Skip fetch if we're doing a handover (auto-send will manage messages)
    if (skipFetch) return;

    setMessages([]); // Clear while loading

    try {
      const authToken = cookieUtils.get("auth_token");
      if (!authToken) return;

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BOT_API_URL}/chats/${threadId}/messages`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      if (!response.ok) throw new Error("Failed to fetch messages");

      const data = await response.json();
      // API returns flat array of messages
      setMessages(Array.isArray(data) ? data : data.messages || []);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    }
  };

  const deleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      const authToken = cookieUtils.get("auth_token");
      if (!authToken) return;

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BOT_API_URL}/chats/${threadId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${authToken}` },
        }
      );

      if (!response.ok) throw new Error("Failed to delete thread");

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

  const handleSendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || isStreaming || !selectedModel) return;

    // Clear pending message if it was used
    if (pendingMessage) {
      setPendingMessage("");
    }

    const authToken = cookieUtils.get("auth_token");
    if (!authToken) return;

    setIsStreaming(true);

    // Add optimistic user message (will be replaced with real one from API)
    const tempUserMsg: Message = {
      id: "temp-user",
      role: "user",
      content: userMessage,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // Add empty assistant message for streaming
    const tempAssistantMsg: Message = {
      id: "temp-assistant",
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempAssistantMsg]);

    try {
      // Create thread if needed - use handover pattern for new chats
      let threadId = currentThreadId;
      if (!threadId) {
        const createRes = await fetch(`${process.env.NEXT_PUBLIC_BOT_API_URL}/chats`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ title: userMessage.substring(0, 50) }),
        });

        if (!createRes.ok) throw new Error("Failed to create thread");

        const newThread: Thread = await createRes.json();
        threadId = newThread.id;
        setThreads((prev) => [newThread, ...prev]);

        // Handover: navigate to chat page with message param
        // The auto-send effect will pick this up after navigation completes
        const encodedMessage = btoa(userMessage);
        router.push(`/chat/${threadId}?message=${encodedMessage}`, { scroll: false });

        // Reset streaming state since the handover will restart it
        setIsStreaming(false);
        setMessages([]);
        return;
      }

      // Send message via POST (returns message IDs)
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BOT_API_URL}/chats/${threadId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            content: userMessage,
            model: selectedModel,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Error ${response.status}`);
      }

      const { assistant_message_id } = await response.json();

      // Subscribe to message stream via persistent WebSocket
      // The message updates are handled by the global ws.onmessage handler
      // Streaming will continue in the background, and "done" handler will refresh messages
      try {
        await subscribeToMessage(assistant_message_id);
        // Subscription successful - streaming is now active
        // The WebSocket "done" handler will:
        // - Set isStreaming to false
        // - Refresh messages to get real IDs
        // - Refresh threads and balance
      } catch (subscribeError) {
        console.error("Failed to subscribe to message stream:", subscribeError);
        // Message was sent but we couldn't subscribe - show error and reset state
        setMessages((prev) => {
          const newMessages = [...prev];
          if (newMessages.length > 0) {
            newMessages[newMessages.length - 1] = {
              ...newMessages[newMessages.length - 1],
              content: "Error: Failed to connect to stream. Please refresh.",
            };
          }
          return newMessages;
        });
        setIsStreaming(false);
      }
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to send message";
      setMessages((prev) => {
        const newMessages = [...prev];
        if (newMessages.length > 0) {
          newMessages[newMessages.length - 1] = {
            ...newMessages[newMessages.length - 1],
            content: `Error: ${errorMessage}`,
          };
        }
        return newMessages;
      });
      setIsStreaming(false);
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
    <div className="flex overflow-hidden bg-background relative" style={{ height: 'var(--app-height)' }}>
      {/* Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Overlay */}
      <div
        className={`fixed top-0 left-0 h-full w-72 z-50 transform transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <ChatSidebar
          threads={threads}
          currentThreadId={currentThreadId}
          loadingThreads={loadingThreads}
          models={models}
          selectedModel={selectedModel}
          loadingModels={loadingModels}
          balance={balance}
          theme={theme}
          onSelectThread={selectThread}
          onDeleteThread={deleteThread}
          onNewThread={startNewThread}
          onSelectModel={handleModelChange}
          onToggleTheme={toggleTheme}
          onTopUp={() => setShowTopUpModal(true)}
          onLogout={handleLogout}
        />
      </div>

      {/* Main Chat Area */}
      <div 
        className="flex-1 flex flex-col min-w-0 w-full overflow-hidden"
        style={{
          // Adjust height when keyboard is visible to prevent content from being hidden
          height: 'calc(var(--app-height) + var(--keyboard-height))',
        }}
      >
        <ChatHeader
          selectedModel={selectedModel}
          loadingModels={loadingModels}
          isFreeUser={isFreeUser}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onShowLogin={() => setShowLoginModal(true)}
        />

        <ChatWindow messages={messages} isStreaming={isStreaming} />

        <ChatInput
          onSendMessage={handleSendMessage}
          disabled={isStreaming || !selectedModel}
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
              onAuthSuccess={() => {
                // Mark as wallet user (not free tier)
                localStorage.setItem("hypercli_login_type", "wallet");
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
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center bg-background">
          <div className="text-foreground text-xl">Loading...</div>
        </div>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
