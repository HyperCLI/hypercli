"use client";

import { Zap, Rocket, Globe, Radio, Server } from 'lucide-react';
import { motion, useScroll, useTransform, useInView, useSpring } from 'framer-motion';
import { useRef } from 'react';

export function InstantDeploymentSection() {
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
  const chapterOpacity = useTransform(scrollYProgress, [0, 0.15, 0.6, 0.85], [0.1, 1, 1, 0.1]);
  const contentY = useTransform(scrollYProgress, [0.25, 0.55], [24, 0]);

  const items = [
    { icon: Zap, title: 'Deploy LLMs, diffusion, audio, TTS/STT', description: 'Any model architecture, any framework' },
    { icon: Rocket, title: 'Serverless autoscaling', description: 'From zero to thousands of requests' },
    { icon: Globe, title: 'Global endpoints', description: 'Low-latency inference worldwide' },
    { icon: Radio, title: 'Streaming APIs', description: 'Real-time token streaming built-in' },
    { icon: Server, title: 'Zero infrastructure to manage', description: 'No Kubernetes, no containers, no ops' }
  ];

  return (
    <>
      {/* Fullscreen Chapter Transition */}
      <section 
        ref={sectionRef}
        className="relative h-[50vh] flex items-center justify-center px-4 sm:px-6 lg:px-8 bg-primary overflow-hidden"
      >
        {/* Animated noise texture */}
        <div className="absolute inset-0 opacity-[0.08] pointer-events-none mix-blend-overlay bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />
        
        <motion.div 
          className="text-center"
          style={{ y: chapterY, opacity: chapterOpacity }}
        >
          <h2 className="text-[56px] sm:text-[72px] lg:text-[96px] xl:text-[120px] !text-primary-foreground leading-[0.9] tracking-[-0.05em] font-bold">
            Instant Deployment
          </h2>
        </motion.div>
      </section>

      {/* Section Content */}
      <section className="relative py-24 px-4 sm:px-6 lg:px-8 overflow-hidden bg-background">
        {/* Grain texture */}
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />
        
        {/* Subtle vignette */}
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-[#0D0F10]/30 to-transparent" />
        
        <motion.div 
          ref={contentRef}
          className="max-w-7xl mx-auto relative"
          style={{ y: contentY }}
        >
          {/* Section title */}
          <motion.div 
            className="mb-20"
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <h3 className="text-5xl sm:text-6xl text-foreground mb-8 leading-[1.1] tracking-tight max-w-4xl">
              The fastest way to run AI in production
            </h3>
            <p className="text-xl text-muted-foreground max-w-3xl leading-relaxed">
              Skip GPU provisioning, container builds, schedulers, autoscaling, and model wiring.
              <br />
              HyperCLI turns your code into a production-grade, GPU-backed endpoint in seconds.
            </p>
          </motion.div>

          {/* Icon rows with staggered reveal */}
          <div className="grid md:grid-cols-2 gap-x-8 gap-y-8">
            {items.map((item, index) => (
              <motion.div
                key={index}
                className="group flex items-start gap-6 pb-8 border-b border-[#1F2122]/40 hover:border-[#38D39F]/20 transition-all duration-300"
                initial={{ opacity: 0, x: -30 }}
                animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
                transition={{ 
                  duration: 0.6, 
                  delay: 0.3 + index * 0.1,
                  ease: [0.22, 1, 0.36, 1]
                }}
                whileHover={{ x: 8 }}
              >
                <motion.div 
                  className="w-14 h-14 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/15 transition-all duration-300"
                  whileHover={{ scale: 1.1 }}
                >
                  <item.icon className="w-7 h-7 text-primary" />
                </motion.div>
                <div className="flex-1 pt-1">
                  <h4 className="text-2xl text-foreground mb-2 group-hover:text-primary transition-colors duration-300">
                    {item.title}
                  </h4>
                  <p className="text-lg text-muted-foreground">{item.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>
    </>
  );
}
