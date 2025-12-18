"use client";

import { ArrowRight } from 'lucide-react';
import { motion, useScroll, useTransform, useInView, useSpring } from 'framer-motion';
import { useRef } from 'react';

export function PlaygroundCTASection() {
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(contentRef, { once: true, margin: "-100px" });
  
  const { scrollYProgress: rawScrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"]
  });

  const scrollYProgress = useSpring(rawScrollYProgress, {
    stiffness: 90,
    damping: 24,
    mass: 0.35,
  });

  const chapterY = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [30, 0, 0, -30]);
  const chapterOpacity = useTransform(scrollYProgress, [0, 0.15, 0.6, 0.85], [0.12, 1, 1, 0.12]);
  const chapterScale = useTransform(scrollYProgress, [0, 0.2], [1.01, 1]);

  return (
    <>
      {/* Fullscreen Chapter Transition */}
      <section 
        ref={sectionRef}
        className="relative h-[50vh] flex items-center justify-center px-4 sm:px-6 lg:px-8 bg-[#38D39F] overflow-hidden"
      >
        {/* Animated noise texture */}
        <div className="absolute inset-0 opacity-[0.08] pointer-events-none mix-blend-overlay bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />
        
        <motion.div 
          className="text-center"
          style={{ y: chapterY, opacity: chapterOpacity, scale: chapterScale }}
        >
          <h2 className="text-[56px] sm:text-[72px] lg:text-[96px] xl:text-[120px] !text-[#0B0D0E] leading-[0.9] tracking-[-0.05em] font-bold">
            Playground
          </h2>
        </motion.div>
      </section>

      {/* Section Content */}
      <section className="relative py-24 px-4 sm:px-6 lg:px-8 overflow-hidden bg-[#0B0D0E]">
        {/* Grain texture */}
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />
        
        {/* Subtle radial vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(56,211,159,0.03)_0%,#0B0D0E_60%)] pointer-events-none" />
        
        <motion.div 
          ref={contentRef}
          className="max-w-7xl mx-auto relative text-center"
        >
          {/* Dramatic headline */}
          <motion.h3 
            className="text-5xl sm:text-6xl text-white mb-8 leading-[1.05] tracking-tight max-w-4xl mx-auto"
            initial={{ opacity: 0, y: 50 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            Try any model instantly
          </motion.h3>
          
          {/* Supporting copy */}
          <motion.p 
            className="text-xl text-[#9BA0A2] max-w-3xl mx-auto leading-relaxed mb-16"
            initial={{ opacity: 0, y: 30 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            No setup. No credit card. No GPUs required.
            <br />
            Run LLMs, image models, embeddings, and audio models — then export the code to your project in one click.
          </motion.p>

          {/* Clean CTA with glow effect */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.6, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <motion.button 
              onClick={() => window.location.href = '/playground'}
              className="group px-10 py-5 bg-[#38D39F] text-[#0B0D0E] rounded-xl hover:bg-[#45E4AE] transition-all flex items-center gap-3 shadow-[0_0_40px_rgba(56,211,159,0.3)] text-lg font-medium mx-auto"
              whileHover={{ 
                scale: 1.05, 
                boxShadow: '0 0 60px rgba(56,211,159,0.4)' 
              }}
              whileTap={{ scale: 0.98 }}
            >
              Open Playground
              <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
            </motion.button>
          </motion.div>
        </motion.div>
      </section>
    </>
  );
}
