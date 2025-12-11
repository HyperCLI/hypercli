"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@hypercli/shared-ui";

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center px-4 sm:px-6 lg:px-8 bg-background overflow-hidden pt-16">
      {/* Subtle grain texture overlay */}
      <div className="grain-overlay" />

      {/* Cinematic vignette */}
      <div className="vignette" />

      {/* Subtle animated green glow */}
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-primary/5 blur-[120px] rounded-full"
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

      <div className="max-w-7xl mx-auto w-full py-32 relative">
        {/* Main headline with staggered animation */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <h1 className="text-[40px] sm:text-[48px] md:text-[56px] lg:text-[64px] xl:text-[64px] text-foreground mb-12 leading-[0.95] tracking-[-0.03em] font-bold max-w-5xl mx-auto text-center">
            Deploy AI models in 30 seconds.
            <br />
            <span className="text-gradient-muted text-[36px]">
              No GPUs. No Kubernetes. No infrastructure.
            </span>
          </h1>
        </motion.div>

        {/* Subheadline */}
        <motion.p
          className="text-xl text-text-tertiary max-w-2xl mx-auto mb-16 leading-relaxed text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          HyperCLI is the universal AI runtime that runs any model — Llama 3,
          Mistral, Flux, Whisper, custom checkpoints — across a global GPU
          fabric with a single command.
        </motion.p>

        {/* Code snippet with spotlight glow */}
        <motion.div
          className="max-w-2xl mx-auto mb-16 relative"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Glow effect behind code block */}
          <div className="absolute inset-0 bg-primary/10 blur-[80px] rounded-full scale-110" />

          <div className="relative bg-surface-low/80 backdrop-blur-sm border border-primary/20 rounded-2xl p-8 text-left glow-primary-lg">
            <div className="font-mono text-base space-y-3">
              <div className="text-text-tertiary">$ pip install hypercli</div>
              <div className="text-text-tertiary">$ hypercli deploy llama3</div>
            </div>
          </div>
        </motion.div>

        {/* CTAs with enhanced spacing */}
        <motion.div
          className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <Button size="xl" className="group">
            Deploy Llama 3
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Button>
          <Button variant="outline" size="xl">
            Try the Playground
            <ArrowRight className="w-5 h-5" />
          </Button>
        </motion.div>

        <motion.p
          className="text-sm text-text-muted text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.8 }}
        >
          No signup required
        </motion.p>
      </div>
    </section>
  );
}
