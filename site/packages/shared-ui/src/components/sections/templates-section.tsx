"use client";

import { Database, MessageSquare, Image, Code, Video, Users, FileCode, Network, Layers, ArrowRight } from 'lucide-react';
import { motion, useScroll, useTransform, useInView } from 'framer-motion';
import { useRef } from 'react';

export function TemplatesSection() {
  const templates = [
    {
      icon: Database,
      name: 'RAG pipeline',
      description: 'Llama 3 / Mistral + Chroma'
    },
    {
      icon: MessageSquare,
      name: 'Llama 3 Chat API',
      description: 'GPT-style inference server'
    },
    {
      icon: Image,
      name: 'Flux.1 Image Gen',
      description: 'text → image'
    },
    {
      icon: Code,
      name: 'Fine-tuning pipeline',
      description: 'LoRA, QLoRA, checkpoints'
    },
    {
      icon: Video,
      name: 'Video captioning',
      description: 'Whisper + Llama'
    },
    {
      icon: Users,
      name: 'Agents & tools',
      description: 'function calling + orchestration'
    },
    {
      icon: FileCode,
      name: 'Embeddings-as-a-service',
      description: 'Vector generation API'
    },
    {
      icon: Network,
      name: 'Multi-model router',
      description: 'Intelligent model selection'
    },
    {
      icon: Layers,
      name: 'Batch job queue',
      description: 'Background processing'
    }
  ];

  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(contentRef, { once: true, margin: "-100px" });
  
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"]
  });

  const chapterY = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [30, 0, 0, -30]);
  const chapterOpacity = useTransform(scrollYProgress, [0, 0.15, 0.6, 0.85], [0, 1, 1, 0]);
  const chapterScale = useTransform(scrollYProgress, [0, 0.2], [0.98, 1]);

  return (
    <>
      {/* Fullscreen Chapter Transition */}
      <section 
        ref={sectionRef}
        className="relative h-[50vh] flex items-center justify-center px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] overflow-hidden"
      >
        {/* Grain texture */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />
        
        <motion.div
          className="max-w-7xl w-full flex justify-center"
          style={{ y: chapterY, opacity: chapterOpacity, scale: chapterScale }}
        >
          <div className="inline-block">
            <h2 className="text-[56px] sm:text-[72px] lg:text-[96px] xl:text-[120px] text-white leading-[0.9] tracking-[-0.05em] font-bold text-center">
              Templates & Blueprints
            </h2>
            <motion.div
              className="h-2 bg-[#38D39F] mt-12 w-full"
              initial={{ width: 0 }}
              whileInView={{ width: '100%' }}
              transition={{ duration: 0.8, delay: 0.3 }}
            />
          </div>
        </motion.div>
      </section>

      {/* Section Content */}
      <section className="relative py-24 px-4 sm:px-6 lg:px-8 overflow-hidden bg-[#0D0F10]">
        {/* Grain texture */}
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />
        
        {/* Subtle right-side lighting with parallax */}
        <motion.div 
          className="absolute right-0 top-1/3 w-[500px] h-[500px] bg-[#38D39F]/3 blur-[120px] rounded-full pointer-events-none opacity-60"
          style={{ y: useTransform(scrollYProgress, [0, 1], [-30, 30]) }}
        />
        
        <div className="max-w-7xl mx-auto relative">
          {/* Section title */}
          <motion.div 
            ref={contentRef}
            className="mb-16"
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <h3 className="text-5xl sm:text-6xl text-white mb-8 leading-[1.05] tracking-tight max-w-4xl">
              Deploy complete AI apps in one command
            </h3>
            <p className="text-xl text-[#9BA0A2] max-w-2xl leading-relaxed">
              Skip the boilerplate. Use production-ready templates.
            </p>
          </motion.div>

          {/* Two-column grid layout */}
          <div className="grid md:grid-cols-2 gap-3 mb-12">
            {templates.map((template, index) => (
              <motion.div
                key={index}
                className="group flex items-center gap-4 py-4 px-5 bg-[#161819]/20 border border-[#2A2D2F]/30 rounded-xl hover:bg-[#161819]/40 hover:border-[#38D39F]/30 transition-all duration-300 cursor-pointer"
                initial={{ opacity: 0, x: -40 }}
                animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -40 }}
                transition={{ 
                  duration: 0.5, 
                  delay: 0.2 + index * 0.04,
                  ease: [0.22, 1, 0.36, 1]
                }}
                whileHover={{ x: 4, scale: 1.01 }}
              >
                <motion.div 
                  className="w-10 h-10 rounded-lg bg-[#38D39F]/8 flex items-center justify-center group-hover:bg-[#38D39F]/15 transition-colors flex-shrink-0"
                >
                  <template.icon className="w-5 h-5 text-[#38D39F]" />
                </motion.div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-base text-white mb-0.5 group-hover:text-[#38D39F] transition-colors">{template.name}</h4>
                  <p className="text-sm text-[#9BA0A2]">{template.description}</p>
                </div>
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  whileHover={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ArrowRight className="w-4 h-4 text-[#38D39F] flex-shrink-0" />
                </motion.div>
              </motion.div>
            ))}
          </div>

          {/* Code example */}
          <motion.div 
            className="max-w-2xl mb-10"
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 0.8, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="bg-[#161819]/50 backdrop-blur-sm border border-[#38D39F]/20 rounded-xl p-6 shadow-[0_0_40px_rgba(56,211,159,0.08)]">
              <div className="font-mono text-base space-y-2">
                <div className="text-[#9BA0A2]">$ hypercli deploy rag-pipeline</div>
                <div className="text-[#38D39F]">✓ Template deployed</div>
              </div>
            </div>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
          >
            <motion.button 
              className="text-lg text-[#38D39F] hover:text-[#45E4AE] transition-colors inline-flex items-center gap-3 group"
              whileHover={{ x: 4 }}
            >
              Browse Blueprints
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </motion.button>
          </motion.div>
        </div>
      </section>
    </>
  );
}