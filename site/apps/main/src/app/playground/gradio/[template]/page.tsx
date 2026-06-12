import {
  Footer,
  Header,
  TemplateCodeBlock,
  TemplateCtaCard,
  TemplateDetailBadge,
  TemplateDetailContent,
  TemplateDetailHero,
  TemplateDetailSection,
  TemplateTable,
} from "@hypercli/shared-ui";
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
  const consoleUrl = process.env.NEXT_PUBLIC_CONSOLE_URL || "https://console.hypercli.com";
  const params = new URLSearchParams({
    image: template.docker_image,
    port: String(template.port),
    gpu: "l40s",
    runtime: "3600",
  });
  if (template.env_vars && Object.keys(template.env_vars).length > 0) {
    params.set("env", JSON.stringify(template.env_vars));
  }
  if (template.auth) {
    params.set("auth", "true");
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
    (t: Template) => t.template_id === templateId,
  ) as Template | undefined;

  if (!template) {
    notFound();
  }

  const thumbnailPath = `/gradio/${template.template_id}/thumbnail.webp`;
  const hasEnvVars = Boolean(template.env_vars && Object.keys(template.env_vars).length > 0);
  const pythonEnv = hasEnvVars ? `\n    env=${JSON.stringify(template.env_vars)},` : "";
  const pythonAuth = template.auth ? "\n    auth=True," : "";
  const cliEnvArgs = hasEnvVars
    ? Object.entries(template.env_vars ?? {}).map(([key, value]) => ` \\\n  --env ${key}=\"${value}\"`).join("")
    : "";
  const dockerEnvArgs = hasEnvVars
    ? Object.entries(template.env_vars ?? {}).map(([key, value]) => `\n  -e ${key}=\"${value}\" \\`).join("")
    : "";

  const pythonUsage = `from hypercli import HyperCLI

client = HyperCLI()

# Launch ${template.title}
job = client.jobs.create(
    image="${template.docker_image}",
    gpu_type="l40s",
    ports={"lb": ${template.port}},${pythonEnv}${pythonAuth}
)

print(f"Job {job.job_id} launched!")
print(f"Access at: https://{job.job_id}.job.hypercli.com")`;
  const cliUsage = `hyper instances launch ${template.docker_image} \\
  --gpu l40s \\
  --port lb:${template.port}${cliEnvArgs}`;
  const dockerUsage = `docker run --gpus all -p ${template.port}:${template.port} \\${dockerEnvArgs}
  ${template.docker_image}`;
  const launchUrl = buildLaunchUrl(template);

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background">
        <TemplateDetailHero
          breadcrumbs={[
            { label: "Playground", href: "/playground" },
            { label: "Gradio Templates", href: "/playground/gradio" },
            { label: template.title },
          ]}
          badges={
            <>
              <TemplateDetailBadge>{template.output_type}</TemplateDetailBadge>
              {template.tags?.map((tag) => (
                <TemplateDetailBadge key={tag} variant="primary">{tag}</TemplateDetailBadge>
              ))}
            </>
          }
          title={template.title}
          description={template.description}
          actions={[
            { label: "Launch on GPU", href: launchUrl, external: true },
            { label: "Get Started", href: "#usage", variant: "secondary" },
          ]}
          media={
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5">
              <ThumbnailImage src={thumbnailPath} alt={template.title} />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="h-16 w-16 text-primary/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
            </div>
          }
          mediaAspect="video"
          backgroundEffect={<ClientParticleCanvas />}
        />

        <TemplateDetailContent>
          {template.features && template.features.length > 0 && (
            <TemplateDetailSection title="Features">
              <ul className="space-y-4">
                {template.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                    <span className="leading-relaxed text-text-secondary">{feature}</span>
                  </li>
                ))}
              </ul>
            </TemplateDetailSection>
          )}

          <TemplateDetailSection title="Requirements">
            <TemplateTable>
              <tbody>
                <tr className="border-b border-border-medium/30">
                  <td className="px-5 py-4 font-medium text-text-muted">GPU</td>
                  <td className="px-5 py-4 text-text-secondary">{template.gpu_requirements}</td>
                </tr>
                <tr className="border-b border-border-medium/30">
                  <td className="px-5 py-4 font-medium text-text-muted">Docker Image</td>
                  <td className="px-5 py-4">
                    <code className="rounded bg-surface-low px-2.5 py-1 font-mono text-sm text-primary">
                      {template.docker_image}
                    </code>
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-4 font-medium text-text-muted">Port</td>
                  <td className="px-5 py-4 text-text-secondary">{template.port}</td>
                </tr>
              </tbody>
            </TemplateTable>
          </TemplateDetailSection>

          {template.models && template.models.length > 0 && (
            <TemplateDetailSection title="Available Models">
              <TemplateTable>
                <thead>
                  <tr className="border-b border-border-medium/30 bg-surface-low">
                    <th className="px-5 py-4 text-left font-semibold text-text-muted">Model</th>
                    <th className="px-5 py-4 text-left font-semibold text-text-muted">Size</th>
                    <th className="px-5 py-4 text-left font-semibold text-text-muted">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {template.models.map((model) => (
                    <tr key={`${model.name}-${model.size}`} className="border-b border-border-medium/30 last:border-0">
                      <td className="px-5 py-4">
                        <code className="rounded bg-surface-low px-2.5 py-1 font-mono text-sm text-primary">
                          {model.name}
                        </code>
                      </td>
                      <td className="px-5 py-4 text-text-secondary">{model.size}</td>
                      <td className="px-5 py-4 text-text-secondary">{model.type}</td>
                    </tr>
                  ))}
                </tbody>
              </TemplateTable>
            </TemplateDetailSection>
          )}

          <TemplateDetailSection id="usage" title="Usage">
            <div className="mb-8">
              <h3 className="mb-4 text-xl font-semibold text-foreground">Python SDK</h3>
              <TemplateCodeBlock code={pythonUsage} label="python" action={<CopyButton text={pythonUsage} />} />
              <p className="mt-3 text-sm text-text-secondary">
                Install with: <code className="rounded bg-surface-low px-2 py-0.5 font-mono text-primary">pip install hypercli-sdk</code>
              </p>
            </div>

            <div className="mb-8">
              <h3 className="mb-4 text-xl font-semibold text-foreground">CLI</h3>
              <TemplateCodeBlock code={cliUsage} label="bash" action={<CopyButton text={cliUsage} />} />
              <p className="mt-3 text-sm text-text-secondary">
                Install with: <code className="rounded bg-surface-low px-2 py-0.5 font-mono text-primary">pip install hypercli-cli</code>
              </p>
            </div>

            <div className="mb-8">
              <h3 className="mb-4 text-xl font-semibold text-foreground">Docker (Local)</h3>
              <TemplateCodeBlock code={dockerUsage} label="bash" action={<CopyButton text={dockerUsage} />} />
            </div>

            <div>
              <h3 className="mb-4 text-xl font-semibold text-foreground">Web Console</h3>
              <p className="mb-4 text-text-secondary">Use the web console to launch with a pre-filled form:</p>
              <a href={launchUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex items-center gap-2 rounded-xl px-6 py-3 font-semibold">
                Open in Console
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                  <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                </svg>
              </a>
            </div>
          </TemplateDetailSection>

          {template.env_vars && Object.keys(template.env_vars).length > 0 && (
            <TemplateDetailSection title="Environment Variables">
              <TemplateTable>
                <thead>
                  <tr className="border-b border-border-medium/30 bg-surface-low">
                    <th className="px-5 py-4 text-left font-semibold text-text-muted">Variable</th>
                    <th className="px-5 py-4 text-left font-semibold text-text-muted">Example</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(template.env_vars).map(([key, value]) => (
                    <tr key={key} className="border-b border-border-medium/30 last:border-0">
                      <td className="px-5 py-4">
                        <code className="rounded bg-surface-low px-2.5 py-1 font-mono text-sm text-primary">
                          {key}
                        </code>
                      </td>
                      <td className="px-5 py-4">
                        <code className="font-mono text-sm text-text-secondary">{value}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TemplateTable>
            </TemplateDetailSection>
          )}
        </TemplateDetailContent>

        <TemplateCtaCard
          title={<>Ready to run {template.title}?</>}
          description="Deploy on HyperCLI GPUs and access via web browser."
          actions={[
            { label: "Launch on GPU", href: launchUrl, external: true },
            { label: "View Documentation", href: "/docs", variant: "secondary" },
          ]}
        />
      </main>
      <Footer />
    </>
  );
}
