"use client";

import { Header, Footer } from "@hypercli/shared-ui";
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

function TemplateCard({ template }: { template: Template }) {
  const thumbnailPath = `/gradio/${template.template_id}/thumbnail.webp`;

  return (
    <Link
      href={`/playground/gradio/${template.template_id}`}
      className="group block bg-surface-low/40 border border-border-medium/50 rounded-lg overflow-hidden hover:bg-surface-low/60 transition-colors"
    >
      <div className="aspect-video bg-background relative overflow-hidden">
        <img
          src={thumbnailPath}
          alt={template.title}
          className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-300"
          onError={(e) => {
            // Fallback to a gradient placeholder if thumbnail doesn't exist
            const target = e.target as HTMLImageElement;
            target.style.display = "none";
            target.parentElement!.classList.add("bg-gradient-to-br", "from-primary/20", "to-primary/5");
          }}
        />
        {/* Audio indicator */}
        <div className="absolute bottom-2 left-2 bg-primary/20 backdrop-blur-sm p-1.5 rounded-full border border-primary/30">
          <svg className="h-3 w-3 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>
        <div className="absolute top-2 right-2 bg-surface-low/80 backdrop-blur-sm px-2 py-0.5 rounded text-xs font-medium text-muted-foreground border border-border-medium/50">
          {template.output_type}
        </div>
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-white group-hover:text-primary transition-colors text-base leading-tight mb-2">
          {template.title}
        </h3>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {template.description}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {template.tags.slice(0, 3).map((tag, i) => (
            <span
              key={i}
              className="px-2 py-0.5 bg-primary/10 border border-primary/20 text-primary rounded text-xs font-medium"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
        {icon}
      </div>
      <h2 className="text-2xl font-bold text-white">{title}</h2>
      <span className="text-sm font-medium text-muted-foreground bg-surface-low/40 px-2 py-1 rounded-full border border-border-medium/50">
        {count}
      </span>
    </div>
  );
}

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
              <span className="text-muted mx-2">/</span>
              <span className="text-white font-medium">Gradio Templates</span>
            </nav>
            <h1 className="text-6xl sm:text-7xl lg:text-8xl text-white mb-8 leading-[1.1] tracking-tight">
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
                <SectionHeader
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
