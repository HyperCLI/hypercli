"use client";

import { Send } from 'lucide-react';
import { motion, useScroll, useTransform, useSpring } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { NAV_URLS } from '../../utils/navigation';

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress: rawScrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"]
  });

  const scrollYProgress = useSpring(rawScrollYProgress, {
    stiffness: 90,
    damping: 24,
    mass: 0.35,
  });

  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.95]);
  const y = useTransform(scrollYProgress, [0, 1], [0, -100]);

  // Chat animation state
  const [chatInput, setChatInput] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [placeholderText, setPlaceholderText] = useState("");
  const [animationState, setAnimationState] = useState("LOADING");
  const currentModelIndexRef = useRef(0);
  const charIndexRef = useRef(0);

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
        const apiBase = process.env.NEXT_PUBLIC_LLM_API_URL?.replace('/v1', '') || 'https://api.hypercli.com';
        const response = await fetch(`${apiBase}/llm/models`);
        const data = await response.json();
        const modelList = Object.entries(data)
          .filter(([key]) => !key.toLowerCase().includes("embed"))
          .map(([, value]) => {
            const name = (value as { name: string }).name;
            // Strip provider prefix (e.g., "Nous: Hermes 4 70B" -> "Hermes 4 70B")
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
    const fullText = `One API, use ${currentModel} or ${otherModelsCount}+ other models...`;
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
    <section 
      ref={sectionRef}
      className="relative min-h-screen flex items-center px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] overflow-hidden"
    >
      {/* Subtle grain texture overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />
      
      {/* Cinematic vignette */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(11,13,14,0.4)_70%)]" />
      
      {/* Subtle animated green glow */}
      <motion.div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-[#38D39F]/5 blur-[120px] rounded-full"
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.05, 0.08, 0.05],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />
      
      <motion.div 
        className="max-w-7xl mx-auto w-full py-32 relative"
        style={{ opacity, scale, y }}
      >
        {/* Main headline with staggered animation */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1 className="text-[40px] sm:text-[48px] md:text-[56px] lg:text-[64px] xl:text-[64px] text-white mb-12 leading-[0.95] tracking-[-0.03em] font-bold max-w-5xl mx-auto text-center">
            Deploy AI models in 30 seconds.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#D4D6D7] via-[#9BA0A2] to-[#6E7375] text-[36px]">
              No GPUs. No Kubernetes. No infrastructure.
            </span>
          </h1>
        </motion.div>

        {/* Subheadline */}
        <motion.p 
          className="text-xl text-[#9BA0A2] max-w-2xl mx-auto mb-16 leading-relaxed text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          HyperCLI is the universal AI runtime that runs any model — Llama 3, Mistral, Flux, Whisper, custom checkpoints — across a global GPU fabric with a single command.
        </motion.p>

        {/* Code snippet with spotlight glow */}
        <motion.div
          className="max-w-2xl mx-auto mb-20 relative"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Glow effect behind code block */}
          <div className="absolute inset-0 bg-[#38D39F]/10 blur-[80px] rounded-full scale-110" />

          <div className="relative bg-[#161819]/80 backdrop-blur-sm border border-[#38D39F]/20 rounded-2xl p-8 text-left shadow-[0_0_80px_rgba(56,211,159,0.15)]">
            <div className="font-mono text-base space-y-3">
              <div className="text-[#9BA0A2]">$ pip install <span className="text-[#38D39F]">hypercli</span></div>
              <div className="text-[#9BA0A2]">$ <span className="text-[#38D39F]">hypercli</span> deploy minimax-m2</div>
            </div>
          </div>
        </motion.div>

        {/* Chat Input */}
        <motion.div
          className="max-w-xl mx-auto mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <h3 className="text-lg font-medium text-white mb-4 text-center">
            Talk to our <span className="text-[#38D39F]">AI chat</span>
          </h3>
          <form onSubmit={handleChatSubmit} className="flex gap-2 bg-[#161819]/80 backdrop-blur-sm p-2 rounded-xl border border-[#2A2D2F] focus-within:border-[#38D39F]/40 focus-within:shadow-[0_0_30px_rgba(56,211,159,0.1)] transition-all duration-300">
            <input
              type="text"
              className="flex-1 bg-transparent border-none text-white text-base px-4 py-3 outline-none placeholder:text-[#38D39F]/60"
              placeholder={animationState !== "LOADING" ? placeholderText : "Loading models..."}
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
              <Send className="w-5 h-5" />
            </button>
          </form>
        </motion.div>

        <motion.p
          className="text-sm text-[#6E7375] text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.8 }}
        >
          No signup required
        </motion.p>
      </motion.div>
    </section>
  );
}
