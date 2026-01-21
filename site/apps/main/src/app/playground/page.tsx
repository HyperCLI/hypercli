"use client";

import { Header, Footer } from "@hypercli/shared-ui";
import Link from "next/link";
import { motion } from "framer-motion";

const playgrounds = [
  {
    id: "comfyui",
    title: "ComfyUI Templates",
    description: "Production-ready workflows for video generation, image creation, and 3D modeling. Run on HyperCLI GPUs.",
    icon: (
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M7 4h10a3 3 0 013 3v10a3 3 0 01-3 3H7a3 3 0 01-3-3V7a3 3 0 013-3z" />
        <path d="M7 15l3-3 3 3 4-4" />
      </svg>
    ),
    count: 32,
    href: "/playground/comfyui",
  },
];

export default function PlaygroundIndex() {
  return (
    <div className="bg-[#0B0D0E] min-h-screen">
      <Header />
      <main>
        {/* Hero Section */}
        <section className="relative pt-32 pb-24 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E]">
          <motion.div 
            className="max-w-5xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-6xl sm:text-7xl lg:text-8xl text-white mb-8 leading-[1.1] tracking-tight">
              Playground
            </h1>
            <p className="text-2xl text-[#9BA0A2] leading-relaxed max-w-2xl">
              Ready-to-run templates and workflows. Pick one, customize it, and run on GPU.
            </p>
          </motion.div>
        </section>

        {/* Playground tiles */}
        <section className="pt-20 pb-32 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {playgrounds.map((pg, index) => (
                <motion.div
                  key={pg.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                >
                  <Link
                    href={pg.href}
                    className="group block bg-[#161819]/40 border border-[#2A2D2F]/50 p-8 rounded-lg hover:bg-[#161819]/60 transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-11 w-11 rounded-lg bg-[#38D39F]/10 text-[#38D39F] flex items-center justify-center">
                        {pg.icon}
                      </div>
                      <h2 className="text-2xl font-semibold text-white group-hover:text-[#38D39F] transition-colors">
                        {pg.title}
                      </h2>
                    </div>
                    <p className="text-[#9BA0A2] mb-6 leading-relaxed">{pg.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#6B7075]">{pg.count} templates</span>
                      <span className="text-[#38D39F] text-sm font-medium group-hover:translate-x-1 transition-transform">
                        Browse →
                      </span>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
