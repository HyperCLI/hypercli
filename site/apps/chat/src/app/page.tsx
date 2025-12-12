"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useAuth, WalletAuth, cookieUtils, TopUpModal } from "@hypercli/shared-ui";
import { useTurnkey } from "@turnkey/react-wallet-kit";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatSidebar, ChatWindow, ChatHeader, ChatInput } from "../components";

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

  // Check login type from localStorage
  useEffect(() => {
    const loginType = localStorage.getItem("hypercli_login_type");
    setIsWalletUser(loginType === "wallet");
  }, [isAuthenticated]);

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

      const response = await fetch(`${process.env.NEXT_PUBLIC_BOT_API_URL}/threads`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      if (!response.ok) throw new Error("Failed to fetch threads");

      const data = await response.json();
      setThreads(data.threads || []);
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

  // Auto-create free user if not authenticated
  useEffect(() => {
    if (isLoading || isAuthenticated) return;

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

  // Handle initial message from URL param - auto-create free user if needed
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

    // Store message for later
    localStorage.setItem("hypercli_pending_chat_message", decodedMessage);

    // If not authenticated, create a free user
    if (!isAuthenticated) {
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
        }
      };
      createFreeUser();
    } else {
      // Already authenticated, clear URL param
      router.replace("/");
    }
  }, [searchParams, initialMessageSent, isLoading, isAuthenticated, router]);

  // Load pending message once authenticated and ready
  useEffect(() => {
    if (!isAuthenticated || loadingModels || !selectedModel || initialMessageSent) return;

    const pendingMsg = localStorage.getItem("hypercli_pending_chat_message");
    if (pendingMsg) {
      localStorage.removeItem("hypercli_pending_chat_message");
      setInitialMessageSent(true);
      setPendingMessage(pendingMsg);
    }
  }, [isAuthenticated, loadingModels, selectedModel, initialMessageSent]);

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
  };

  const selectThread = async (threadId: string) => {
    setCurrentThreadId(threadId);
    setMessages([]); // Clear while loading

    try {
      const authToken = cookieUtils.get("auth_token");
      if (!authToken) return;

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BOT_API_URL}/threads/${threadId}/messages`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );

      if (!response.ok) throw new Error("Failed to fetch messages");

      const data = await response.json();
      setMessages(data.messages || []);
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
        `${process.env.NEXT_PUBLIC_BOT_API_URL}/threads/${threadId}`,
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
      // Create thread if needed
      let threadId = currentThreadId;
      if (!threadId) {
        const createRes = await fetch(`${process.env.NEXT_PUBLIC_BOT_API_URL}/threads`, {
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
        setCurrentThreadId(threadId);
        setThreads((prev) => [newThread, ...prev]);
      }

      // Stream message via bot API
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BOT_API_URL}/threads/${threadId}/messages/stream`,
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

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const chunk of lines) {
          if (!chunk.trim()) continue;

          // Parse SSE format
          const eventMatch = chunk.match(/^event:\s*(.+)$/m);
          const dataMatch = chunk.match(/^data:\s*(.*)$/m);

          if (eventMatch?.[1] === "done") {
            // Stream complete, refresh messages from server
            break;
          }

          if (dataMatch) {
            const content = dataMatch[1];
            fullResponse += content;
            setMessages((prev) => {
              const newMessages = [...prev];
              newMessages[newMessages.length - 1] = {
                ...newMessages[newMessages.length - 1],
                content: fullResponse,
              };
              return newMessages;
            });
          }
        }
      }

      // Refresh messages from server to get real IDs
      const messagesRes = await fetch(
        `${process.env.NEXT_PUBLIC_BOT_API_URL}/threads/${threadId}/messages`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      if (messagesRes.ok) {
        const serverMessages = await messagesRes.json();
        setMessages(serverMessages.messages || []);
      }

      // Refresh threads to update titles
      fetchThreads();
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to send message";
      setMessages((prev) => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          ...newMessages[newMessages.length - 1],
          content: `Error: ${errorMessage}`,
        };
        return newMessages;
      });
    } finally {
      setIsStreaming(false);
      fetchBalance();
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
    <div className="h-screen flex overflow-hidden bg-background">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? "w-72" : "w-0"
        } transition-all duration-300 flex-shrink-0 overflow-hidden`}
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
      <div className="flex-1 flex flex-col min-w-0">
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
