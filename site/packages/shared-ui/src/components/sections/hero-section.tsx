"use client";

import { ArrowRight } from 'lucide-react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"]
  });

  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.95]);
  const y = useTransform(scrollYProgress, [0, 1], [0, -100]);

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
          className="max-w-2xl mx-auto mb-16 relative"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Glow effect behind code block */}
          <div className="absolute inset-0 bg-[#38D39F]/10 blur-[80px] rounded-full scale-110" />
          
          <div className="relative bg-[#161819]/80 backdrop-blur-sm border border-[#38D39F]/20 rounded-2xl p-8 text-left shadow-[0_0_80px_rgba(56,211,159,0.15)]">
            <div className="font-mono text-base space-y-3">
              <div className="text-[#9BA0A2]">$ pip install hypercli</div>
              <div className="text-[#9BA0A2]">$ hypercli deploy llama3</div>
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
          <motion.button 
            className="group px-10 py-5 bg-[#38D39F] text-[#0B0D0E] rounded-xl hover:bg-[#45E4AE] transition-all flex items-center gap-3 shadow-[0_0_40px_rgba(56,211,159,0.3)] font-medium"
            whileHover={{ scale: 1.05, boxShadow: '0 0 60px rgba(56,211,159,0.4)' }}
            whileTap={{ scale: 0.98 }}
          >
            Deploy Llama 3
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </motion.button>
          <motion.button 
            className="px-10 py-5 bg-transparent text-white rounded-xl hover:bg-[#161819]/50 transition-all duration-300 border border-[#2A2D2F] flex items-center gap-3 hover:border-[#38D39F]/40 font-medium backdrop-blur-sm"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Try the Playground
            <ArrowRight className="w-5 h-5" />
          </motion.button>
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