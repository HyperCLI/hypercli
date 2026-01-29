import { Header, Footer } from "@hypercli/shared-ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import templatesIndex from "@/content/gradio/index.json";
import ClientParticleCanvas from "@/components/ClientParticleCanvas";
import CopyButton from "./CopyButton";
import ThumbnailImage from "./ThumbnailImage";

type Template = {
  template_id: string;
  title: string;
  description: string;
  docker_image: string;
  output_type: string;
  tags: string[];
  gpu_requirements: string;
  port: number;
  env_vars?: Record<string, string>;
  models?: { name: string; size: string; type: string }[];
  features?: string[];
  source_repo?: string;
  https_lb?: boolean;
  auth?: boolean;
};

function buildLaunchUrl(template: Template): string {
  const consoleUrl = process.env.NEXT_PUBLIC_CONSOLE_URL || 'https://console.hypercli.com';
  const params = new URLSearchParams({
    image: template.docker_image,
    port: String(template.port),
    gpu: 'l40s',
    runtime: '3600',
  });
  if (template.env_vars && Object.keys(template.env_vars).length > 0) {
    params.set('env', JSON.stringify(template.env_vars));
  }
  if (template.auth) {
    params.set('auth', 'true');
  }
  return `${consoleUrl}/job?${params.toString()}`;
}

export async function generateStaticParams() {
  return templatesIndex.templates.map((t: Template) => ({
    template: t.template_id,
  }));
}

export default async function GradioTemplatePage({ params }: { params: Promise<{ template: string }> }) {
  const { template: templateId } = await params;

  const template = templatesIndex.templates.find(
    (t: Template) => t.template_id === templateId
  ) as Template | undefined;

  if (!template) {
    notFound();
  }

  const thumbnailPath = `/gradio/${template.template_id}/thumbnail.webp`;

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background">
        {/* Hero Section */}
        <div className="relative py-16 sm:py-24 bg-background overflow-hidden border-b border-white/5">
          <ClientParticleCanvas />
          <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]"></div>
          <div className="relative z-20 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Breadcrumb */}
            <nav className="mb-8 text-sm">
              <Link href="/playground" className="text-muted-foreground hover:text-primary hover:underline transition-colors">
                Playground
              </Link>
              <span className="text-muted-foreground/40 mx-2">/</span>
              <Link href="/playground/gradio" className="text-muted-foreground hover:text-primary hover:underline transition-colors">
                Gradio Templates
              </Link>
              <span className="text-muted-foreground/40 mx-2">/</span>
              <span className="text-white font-medium">{template.title}</span>
            </nav>

            {/* Two Column Hero */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
              {/* Left Column - Info */}
              <div>
                {/* Tags */}
                <div className="flex flex-wrap items-center gap-2 mb-6">
                  <span className="px-4 py-1.5 bg-surface-low border border-white/10 rounded-full text-sm font-medium text-secondary-foreground">
                    {template.output_type}
                  </span>
                  {template.tags?.map((tag, i) => (
                    <span key={i} className="px-4 py-1.5 bg-primary/10 border border-primary/20 text-primary rounded-full text-sm font-medium">
                      {tag}
                    </span>
                  ))}
                </div>

                <h1 className="text-[40px] sm:text-[48px] lg:text-[56px] font-bold tracking-[-0.03em] text-white leading-[1.05] mb-6">
                  {template.title}
                </h1>

                <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
                  {template.description}
                </p>

                {/* Quick Actions */}
                <div className="flex flex-wrap gap-4">
                  <a
                    href={buildLaunchUrl(template)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground rounded-xl hover:bg-primary-hover transition-all font-semibold shadow-[0_0_30px_rgba(56,211,159,0.25)]"
                  >
                    Launch on GPU
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </a>
                  <Link
                    href="#usage"
                    className="inline-flex items-center gap-2 px-8 py-4 bg-surface-low border border-white/10 text-white font-semibold rounded-xl hover:bg-surface-high hover:border-white/20 transition-all"
                  >
                    Get Started
                  </Link>
                </div>
              </div>

              {/* Right Column - Thumbnail */}
              <div className="bg-surface-low rounded-2xl overflow-hidden border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
                <div className="aspect-video relative bg-gradient-to-br from-primary/20 to-primary/5">
                  <ThumbnailImage src={thumbnailPath} alt={template.title} />
                  {/* Fallback content when no thumbnail */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <svg className="h-16 w-16 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content Section */}
        <section className="py-16 sm:py-20 bg-background">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Features */}
            {template.features && template.features.length > 0 && (
              <div className="mb-16">
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">Features</h2>
                <ul className="space-y-4">
                  {template.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                      <span className="text-secondary-foreground leading-relaxed">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Requirements */}
            <div className="mb-16">
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">Requirements</h2>
              <div className="bg-background border border-white/10 rounded-xl overflow-hidden">
                <table className="w-full">
                  <tbody>
                    <tr className="border-b border-white/5">
                      <td className="py-4 px-5 text-muted-foreground font-medium">GPU</td>
                      <td className="py-4 px-5 text-secondary-foreground">{template.gpu_requirements}</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="py-4 px-5 text-muted-foreground font-medium">Docker Image</td>
                      <td className="py-4 px-5">
                        <code className="bg-surface-low px-2.5 py-1 rounded text-sm font-mono text-primary">
                          {template.docker_image}
                        </code>
                      </td>
                    </tr>
                    <tr>
                      <td className="py-4 px-5 text-muted-foreground font-medium">Port</td>
                      <td className="py-4 px-5 text-secondary-foreground">{template.port}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Models */}
            {template.models && template.models.length > 0 && (
              <div className="mb-16">
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">Available Models</h2>
                <div className="bg-background border border-white/10 rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-surface-low border-b border-white/5">
                        <th className="text-left py-4 px-5 font-semibold text-muted-foreground">Model</th>
                        <th className="text-left py-4 px-5 font-semibold text-muted-foreground">Size</th>
                        <th className="text-left py-4 px-5 font-semibold text-muted-foreground">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {template.models.map((model, i) => (
                        <tr key={i} className="border-b border-white/5 last:border-0">
                          <td className="py-4 px-5">
                            <code className="bg-surface-low px-2.5 py-1 rounded text-sm font-mono text-primary">
                              {model.name}
                            </code>
                          </td>
                          <td className="py-4 px-5 text-secondary-foreground">{model.size}</td>
                          <td className="py-4 px-5 text-secondary-foreground">{model.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Usage */}
            <div id="usage" className="mb-16 scroll-mt-8">
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">Usage</h2>

              {/* Python SDK */}
              <div className="mb-8">
                <h3 className="text-xl font-semibold text-white mb-4">Python SDK</h3>
                <div className="bg-background border border-white/10 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-surface-low border-b border-white/5">
                    <span className="text-xs text-muted-foreground font-mono">python</span>
                    <CopyButton text={`from hypercli import HyperCLI

client = HyperCLI()

# Launch ${template.title}
job = client.jobs.create(
    image="${template.docker_image}",
    gpu_type="l40s",
    ports={"lb": ${template.port}},${template.env_vars && Object.keys(template.env_vars).length > 0 ? `
    env=${JSON.stringify(template.env_vars).replace(/"/g, '"')},` : ''}${template.auth ? `
    auth=True,` : ''}
)

print(f"Job {job.job_id} launched!")
print(f"Access at: https://{job.job_id}.job.hypercli.com")`} />
                  </div>
                  <pre className="p-6 text-sm text-secondary-foreground overflow-x-auto leading-relaxed">
                    <code className="font-mono">{`from hypercli import HyperCLI

client = HyperCLI()

# Launch ${template.title}
job = client.jobs.create(
    image="${template.docker_image}",
    gpu_type="l40s",
    ports={"lb": ${template.port}},${template.env_vars && Object.keys(template.env_vars).length > 0 ? `
    env=${JSON.stringify(template.env_vars).replace(/"/g, '"')},` : ''}${template.auth ? `
    auth=True,` : ''}
)

print(f"Job {job.job_id} launched!")
print(f"Access at: https://{job.job_id}.job.hypercli.com")`}</code>
                  </pre>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Install with: <code className="bg-surface-low px-2 py-0.5 rounded text-primary font-mono">pip install hypercli-sdk</code>
                </p>
              </div>

              {/* CLI */}
              <div className="mb-8">
                <h3 className="text-xl font-semibold text-white mb-4">CLI</h3>
                <div className="bg-background border border-white/10 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-surface-low border-b border-white/5">
                    <span className="text-xs text-muted-foreground font-mono">bash</span>
                    <CopyButton text={`hyper instances launch ${template.docker_image} \\
  --gpu l40s \\
  --port lb:${template.port}${template.env_vars && Object.keys(template.env_vars).length > 0 ? Object.entries(template.env_vars).map(([k, v]) => ` \\\n  --env ${k}="${v}"`).join('') : ''}`} />
                  </div>
                  <pre className="p-6 text-sm text-secondary-foreground overflow-x-auto leading-relaxed">
                    <code className="font-mono">{`hyper instances launch ${template.docker_image} \\
  --gpu l40s \\
  --port lb:${template.port}${template.env_vars && Object.keys(template.env_vars).length > 0 ? Object.entries(template.env_vars).map(([k, v]) => ` \\\n  --env ${k}="${v}"`).join('') : ''}`}</code>
                  </pre>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Install with: <code className="bg-surface-low px-2 py-0.5 rounded text-primary font-mono">pip install hypercli-cli</code>
                </p>
              </div>

              {/* Docker (Local) */}
              <div className="mb-8">
                <h3 className="text-xl font-semibold text-white mb-4">Docker (Local)</h3>
                <div className="bg-background border border-white/10 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2 bg-surface-low border-b border-white/5">
                    <span className="text-xs text-muted-foreground font-mono">bash</span>
                    <CopyButton text={`docker run --gpus all -p ${template.port}:${template.port} \\${template.env_vars && Object.keys(template.env_vars).length > 0 ? Object.entries(template.env_vars).map(([k, v]) => `\n  -e ${k}="${v}" \\`).join('') : ''}
  ${template.docker_image}`} />
                  </div>
                  <pre className="p-6 text-sm text-secondary-foreground overflow-x-auto leading-relaxed">
                    <code className="font-mono">{`docker run --gpus all -p ${template.port}:${template.port} \\${template.env_vars && Object.keys(template.env_vars).length > 0 ? Object.entries(template.env_vars).map(([k, v]) => `\n  -e ${k}="${v}" \\`).join('') : ''}
  ${template.docker_image}`}</code>
                  </pre>
                </div>
              </div>

              {/* Web Console */}
              <div>
                <h3 className="text-xl font-semibold text-white mb-4">Web Console</h3>
                <p className="text-secondary-foreground mb-4">
                  Use the web console to launch with a pre-filled form:
                </p>
                <a
                  href={buildLaunchUrl(template)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-surface-low border border-white/10 text-white font-semibold rounded-xl hover:bg-surface-high hover:border-white/20 transition-all"
                >
                  Open in Console
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                    <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                  </svg>
                </a>
              </div>
            </div>

            {/* Environment Variables */}
            {template.env_vars && Object.keys(template.env_vars).length > 0 && (
              <div className="mb-16">
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">Environment Variables</h2>
                <div className="bg-background border border-white/10 rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-surface-low border-b border-white/5">
                        <th className="text-left py-4 px-5 font-semibold text-muted-foreground">Variable</th>
                        <th className="text-left py-4 px-5 font-semibold text-muted-foreground">Example</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(template.env_vars).map(([key, value], i) => (
                        <tr key={i} className="border-b border-white/5 last:border-0">
                          <td className="py-4 px-5">
                            <code className="bg-surface-low px-2.5 py-1 rounded text-sm font-mono text-primary">
                              {key}
                            </code>
                          </td>
                          <td className="py-4 px-5">
                            <code className="text-sm font-mono text-secondary-foreground">{value}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 sm:py-20 bg-background border-t border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="p-10 bg-background border border-white/10 rounded-2xl relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(56,211,159,0.05)_0%,transparent_50%)] pointer-events-none" />

              <div className="relative">
                <h3 className="text-3xl sm:text-4xl font-bold text-white mb-3 tracking-tight">Ready to run {template.title}?</h3>
                <p className="text-lg text-muted-foreground mb-6">
                  Deploy on HyperCLI GPUs and access via web browser.
                </p>
                <div className="flex flex-wrap gap-4">
                  <a
                    href={buildLaunchUrl(template)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground rounded-xl hover:bg-primary-hover transition-all font-semibold shadow-[0_0_30px_rgba(56,211,159,0.25)]"
                  >
                    Launch on GPU
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </a>
                  <Link
                    href="/docs"
                    className="inline-flex items-center gap-2 px-8 py-4 bg-surface-low border border-white/10 text-white font-semibold rounded-xl hover:bg-surface-high hover:border-white/20 transition-all"
                  >
                    View Documentation
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
