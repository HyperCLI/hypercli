"use client";

import {
  Cpu,
  Database,
  Network,
  Gauge,
  Shield,
  BarChart3,
  Activity,
  ArrowRight,
} from "lucide-react";
import {
  motion,
  useScroll,
  useTransform,
  useInView,
  useSpring,
} from "framer-motion";
import { useRef } from "react";

export function WhatIsHyperCLISection() {
  const features = [
    { icon: Cpu, title: "GPU scheduling & placement" },
    { icon: Network, title: "Distributed execution" },
    { icon: Database, title: "GPU splitting" },
    { icon: Gauge, title: "Model loading & caching" },
    { icon: Shield, title: "Failover & autoscaling" },
    { icon: BarChart3, title: "Cost optimization" },
    { icon: Activity, title: "Logging & observability" },
  ];

  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const isContentInView = useInView(contentRef, {
    once: true,
    margin: "-100px",
  });
  const isFlowInView = useInView(flowRef, {
    once: true,
    margin: "-50px",
  });

  const { scrollYProgress: rawScrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  const scrollYProgress = useSpring(rawScrollYProgress, {
    stiffness: 90,
    damping: 24,
    mass: 0.35,
  });

  const chapterY = useTransform(
    scrollYProgress,
    [0, 0.2, 0.8, 1],
    [30, 0, 0, -30],
  );
  const chapterOpacity = useTransform(
    scrollYProgress,
    [0, 0.15, 0.6, 0.85],
    [0.12, 1, 1, 0.12],
  );
  const chapterScale = useTransform(
    scrollYProgress,
    [0, 0.2],
    [0.98, 1],
  );

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
          style={{
            y: chapterY,
            opacity: chapterOpacity,
            scale: chapterScale,
          }}
        >
          <div className="inline-block">
            <h2 className="text-[56px] sm:text-[72px] lg:text-[96px] xl:text-[120px] text-white leading-[0.9] tracking-[-0.05em] font-bold">
              Why HyperCLI?
            </h2>
            <motion.div
              className="h-2 bg-[#38D39F] mt-12 w-full"
              initial={{ width: 0 }}
              whileInView={{ width: "100%" }}
              transition={{ duration: 0.8, delay: 0.3 }}
            />
          </div>
        </motion.div>
      </section>

      {/* Section Content */}
      <section className="relative py-24 px-4 sm:px-6 lg:px-8 overflow-hidden bg-[#0D0F10]">
        {/* Grain texture */}
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />

        {/* Subtle left-side lighting with parallax */}
        <motion.div
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#38D39F]/3 blur-[120px] rounded-full pointer-events-none opacity-60"
          style={{
            y: useTransform(scrollYProgress, [0, 1], [50, -50]),
          }}
        />

        <div className="max-w-7xl mx-auto relative">
          {/* Section title */}
          <motion.div
            ref={contentRef}
            className="mb-20"
            initial={{ opacity: 0, y: 40 }}
            animate={
              isContentInView
                ? { opacity: 1, y: 0 }
                : { opacity: 0, y: 40 }
            }
            transition={{
              duration: 0.8,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <h3 className="text-5xl sm:text-6xl text-white mb-8 leading-[1.05] tracking-tight max-w-4xl">
              The universal runtime + orchestration layer for
              modern AI
            </h3>
            <p className="text-xl text-[#9BA0A2] max-w-2xl leading-relaxed">
              HyperCLI handles everything under the hood:
            </p>
          </motion.div>

          {/* Asymmetric split layout */}
          <div className="grid lg:grid-cols-[1.3fr_0.7fr] gap-20 items-start">
            {/* Left: Floating feature list with stagger */}
            <div className="space-y-6">
              {features.map((feature, index) => (
                <motion.div
                  key={index}
                  className="group flex items-center gap-5"
                  initial={{ opacity: 0, x: -30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{
                    duration: 0.5,
                    delay: index * 0.08,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  whileHover={{ x: 8 }}
                >
                  <motion.div
                    className="w-11 h-11 rounded-xl bg-[#38D39F]/6 flex items-center justify-center flex-shrink-0 group-hover:bg-[#38D39F]/12 transition-colors"
                    whileHover={{ scale: 1.15 }}
                  >
                    <feature.icon className="w-6 h-6 text-[#38D39F]" />
                  </motion.div>
                  <p className="text-lg text-[#D4D6D7] group-hover:text-white transition-colors">
                    {feature.title}
                  </p>
                </motion.div>
              ))}
            </div>

            {/* Right: Flow visualization */}
            <motion.div
              ref={flowRef}
              className="lg:pt-16 space-y-10"
              initial={{ opacity: 0 }}
              animate={
                isFlowInView ? { opacity: 1 } : { opacity: 0 }
              }
              transition={{ duration: 0.6, delay: 0.5 }}
            >
              <motion.div
                className="relative"
                initial={{ opacity: 0, y: 20 }}
                animate={
                  isFlowInView
                    ? { opacity: 1, y: 0 }
                    : { opacity: 0, y: 20 }
                }
                transition={{ duration: 0.5, delay: 0.6 }}
              >
                <div className="text-lg text-[#9BA0A2] mb-3">
                  You write code
                </div>
                <motion.div
                  className="w-full h-[2px] bg-gradient-to-r from-[#38D39F]/30 to-transparent"
                  initial={{ scaleX: 0 }}
                  animate={
                    isFlowInView ? { scaleX: 1 } : { scaleX: 0 }
                  }
                  transition={{ duration: 0.6, delay: 0.7 }}
                  style={{ transformOrigin: "left" }}
                />
              </motion.div>

              <motion.div
                className="flex items-center"
                initial={{ opacity: 0 }}
                animate={
                  isFlowInView ? { opacity: 1 } : { opacity: 0 }
                }
                transition={{ duration: 0.3, delay: 1.0 }}
              >
                <ArrowRight className="w-7 h-7 text-[#38D39F]/40" />
              </motion.div>

              <motion.div
                className="relative"
                initial={{ opacity: 0, y: 20 }}
                animate={
                  isFlowInView
                    ? { opacity: 1, y: 0 }
                    : { opacity: 0, y: 20 }
                }
                transition={{ duration: 0.5, delay: 1.1 }}
              >
                <div className="text-lg text-[#D4D6D7] mb-3">
                  HyperCLI runs it anywhere
                </div>
                <motion.div
                  className="w-full h-[2px] bg-gradient-to-r from-[#38D39F]/50 to-transparent"
                  initial={{ scaleX: 0 }}
                  animate={
                    isFlowInView ? { scaleX: 1 } : { scaleX: 0 }
                  }
                  transition={{ duration: 0.6, delay: 1.2 }}
                  style={{ transformOrigin: "left" }}
                />
              </motion.div>

              <motion.div
                className="flex items-center"
                initial={{ opacity: 0 }}
                animate={
                  isFlowInView ? { opacity: 1 } : { opacity: 0 }
                }
                transition={{ duration: 0.3, delay: 1.5 }}
              >
                <ArrowRight className="w-7 h-7 text-[#38D39F]/60" />
              </motion.div>

              <motion.div
                className="relative"
                initial={{ opacity: 0, y: 20 }}
                animate={
                  isFlowInView
                    ? { opacity: 1, y: 0 }
                    : { opacity: 0, y: 20 }
                }
                transition={{ duration: 0.5, delay: 1.6 }}
              >
                <div className="text-xl text-white mb-3">
                  It scales automatically
                </div>
                <motion.div
                  className="w-full h-[3px] bg-gradient-to-r from-[#38D39F] to-transparent shadow-[0_0_15px_rgba(56,211,159,0.3)]"
                  initial={{ scaleX: 0 }}
                  animate={
                    isFlowInView ? { scaleX: 1 } : { scaleX: 0 }
                  }
                  transition={{ duration: 0.8, delay: 1.7 }}
                  style={{ transformOrigin: "left" }}
                />
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>
    </>
  );
}
