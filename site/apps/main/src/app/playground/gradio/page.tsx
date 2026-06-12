"use client";

import { Footer, Header, PlaygroundSectionHeader, PlaygroundTemplateCard } from "@hypercli/shared-ui";
import Link from "next/link";
import { motion } from "framer-motion";
import templatesIndex from "@/content/gradio/index.json";

type Template = {
  template_id: string;
  title: string;
  description: string;
  docker_image: string;
  output_type: string;
  tags: string[];
  gpu_requirements: string;
  port: number;
};

export default function GradioPlayground() {
  const templates = templatesIndex.templates as Template[];

  // Group by output type
  const audioTemplates = templates.filter(t => t.output_type === "audio");
  const otherTemplates = templates.filter(t => t.output_type !== "audio");

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
              <span className="text-foreground font-medium">Gradio Templates</span>
            </nav>
            <h1 className="text-6xl sm:text-7xl lg:text-8xl text-foreground mb-8 leading-[1.1] tracking-tight">
              Gradio Templates
            </h1>
            <p className="text-2xl text-muted-foreground leading-relaxed max-w-2xl">
              Ready-to-run Gradio applications for audio, speech, and more.
              Deploy on HyperCLI GPUs with Docker.
            </p>
          </motion.div>
        </section>

        {/* Templates Sections */}
        <section className="pt-20 pb-32 px-4 sm:px-6 lg:px-8 bg-background border-t border-border-medium/30">
          <div className="max-w-5xl mx-auto">
            {/* Audio Templates */}
            {audioTemplates.length > 0 && (
              <div className="mb-16">
                <PlaygroundSectionHeader
                  icon={
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  }
                  title="Audio & Speech"
                  count={audioTemplates.length}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {audioTemplates.map((template) => (
                    <PlaygroundTemplateCard
                      key={template.template_id}
                      href={`/playground/gradio/${template.template_id}`}
                      title={template.title}
                      description={template.description}
                      thumbnailSrc={`/gradio/${template.template_id}/thumbnail.webp`}
                      outputType={template.output_type}
                      aspect="video"
                      mediaBadge={
                        <svg className="h-3 w-3 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" y1="19" x2="12" y2="23" />
                          <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                      }
                      tags={template.tags}
                      onImageError={(event) => {
                        const target = event.currentTarget;
                        target.style.display = "none";
                        target.parentElement?.classList.add("bg-gradient-to-br", "from-primary/20", "to-primary/5");
                      }}
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {otherTemplates.map((template) => (
                    <PlaygroundTemplateCard
                      key={template.template_id}
                      href={`/playground/gradio/${template.template_id}`}
                      title={template.title}
                      description={template.description}
                      thumbnailSrc={`/gradio/${template.template_id}/thumbnail.webp`}
                      outputType={template.output_type}
                      aspect="video"
                      mediaBadge={
                        <svg className="h-3 w-3 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          <line x1="12" y1="19" x2="12" y2="23" />
                          <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                      }
                      tags={template.tags}
                      onImageError={(event) => {
                        const target = event.currentTarget;
                        target.style.display = "none";
                        target.parentElement?.classList.add("bg-gradient-to-br", "from-primary/20", "to-primary/5");
                      }}
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
