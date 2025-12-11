"use client";

import { useState, useEffect, useRef } from "react";
import { ContactModal, NAV_URLS } from "@hypercli/shared-ui";

export default function HeroSection() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalSource, setModalSource] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [placeholderText, setPlaceholderText] = useState("");
  const [animationState, setAnimationState] = useState("LOADING");
  const currentModelIndexRef = useRef(0);
  const charIndexRef = useRef(0);

  const openModal = (source: string) => {
    setModalSource(source);
    setIsModalOpen(true);
  };

  // Helper function to pick a random model different from current
  const getRandomModelIndex = (currentIndex: number, modelsLength: number): number => {
    if (modelsLength <= 1) return 0;
    let nextIndex;
    do {
      nextIndex = Math.floor(Math.random() * modelsLength);
    } while (nextIndex === currentIndex);
    return nextIndex;
  };

  // Fetch models
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch("https://api.compute3.ai/llm/models");
        const data = await response.json();
        const modelList = Object.entries(data)
          .filter(([key]) => !key.toLowerCase().includes("embedding"))
          .map(([, value]) => {
            const name = (value as { name: string }).name;
            return name.includes(": ") ? name.split(": ")[1] : name;
          })
          .filter(Boolean);
        if (modelList.length === 0) throw new Error("No models");
        const shuffled = [...modelList].sort(() => Math.random() - 0.5);
        setModels(shuffled);
        currentModelIndexRef.current = Math.floor(Math.random() * shuffled.length);
        setAnimationState("TYPING_IN");
      } catch (err) {
        console.error("Failed to fetch models:", err);
        const fallbackModels = ["Claude Sonnet 4.5", "GPT-4o", "Llama 3.3 70B", "Gemini 2.5 Flash"];
        const shuffled = [...fallbackModels].sort(() => Math.random() - 0.5);
        setModels(shuffled);
        currentModelIndexRef.current = Math.floor(Math.random() * shuffled.length);
        setAnimationState("TYPING_IN");
      }
    };
    fetchModels();
  }, []);

  // FSM animation
  useEffect(() => {
    if (models.length === 0 || animationState === "LOADING") return;

    const currentModel = models[currentModelIndexRef.current] || models[0];
    if (!currentModel) return;

    const otherModelsCount = models.length - 1;
    const fullText = `One API key, use ${currentModel} or ${otherModelsCount}+ other models...`;
    let interval: NodeJS.Timeout | undefined;

    switch (animationState) {
      case "TYPING_IN":
        interval = setInterval(() => {
          if (charIndexRef.current < fullText.length) {
            charIndexRef.current++;
            setPlaceholderText(fullText.substring(0, charIndexRef.current));
          } else {
            clearInterval(interval);
            setAnimationState("PAUSED");
          }
        }, 50);
        break;

      case "PAUSED":
        const pauseTimeout = setTimeout(() => {
          setAnimationState("TYPING_OUT");
        }, 2000);
        return () => clearTimeout(pauseTimeout);

      case "TYPING_OUT":
        interval = setInterval(() => {
          if (charIndexRef.current > 0) {
            charIndexRef.current--;
            setPlaceholderText(fullText.substring(0, charIndexRef.current));
          } else {
            clearInterval(interval);
            setAnimationState("CYCLING");
          }
        }, 30);
        break;

      case "CYCLING":
        const cycleTimeout = setTimeout(() => {
          currentModelIndexRef.current = getRandomModelIndex(currentModelIndexRef.current, models.length);
          charIndexRef.current = 0;
          setAnimationState("TYPING_IN");
        }, 100);
        return () => clearTimeout(cycleTimeout);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [models, animationState]);

  const handleChatSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const encodedMessage = btoa(chatInput);
    window.location.href = `${NAV_URLS.chat}?message=${encodedMessage}`;
  };

  return (
    <>
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-[#0B0D0E]">
        {/* Subtle grain texture overlay */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />

        {/* Cinematic vignette */}
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(11,13,14,0.4)_70%)]" />

        {/* Subtle animated green glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-[#38D39F]/5 blur-[120px] rounded-full animate-pulse" />

        <div className="relative z-20 max-w-7xl mx-auto px-6 py-32">
          {/* Main headline */}
          <div className="text-center mb-12">
            <h1 className="text-[40px] sm:text-[48px] md:text-[56px] lg:text-[64px] text-white mb-8 leading-[0.95] tracking-[-0.03em] font-bold max-w-5xl mx-auto">
              Private GPUs in &lt; 3 Seconds.
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#D4D6D7] via-[#9BA0A2] to-[#6E7375]">
                Pay Per Second.
              </span>
            </h1>

            <p className="text-xl text-[#9BA0A2] max-w-2xl mx-auto mb-8 leading-relaxed">
              Secure GPU workloads. Your API keys, your container. 70+ models ready to deploy.
              Custom Docker orchestration with secure API key provisioning.
            </p>

            <p className="text-lg text-[#6E7375] max-w-2xl mx-auto mb-12">
              From A100s to B300s. <span className="text-[#38D39F]">Per-second billing</span> means you only pay for what you use.
            </p>
          </div>

          {/* Code snippet with spotlight glow */}
          <div className="max-w-2xl mx-auto mb-16 relative">
            {/* Glow effect behind code block */}
            <div className="absolute inset-0 bg-[#38D39F]/10 blur-[80px] rounded-full scale-110" />

            <div className="relative bg-[#161819]/80 backdrop-blur-sm border border-[#38D39F]/20 rounded-2xl p-8 text-left shadow-[0_0_80px_rgba(56,211,159,0.15)]">
              <div className="font-mono text-base space-y-3">
                <div className="text-[#9BA0A2]">$ pip install hypercli</div>
                <div className="text-[#9BA0A2]">$ hypercli deploy llama3</div>
                <div className="text-[#38D39F]">✓ Model deployed in 2.3s</div>
              </div>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-16">
            <button className="group px-10 py-5 bg-[#38D39F] text-[#0B0D0E] rounded-xl hover:bg-[#45E4AE] transition-all flex items-center gap-3 shadow-[0_0_40px_rgba(56,211,159,0.3)] font-medium">
              Get Started
              <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </button>
            <button className="px-10 py-5 bg-transparent text-white rounded-xl hover:bg-[#161819]/50 transition-all duration-300 border border-[#2A2D2F] flex items-center gap-3 hover:border-[#38D39F]/40 font-medium backdrop-blur-sm">
              Try the Playground
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </button>
          </div>

          {/* Chat Input */}
          <div className="max-w-xl mx-auto text-center">
            <h3 className="text-xl font-semibold text-white mb-4">
              Chat with HyperCLI<span className="text-[#38D39F]">.AI</span>
            </h3>
            <form onSubmit={handleChatSubmit} className="flex gap-2 bg-[#161819]/80 backdrop-blur-sm p-2 rounded-xl border border-[#2A2D2F] focus-within:border-[#38D39F]/50 transition-all duration-300">
              <input
                type="text"
                className="flex-1 bg-transparent border-none text-white text-base px-4 py-3 outline-none placeholder:text-[#6E7375]"
                placeholder={animationState !== "LOADING" ? placeholderText : "Loading..."}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onFocus={() => {
                  if (!chatInput) {
                    setAnimationState("PAUSED");
                    setPlaceholderText("Ask me anything...");
                  }
                }}
                onBlur={() => {
                  if (!chatInput && animationState !== "LOADING") {
                    charIndexRef.current = 0;
                    setAnimationState("TYPING_IN");
                  }
                }}
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="px-4 py-2 bg-[#38D39F] text-[#0B0D0E] rounded-lg hover:bg-[#45E4AE] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </form>
            <p className="text-sm text-[#6E7375] mt-4">No signup required</p>
          </div>
        </div>
      </section>

      <ContactModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} source={modalSource} />
    </>
  );
}
