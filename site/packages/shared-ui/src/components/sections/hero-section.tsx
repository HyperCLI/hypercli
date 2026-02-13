"use client";

import { motion, useScroll, useTransform, useSpring } from 'framer-motion';
import { useRef } from 'react';
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

  return (
    <section 
      ref={sectionRef}
      className="relative min-h-screen flex items-center px-4 sm:px-6 lg:px-8 bg-background overflow-hidden"
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
          <h1 className="text-[40px] sm:text-[48px] md:text-[56px] lg:text-[64px] xl:text-[64px] text-foreground mb-12 leading-[0.95] tracking-[-0.03em] font-bold max-w-5xl mx-auto text-center">
            Deploy AI models in 30 seconds.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-text-secondary via-text-tertiary to-text-muted text-[36px]">
              No GPUs. No Kubernetes. No infrastructure.
            </span>
          </h1>
        </motion.div>

        {/* Subheadline */}
        <motion.p 
          className="text-xl text-secondary-foreground max-w-2xl mx-auto mb-16 leading-relaxed text-center"
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

          <div className="relative bg-surface-low/80 backdrop-blur-sm border border-primary/20 rounded-2xl p-8 text-left shadow-[0_0_80px_rgba(56,211,159,0.15)]">
            <div className="font-mono text-base space-y-3">
              <div className="text-muted-foreground">$ pip install <span className="text-primary">hypercli-cli</span></div>
              <div className="text-muted-foreground">$ <span className="text-primary">hyper</span> instances launch nvidia/cuda:12.0 -g l40s</div>
            </div>
          </div>
        </motion.div>

        {/* HyperClaw CTA */}
        <motion.div
          className="max-w-xl mx-auto mb-6 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <h3 className="text-lg font-medium text-foreground mb-4">
            Launch your own <span className="text-primary">OpenClaw Agent</span>
          </h3>
          <a
            href={NAV_URLS.claw}
            className="inline-flex items-center px-8 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-all duration-300 font-medium text-base shadow-[0_0_30px_rgba(56,211,159,0.15)]"
          >
            Get Started
          </a>
        </motion.div>
      </motion.div>
    </section>
  );
}
