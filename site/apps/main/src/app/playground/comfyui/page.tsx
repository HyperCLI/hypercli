"use client";

import { Footer, Header, PlaygroundSectionHeader, PlaygroundTemplateCard } from "@hypercli/shared-ui";
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

export default function ComfyUIPlayground() {
  const templates = templatesIndex.templates as Template[];

  // Group by output type
  const videoTemplates = templates.filter(t => t.output_type === "video");
  const imageTemplates = templates.filter(t => t.output_type === "image");
  const threeDTemplates = templates.filter(t => t.output_type === "3D");
  const otherTemplates = templates.filter(t => !["video", "image", "3D"].includes(t.output_type));

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
            <nav className="mb-6 text-sm">
              <Link href="/playground" className="text-muted-foreground hover:text-primary hover:underline transition-colors">
                Playground
              </Link>
              <span className="text-text-muted mx-2">/</span>
              <span className="text-foreground font-medium">ComfyUI Templates</span>
            </nav>
            <h1 className="text-6xl sm:text-7xl lg:text-8xl text-foreground mb-8 leading-[1.1] tracking-tight">
              ComfyUI Templates
            </h1>
            <p className="text-2xl text-muted-foreground leading-relaxed max-w-2xl">
              Production-ready workflows for video generation, image creation, and more.
              Run on HyperCLI GPUs with a single command.
            </p>
          </motion.div>
        </section>

        {/* Templates Sections */}
        <section className="pt-20 pb-32 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
          <div className="max-w-5xl mx-auto">
            {/* Video Templates */}
            {videoTemplates.length > 0 && (
              <div className="mb-16">
                <PlaygroundSectionHeader
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
                    <PlaygroundTemplateCard
                      key={template.template_id}
                      href={`/playground/comfyui/${template.template_id}`}
                      title={template.title}
                      description={template.description}
                      thumbnailSrc={`/comfyui/${template.template_id}/thumbnail.webp`}
                      outputType={template.output_type}
                      aspect="square"
                      mediaBadge={
                        <svg className="h-3 w-3 text-primary" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Image Templates */}
            {imageTemplates.length > 0 && (
              <div className="mb-16">
                <PlaygroundSectionHeader
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
                    <PlaygroundTemplateCard
                      key={template.template_id}
                      href={`/playground/comfyui/${template.template_id}`}
                      title={template.title}
                      description={template.description}
                      thumbnailSrc={`/comfyui/${template.template_id}/thumbnail.webp`}
                      outputType={template.output_type}
                      aspect="square"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 3D Templates */}
            {threeDTemplates.length > 0 && (
              <div className="mb-16">
                <PlaygroundSectionHeader
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
                    <PlaygroundTemplateCard
                      key={template.template_id}
                      href={`/playground/comfyui/${template.template_id}`}
                      title={template.title}
                      description={template.description}
                      thumbnailSrc={`/comfyui/${template.template_id}/thumbnail.webp`}
                      outputType={template.output_type}
                      aspect="square"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Other Templates */}
            {otherTemplates.length > 0 && (
              <div className="mb-16">
                <PlaygroundSectionHeader
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
                    <PlaygroundTemplateCard
                      key={template.template_id}
                      href={`/playground/comfyui/${template.template_id}`}
                      title={template.title}
                      description={template.description}
                      thumbnailSrc={`/comfyui/${template.template_id}/thumbnail.webp`}
                      outputType={template.output_type}
                      aspect="square"
                    />
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
