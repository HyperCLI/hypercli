"use client";

import { useState } from "react";
import { ChatSidebar } from "@/components/ChatSidebar";
import { ChatWindow } from "@/components/ChatWindow";
import { ChatInput } from "@/components/ChatInput";

export default function ChatPage() {
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [selectedModel, setSelectedModel] = useState("llama-3-70b");

  const handleSendMessage = (content: string) => {
    setMessages((prev) => [...prev, { role: "user", content }]);
    // Simulate assistant response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "This is a simulated response from the AI model. The actual implementation would connect to your HyperCLI deployment.",
        },
      ]);
    }, 1000);
  };

  return (
    <div className="h-screen flex bg-background">
      {/* Sidebar */}
      <ChatSidebar
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <header className="h-14 border-b border-border flex items-center px-4">
          <h1 className="text-sm font-medium text-foreground">
            Chat with{" "}
            <span className="text-primary">{selectedModel}</span>
          </h1>
        </header>

        {/* Messages */}
        <ChatWindow messages={messages} />

        {/* Input */}
        <ChatInput onSendMessage={handleSendMessage} />
      </div>
    </div>
  );
}
