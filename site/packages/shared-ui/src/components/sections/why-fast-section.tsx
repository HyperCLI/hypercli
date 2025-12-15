"use client";

import { Cloud, Zap, Gauge, Cpu, Layers, TrendingUp } from 'lucide-react';
import { motion, useScroll, useTransform, useInView, useSpring } from 'framer-motion';
import { useRef } from 'react';

export function WhyFastSection() {
  const features = [
    {
      icon: Cloud,
      title: 'Multi-cloud + on-prem + data center routing'
    },
    {
      icon: Zap,
      title: 'Accelerated runtimes (vLLM, SGLang, TensorRT-LLM)'
    },
    {
      icon: Gauge,
      title: 'Quantization and model optimization baked in'
    },
    {
      icon: Cpu,
      title: 'GPU splitting (1 GPU → multiple workloads)'
    },
    {
      icon: TrendingUp,
      title: 'Predictive autoscaling'
    },
    {
      icon: Layers,
      title: 'Fast cold starts'
    }
  ];

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
          <h2 className="text-[56px] sm:text-[72px] lg:text-[96px] xl:text-[120px] !text-[#0B0D0E] leading-[0.9] tracking-[-0.05em] font-bold max-w-7xl mx-auto">
            Why HyperCLI is so fast
          </h2>
        </motion.div>
      </section>

      {/* Section Content */}
      <section className="relative py-24 px-4 sm:px-6 lg:px-8 overflow-hidden bg-[#0B0D0E]">
        {/* Grain texture */}
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />
        
        {/* Subtle centered radial vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#0B0D0E_70%)] pointer-events-none" />
        
        <div className="max-w-7xl mx-auto relative">
          {/* Section title */}
          <motion.div 
            ref={contentRef}
            className="mb-20 text-center"
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <h3 className="text-5xl sm:text-6xl text-white mb-8 leading-[1.05] tracking-tight max-w-5xl mx-auto">
              Built on a high-performance orchestration engine
            </h3>
            <p className="text-xl text-[#9BA0A2] max-w-3xl mx-auto leading-relaxed">
              HyperCLI&apos;s infrastructure fabric is optimized for low latency and maximum throughput:
            </p>
          </motion.div>

          {/* 3-column grid with stagger */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-12 mb-20 max-w-6xl mx-auto">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                className="group flex flex-col items-center text-center"
                initial={{ opacity: 0, y: 30 }}
                animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
                transition={{ 
                  duration: 0.6, 
                  delay: 0.3 + index * 0.1,
                  ease: [0.22, 1, 0.36, 1]
                }}
                whileHover={{ y: -8 }}
              >
                <motion.div 
                  className="w-14 h-14 rounded-xl bg-[#38D39F]/8 flex items-center justify-center mb-5 group-hover:bg-[#38D39F]/15 transition-colors duration-300"
                  whileHover={{ scale: 1.2 }}
                >
                  <feature.icon className="w-7 h-7 text-[#38D39F]" />
                </motion.div>
                <p className="text-lg text-[#D4D6D7] group-hover:text-white transition-colors leading-relaxed">{feature.title}</p>
              </motion.div>
            ))}
          </div>

          {/* Bottom emphasis with reveal */}
          <motion.div 
            className="pt-12 border-t border-[#1F2122]/50 text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
            transition={{ duration: 0.8, delay: 1.0, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="text-3xl text-white leading-relaxed max-w-4xl mx-auto">
              The result: <motion.span 
                className="text-[#38D39F]"
                initial={{ opacity: 0 }}
                animate={isInView ? { opacity: 1 } : { opacity: 0 }}
                transition={{ duration: 0.6, delay: 1.3 }}
              >
                deployments measured in seconds, not hours
              </motion.span>.
            </p>
          </motion.div>
        </div>
      </section>
    </>
  );
}
