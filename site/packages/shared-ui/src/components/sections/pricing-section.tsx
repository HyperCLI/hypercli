"use client";

import { Check, ArrowRight } from 'lucide-react';
import { motion, useScroll, useTransform, useInView } from 'framer-motion';
import { useRef } from 'react';

export function PricingSection() {
  const features = [
    'Free tier with GPU credits',
    'Pay-as-you-go compute',
    'Team & enterprise plans',
    'No hidden fees',
    'Bring your own GPUs (optional)'
  ];

  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(contentRef, { once: true, margin: "-100px" });
  
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"]
  });

  const chapterY = useTransform(scrollYProgress, [0, 0.3, 0.7, 1], [100, 0, 0, -100]);
  const chapterOpacity = useTransform(scrollYProgress, [0, 0.2, 0.5, 0.7], [0, 1, 1, 0]);
  const chapterScale = useTransform(scrollYProgress, [0, 0.3], [0.9, 1]);

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
          className="max-w-7xl w-full"
          style={{ y: chapterY, opacity: chapterOpacity, scale: chapterScale }}
        >
          <div className="inline-block">
            <h2 className="text-[56px] sm:text-[72px] lg:text-[96px] xl:text-[120px] text-white leading-[0.9] tracking-[-0.05em] font-bold">
              Pricing
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
        
        {/* Subtle bottom-left lighting with parallax */}
        <motion.div 
          className="absolute left-0 bottom-1/4 w-[500px] h-[400px] bg-[#38D39F]/3 blur-[120px] rounded-full pointer-events-none opacity-60"
          style={{ y: useTransform(scrollYProgress, [0, 1], [30, -30]) }}
        />
        
        <div className="max-w-7xl mx-auto relative">
          {/* Section title */}
          <motion.div 
            ref={contentRef}
            className="mb-20"
            initial={{ opacity: 0, y: 40 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <h3 className="text-5xl sm:text-6xl text-white mb-8 leading-[1.05] tracking-tight max-w-4xl">
              Simple, transparent, usage-based
            </h3>
          </motion.div>

          {/* Two-column asymmetric layout */}
          <div className="grid lg:grid-cols-[1fr_0.5fr] gap-20 items-start">
            {/* Left: Feature list with stagger */}
            <div>
              <ul className="space-y-6">
                {features.map((feature, idx) => (
                  <motion.li 
                    key={idx} 
                    className="flex items-start gap-5 group"
                    initial={{ opacity: 0, x: -30 }}
                    animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
                    transition={{ 
                      duration: 0.6, 
                      delay: 0.3 + idx * 0.1,
                      ease: [0.22, 1, 0.36, 1]
                    }}
                    whileHover={{ x: 8 }}
                  >
                    <motion.div 
                      className="w-10 h-10 rounded-lg bg-[#38D39F]/8 flex items-center justify-center flex-shrink-0 group-hover:bg-[#38D39F]/15 transition-colors"
                      whileHover={{ scale: 1.15 }}
                    >
                      <Check className="w-5 h-5 text-[#38D39F]" />
                    </motion.div>
                    <span className="text-xl text-[#D4D6D7] group-hover:text-white transition-colors pt-1.5">{feature}</span>
                  </motion.li>
                ))}
              </ul>
            </div>

            {/* Right: CTA */}
            <motion.div 
              className="lg:pt-8"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={isInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.6, delay: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
              <motion.button 
                className="group px-10 py-5 bg-[#38D39F] text-[#0B0D0E] rounded-xl hover:bg-[#45E4AE] transition-all duration-300 flex items-center gap-3 text-lg font-medium shadow-[0_0_30px_rgba(56,211,159,0.25)]"
                whileHover={{ 
                  scale: 1.05,
                  boxShadow: '0 0 50px rgba(56,211,159,0.35)'
                }}
                whileTap={{ scale: 0.98 }}
              >
                See Pricing
                <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
              </motion.button>
            </motion.div>
          </div>
        </div>
      </section>
    </>
  );
}