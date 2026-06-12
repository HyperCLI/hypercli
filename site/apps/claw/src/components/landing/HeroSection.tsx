"use client";

import { useRef, useState } from "react";
import { motion, useScroll, useTransform, useSpring } from "framer-motion";
import { CodeSnippetCard, CTAButtonGroup, HeroBadge, PrivyLoginModal } from "@hypercli/shared-ui";
import { useAgentAuth } from "@/hooks/useAgentAuth";
import { AUTH_BASE_URL } from "@/lib/api";

const codeSnippet = `curl https://api.hypercli.com/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kimi-k2.5",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;
const POST_LOGIN_PATH = "/dashboard/agents";

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const { isAuthenticated } = useAgentAuth();

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
      window.location.href = POST_LOGIN_PATH;
    } else {
      setIsLoginModalOpen(true);
    }
  };

  return (
    <>
      <section
        ref={sectionRef}
        className="relative min-h-screen flex items-center justify-center pt-20 px-4 sm:px-6 lg:px-8 overflow-hidden"
      >
        {/* Grain texture */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-grid-pattern" />

        <motion.div
          className="absolute top-1/3 left-1/2 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-[120px]"
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
          className="relative max-w-5xl mx-auto text-center w-full overflow-hidden"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mb-8"
          >
            <HeroBadge>Flat-rate inference for AI agents</HeroBadge>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.8,
              delay: 0.1,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="text-[40px] sm:text-[48px] md:text-[56px] lg:text-[64px] font-bold leading-[0.95] tracking-[-0.03em] mb-6"
          >
            Unlimited Agent{" "}
            <span className="gradient-text-primary">Inference</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.8,
              delay: 0.2,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="text-base sm:text-lg md:text-xl text-text-secondary max-w-2xl mx-auto mb-10 leading-relaxed px-2"
          >
            AIU (Agent Inference Units) enable 24/7 agent operation with no
            per-token charges. OpenAI-compatible API on NVIDIA B200 GPUs.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.8,
              delay: 0.3,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="mb-16"
          >
            <CTAButtonGroup
              actions={[
                { label: "Get Started", onClick: handleGetStarted, variant: "primary" },
                { label: "View Pricing", href: "#pricing", variant: "secondary" },
              ]}
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.8,
              delay: 0.4,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="mx-auto w-full max-w-2xl"
          >
            <CodeSnippetCard
              label="terminal"
              code={codeSnippet}
              preClassName="text-xs sm:text-sm whitespace-pre-wrap break-all sm:whitespace-pre sm:break-normal"
            />
          </motion.div>
        </motion.div>

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--background)_75%)] opacity-40" />
      </section>

      <PrivyLoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        title="Welcome to HyperCLI"
        description="Please sign in to continue"
        apiBaseUrl={AUTH_BASE_URL}
        tokenStorageKey="claw_auth_token"
        onSuccess={() => {
          window.location.href = POST_LOGIN_PATH;
        }}
      />
    </>
  );
}
