// Deployed: 2026-02-23 - Cache buster v6
"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { useClawAuth } from "@/hooks/useClawAuth";

const codeSnippet = `curl https://api.hyperclaw.app/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kimi-k2.5",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const { login, isAuthenticated } = useClawAuth();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 90,
    damping: 24,
    mass: 0.35,
  });

  const contentY = useTransform(smoothProgress, [0, 1], [0, -80]);
  const contentOpacity = useTransform(smoothProgress, [0, 0.5], [1, 0]);

  const handleGetStarted = () => {
    if (isAuthenticated) {
      window.location.href = "/dashboard";
    } else {
      login();
    }
  };

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen flex items-center justify-center pt-20 px-4 sm:px-6 lg:px-8 overflow-hidden"
    >
      {/* Grain texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-grid-pattern" />

      {/* Animated glow */}
      <motion.div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-[#38D39F]/5 blur-[120px] rounded-full"
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.05, 0.08, 0.05],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <motion.div
        style={{ y: contentY, opacity: contentOpacity }}
        className="relative max-w-5xl mx-auto text-center"
      >
        {/* Headline - BUILD TEST */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.8,
            delay: 0.1,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="text-[36px] sm:text-[44px] md:text-[52px] lg:text-[60px] font-bold leading-[1.05] tracking-[-0.03em] mb-6"
        >
          Unlimited Inference. One Flat Price. Deploy in Seconds.
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.8,
            delay: 0.2,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="text-2xl sm:text-3xl font-semibold text-primary max-w-2xl mx-auto mb-6 leading-relaxed"
        >
          Stop counting tokens. Start shipping.
        </motion.p>

        {/* Body copy */}
        <motion.p
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.8,
            delay: 0.25,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="text-lg text-text-secondary max-w-2xl mx-auto mb-10 leading-relaxed"
        >
          Unlimited inference on the leading models. One flat price. Launch your first agent before you finish your coffee.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.8,
            delay: 0.3,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6"
        >
          <button
            onClick={handleGetStarted}
            className="btn-primary px-8 py-4 rounded-lg text-base font-semibold glow-green-subtle"
          >
            Start Free — Agent Running in 60 Seconds
          </button>
        </motion.div>

        {/* Secondary line */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="text-sm text-text-muted mb-8"
        >
          No credit card · No downloads · 30 min free GPU
        </motion.p>

        {/* Trust tags */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="text-xs text-text-muted/60 mb-8"
        >
          OpenAI-compatible · Kimi · GLM-5 · MiniMax · B200 GPUs
        </motion.p>

        {/* Code snippet */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.8,
            delay: 0.5,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="glass-card p-1 max-w-2xl mx-auto"
        >
          <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
              <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
            </div>
            <span className="text-xs text-text-muted ml-2">terminal</span>
          </div>
          <pre className="p-4 text-left text-sm text-text-secondary overflow-x-auto border-0 bg-transparent">
            <code>{codeSnippet}</code>
          </pre>
        </motion.div>
      </motion.div>

      {/* Vignette */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(11,13,14,0.4)_70%)]" />
    </section>
  );
}
// Build: 2026-02-23-14:11:32
// Force rebuild 1771856078
