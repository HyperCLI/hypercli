"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useAuth, WalletAuth, cookieUtils, TopUpModal } from "@hypercli/shared-ui";
import { useTurnkey } from "@turnkey/react-wallet-kit";
import { useRouter, useSearchParams } from "next/navigation";
import { ChatSidebar, ChatWindow, ChatInput, ChatHeader } from "../components";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Chat {
  id: string;
  title: string;
  messages: Message[];
  timestamp: number;
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

  // Chats
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

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
  const [isFreeUser, setIsFreeUser] = useState(false);

  // Balance
  const [balance, setBalance] = useState<Balance | null>(null);

  // Check if user is a free/guest user by decoding JWT
  useEffect(() => {
    const authToken = document.cookie
      .split("; ")
      .find((row) => row.startsWith("auth_token="))
      ?.split("=")[1];

    if (authToken) {
      try {
        // Decode JWT payload (base64)
        const payload = JSON.parse(atob(authToken.split(".")[1]));
        setIsFreeUser(payload.login_type === "free");
      } catch {
        setIsFreeUser(false);
      }
    }
  }, [isAuthenticated]);

  // Load theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem("c3_chat_theme") as "light" | "dark" | null;
    if (savedTheme) {
      setTheme(savedTheme);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("c3_chat_theme", theme);
  }, [theme]);

  // Load chats from localStorage
  useEffect(() => {
    const storedChats = localStorage.getItem("c3_chats");
    if (storedChats) {
      const parsedChats = JSON.parse(storedChats) as Chat[];
      setChats(parsedChats);
      if (parsedChats.length > 0) {
        setCurrentChatId(parsedChats[0].id);
        setMessages(parsedChats[0].messages);
      }
    }
  }, []);

  // Save chats to localStorage
  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem("c3_chats", JSON.stringify(chats));
    }
  }, [chats]);

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
        // Store JWT token in cookie
        document.cookie = `auth_token=${data.token}; path=/; max-age=${data.expires_in}; SameSite=Lax`;
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
        const authToken = document.cookie
          .split("; ")
          .find((row) => row.startsWith("auth_token="))
          ?.split("=")[1];

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
          const savedModel = localStorage.getItem("c3_chat_model");
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
      const authToken = document.cookie
        .split("; ")
        .find((row) => row.startsWith("auth_token="))
        ?.split("=")[1];

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
    localStorage.setItem("c3_pending_chat_message", decodedMessage);

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
          // Store JWT token in cookie
          document.cookie = `auth_token=${data.token}; path=/; max-age=${data.expires_in}; SameSite=Lax`;
          // Clear URL param and reload to trigger auth
          router.replace("/");
          window.location.reload();
        } catch (e) {
          console.error("Failed to create free user:", e);
          // Fall back to showing login
          localStorage.removeItem("c3_pending_chat_message");
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

    const pendingMsg = localStorage.getItem("c3_pending_chat_message");
    if (pendingMsg) {
      localStorage.removeItem("c3_pending_chat_message");
      setInitialMessageSent(true);
      setPendingMessage(pendingMsg);
    }
  }, [isAuthenticated, loadingModels, selectedModel, initialMessageSent]);

  const handleModelChange = (modelId: string) => {
    setSelectedModel(modelId);
    localStorage.setItem("c3_chat_model", modelId);
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const startNewChat = () => {
    const newChat: Chat = {
      id: crypto.randomUUID(),
      title: "New Chat",
      messages: [],
      timestamp: Date.now(),
    };
    setChats((prev) => [newChat, ...prev]);
    setCurrentChatId(newChat.id);
    setMessages([]);
  };

  const selectChat = (chatId: string) => {
    const chat = chats.find((c) => c.id === chatId);
    if (chat) {
      setCurrentChatId(chatId);
      setMessages(chat.messages);
    }
  };

  const deleteChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedChats = chats.filter((c) => c.id !== chatId);
    setChats(updatedChats);

    if (currentChatId === chatId) {
      if (updatedChats.length > 0) {
        setCurrentChatId(updatedChats[0].id);
        setMessages(updatedChats[0].messages);
      } else {
        setCurrentChatId(null);
        setMessages([]);
      }
    }

    if (updatedChats.length === 0) {
      localStorage.removeItem("c3_chats");
    }
  };

  const handleSendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || isStreaming || !selectedModel) return;

    // Clear pending message if it was used
    if (pendingMessage) {
      setPendingMessage("");
    }

    // Create chat if needed
    let chatId = currentChatId;
    if (!chatId) {
      chatId = crypto.randomUUID();
      const newChat: Chat = {
        id: chatId,
        title: userMessage.substring(0, 30),
        messages: [],
        timestamp: Date.now(),
      };
      setChats((prev) => [newChat, ...prev]);
      setCurrentChatId(chatId);
    }

    // Add user message
    const updatedMessages: Message[] = [...messages, { role: "user", content: userMessage }];
    setMessages(updatedMessages);
    setIsStreaming(true);

    // Add empty assistant message
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const authToken = document.cookie
        .split("; ")
        .find((row) => row.startsWith("auth_token="))
        ?.split("=")[1];

      if (!authToken) throw new Error("No auth token");

      const response = await fetch(`${process.env.NEXT_PUBLIC_LLM_API_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: updatedMessages,
          temperature: 0.7,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Error ${response.status}`);
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
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() === "" || !line.startsWith("data: ")) continue;

          const data = line.slice(6);
          if (data === "[DONE]") break;

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullResponse += content;
              setMessages((prev) => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = {
                  role: "assistant",
                  content: fullResponse,
                };
                return newMessages;
              });
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }

      // Update chat in state
      const finalMessages: Message[] = [
        ...updatedMessages,
        { role: "assistant", content: fullResponse },
      ];

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: finalMessages,
                title: chat.title === "New Chat" ? userMessage.substring(0, 30) : chat.title,
              }
            : chat
        )
      );
    } catch (error) {
      console.error("Chat error:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to send message";
      setMessages((prev) => {
        const newMessages = [...prev];
        newMessages[newMessages.length - 1] = {
          role: "assistant",
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
    // Clear chat storage
    localStorage.removeItem("c3_chats");
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
          chats={chats}
          currentChatId={currentChatId}
          models={models}
          selectedModel={selectedModel}
          loadingModels={loadingModels}
          balance={balance}
          theme={theme}
          onSelectChat={selectChat}
          onDeleteChat={deleteChat}
          onNewChat={startNewChat}
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
