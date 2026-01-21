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
    <div className="bg-background min-h-screen">
      <Header />
      <main>
        {/* Hero Section */}
        <section className="relative pt-32 pb-24 px-4 sm:px-6 lg:px-8 bg-background">
          <motion.div 
            className="max-w-5xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-6xl sm:text-7xl lg:text-8xl text-white mb-8 leading-[1.1] tracking-tight">
              Playground
            </h1>
            <p className="text-2xl text-muted-foreground leading-relaxed max-w-2xl">
              Ready-to-run templates and workflows. Pick one, customize it, and run on GPU.
            </p>
          </motion.div>
        </section>

        {/* Playground tiles */}
        <section className="pt-20 pb-32 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
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
                    className="group block bg-surface-low/40 border border-border-medium/50 p-8 rounded-lg hover:bg-surface-low/60 transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className="h-11 w-11 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                        {pg.icon}
                      </div>
                      <h2 className="text-2xl font-semibold text-white group-hover:text-primary transition-colors">
                        {pg.title}
                      </h2>
                    </div>
                    <p className="text-muted-foreground mb-6 leading-relaxed">{pg.description}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted">{pg.count} templates</span>
                      <span className="text-primary text-sm font-medium group-hover:translate-x-1 transition-transform">
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
