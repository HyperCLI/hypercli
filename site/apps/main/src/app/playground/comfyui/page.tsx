"use client";

import { Header, Footer } from "@hypercli/shared-ui";
import Link from "next/link";
import { motion } from "framer-motion";
import templatesIndex from "@/content/comfyui/index.json";

type Template = {
  template_id: string;
  title: string;
  description: string;
  bundle: string;
  output_type: string;
  tags: string[];
};

function TemplateCard({ template }: { template: Template }) {
  const isVideo = template.output_type === "video";

  return (
    <Link
      href={`/playground/comfyui/${template.template_id}`}
      className="group block bg-[#161819]/40 border border-[#2A2D2F]/50 rounded-lg overflow-hidden hover:bg-[#161819]/60 transition-colors"
    >
      <div className="aspect-square bg-[#0B0D0E] relative overflow-hidden">
        {/* Animated webp auto-plays and loops natively in img tags */}
        <img
          src={`/comfyui/${template.template_id}/thumbnail.webp`}
          alt={template.title}
          className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
        />
        {/* Play indicator for video templates */}
        {isVideo && (
          <div className="absolute bottom-2 left-2 bg-[#38D39F]/20 backdrop-blur-sm p-1.5 rounded-full border border-[#38D39F]/30">
            <svg className="h-3 w-3 text-[#38D39F]" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
        )}
        <div className="absolute top-2 right-2 bg-[#161819]/80 backdrop-blur-sm px-2 py-0.5 rounded text-xs font-medium text-[#9BA0A2] border border-[#2A2D2F]/50">
          {template.output_type}
        </div>
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-white group-hover:text-[#38D39F] transition-colors text-sm leading-tight">
          {template.title}
        </h3>
        {template.description && (
          <p className="text-xs text-[#9BA0A2] mt-1 line-clamp-2">
            {template.description}
          </p>
        )}
      </div>
    </Link>
  );
}

function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="h-10 w-10 rounded-lg bg-[#38D39F]/10 text-[#38D39F] flex items-center justify-center">
        {icon}
      </div>
      <h2 className="text-2xl font-bold text-white">{title}</h2>
      <span className="text-sm font-medium text-[#9BA0A2] bg-[#161819]/40 px-2 py-1 rounded-full border border-[#2A2D2F]/50">{count}</span>
    </div>
  );
}

export default function ComfyUIPlayground() {
  const templates = templatesIndex.templates as Template[];

  // Group by output type
  const videoTemplates = templates.filter(t => t.output_type === "video");
  const imageTemplates = templates.filter(t => t.output_type === "image");
  const threeDTemplates = templates.filter(t => t.output_type === "3D");
  const otherTemplates = templates.filter(t => !["video", "image", "3D"].includes(t.output_type));

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
            <nav className="mb-6 text-sm">
              <Link href="/playground" className="text-[#9BA0A2] hover:text-[#38D39F] hover:underline transition-colors">
                Playground
              </Link>
              <span className="text-[#6B7075] mx-2">/</span>
              <span className="text-white font-medium">ComfyUI Templates</span>
            </nav>
            <h1 className="text-6xl sm:text-7xl lg:text-8xl text-white mb-8 leading-[1.1] tracking-tight">
              ComfyUI Templates
            </h1>
            <p className="text-2xl text-[#9BA0A2] leading-relaxed max-w-2xl">
              Production-ready workflows for video generation, image creation, and more.
              Run on HyperCLI GPUs with a single command.
            </p>
          </motion.div>
        </section>

        {/* Templates Sections */}
        <section className="pt-20 pb-32 px-4 sm:px-6 lg:px-8 bg-[#0B0D0E] border-t border-[#2A2D2F]/30">
          <div className="max-w-5xl mx-auto">
            {/* Video Templates */}
            {videoTemplates.length > 0 && (
              <div className="mb-16">
                <SectionHeader
                  icon={
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  }
                  title="Video Generation"
                  count={videoTemplates.length}
                />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {videoTemplates.map((template) => (
                    <TemplateCard key={template.template_id} template={template} />
                  ))}
                </div>
              </div>
            )}

            {/* Image Templates */}
            {imageTemplates.length > 0 && (
              <div className="mb-16">
                <SectionHeader
                  icon={
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  }
                  title="Image Generation"
                  count={imageTemplates.length}
                />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {imageTemplates.map((template) => (
                    <TemplateCard key={template.template_id} template={template} />
                  ))}
                </div>
              </div>
            )}

            {/* 3D Templates */}
            {threeDTemplates.length > 0 && (
              <div className="mb-16">
                <SectionHeader
                  icon={
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    </svg>
                  }
                  title="3D Generation"
                  count={threeDTemplates.length}
                />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {threeDTemplates.map((template) => (
                    <TemplateCard key={template.template_id} template={template} />
                  ))}
                </div>
              </div>
            )}

            {/* Other Templates */}
            {otherTemplates.length > 0 && (
              <div className="mb-16">
                <SectionHeader
                  icon={
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                  }
                  title="Other"
                  count={otherTemplates.length}
                />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {otherTemplates.map((template) => (
                    <TemplateCard key={template.template_id} template={template} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
