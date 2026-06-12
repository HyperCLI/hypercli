import React from "react";
import {
  Footer,
  Header,
  TemplateCodeBlock,
  TemplateCtaCard,
  TemplateDetailBadge,
  TemplateDetailContent,
  TemplateDetailHero,
  TemplateDetailPanel,
  TemplateDetailSection,
  TemplateTable,
} from "@hypercli/shared-ui";
import { notFound } from "next/navigation";
import fs from "fs";
import path from "path";
import templatesIndex from "@/content/comfyui/index.json";
import ClientParticleCanvas from "@/components/ClientParticleCanvas";

type Template = {
  template_id: string;
  title: string;
  description: string;
  bundle: string;
  output_type: string;
  tags: string[];
};

type Frontmatter = {
  title: string;
  description: string;
  template_id: string;
  bundle: string;
  output_type: string;
  thumbnail: string;
  tags: string[];
  tutorial_url: string;
  date: string;
  models: string[];
};

function renderMarkdownInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Normalize text: remove newlines within markdown links
  let remaining = text.replace(/\[([^\]]+)\]\(([^)]+)\)/gs, (match, linkText, url) => {
    return `[${linkText}](${url.replace(/\s+/g, '')})`;
  });
  let key = 0;

  while (remaining.length > 0) {
    // Check for links [text](url)
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && linkMatch.index !== undefined) {
      // Add text before the link
      if (linkMatch.index > 0) {
        const beforeText = remaining.substring(0, linkMatch.index);
        if (beforeText.trim()) parts.push(<span key={key++}>{beforeText}</span>);
      }
      // Add the link
      parts.push(
        <a key={key++} href={linkMatch[2].trim()} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.slice(linkMatch.index + linkMatch[0].length);
      continue;
    }

    // Check for bold **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++} className="font-semibold text-foreground">{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Check for code `text`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(<code key={key++} className="bg-surface-low px-2 py-0.5 rounded text-sm font-mono text-primary">{codeMatch[1]}</code>);
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Find next special character or end
    const nextSpecial = remaining.search(/\[|\*\*|`/);
    if (nextSpecial === -1) {
      if (remaining.trim()) parts.push(<span key={key++}>{remaining}</span>);
      break;
    } else if (nextSpecial === 0) {
      // Special char but didn't match pattern, treat as text
      parts.push(<span key={key++}>{remaining[0]}</span>);
      remaining = remaining.slice(1);
    } else {
      const text = remaining.slice(0, nextSpecial);
      if (text.trim()) parts.push(<span key={key++}>{text}</span>);
      remaining = remaining.slice(nextSpecial);
    }
  }

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return <>{parts}</>;
}

function parseMarkdownTable(content: string): { headers: string[]; rows: string[][] } | null {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return null;

  const headers = lines[0].split("|").map(h => h.trim()).filter(Boolean);
  const rows = lines.slice(2).map(line =>
    line.split("|").map(cell => cell.trim()).filter(Boolean)
  );

  return { headers, rows };
}

function parseMdxFile(templateId: string): { frontmatter: Frontmatter; sections: Record<string, string> } | null {
  try {
    const mdxPath = path.join(process.cwd(), "content", "comfyui", templateId, "index.mdx");
    console.log(`[parseMdxFile] Attempting to read: ${mdxPath}`);
    const content = fs.readFileSync(mdxPath, "utf-8");
    console.log(`[parseMdxFile] Successfully read file for ${templateId}`);

    // Parse frontmatter
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) {
      console.error(`[parseMdxFile] No frontmatter found for ${templateId}`);
      return null;
    }
    console.log(`[parseMdxFile] Frontmatter matched for ${templateId}`);

    const fmLines = fmMatch[1].split("\n");
    const frontmatter: Record<string, any> = {};
    for (const line of fmLines) {
      const [key, ...valueParts] = line.split(": ");
      if (key && valueParts.length) {
        const value = valueParts.join(": ");
        try {
          frontmatter[key.trim()] = JSON.parse(value);
        } catch {
          frontmatter[key.trim()] = value;
        }
      }
    }
    console.log(`[parseMdxFile] Frontmatter parsed:`, frontmatter);

    // Parse sections
    const body = content.slice(fmMatch[0].length);
    const sections: Record<string, string> = {};
    const sectionRegex = /## ([^\n]+)\n([\s\S]*?)(?=\n## |$)/g;
    let match;
    while ((match = sectionRegex.exec(body)) !== null) {
      sections[match[1].trim()] = match[2].trim();
    }
    console.log(`[parseMdxFile] Sections parsed:`, Object.keys(sections));

    return { frontmatter: frontmatter as Frontmatter, sections };
  } catch (error) {
    console.error(`[parseMdxFile] Error parsing ${templateId}:`, error);
    return null;
  }
}

export async function generateStaticParams() {
  return templatesIndex.templates.map((t: Template) => ({
    template: t.template_id,
  }));
}

export default async function TemplatePage({ params }: { params: Promise<{ template: string }> }) {
  const { template: templateId } = await params;

  const templateMeta = templatesIndex.templates.find(
    (t: Template) => t.template_id === templateId
  );

  if (!templateMeta) {
    notFound();
  }

  const parsed = parseMdxFile(templateId);
  if (!parsed) {
    notFound();
  }

  const { frontmatter, sections } = parsed;

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background">
        <TemplateDetailHero
          breadcrumbs={[
            { label: "Playground", href: "/playground" },
            { label: "ComfyUI Templates", href: "/playground/comfyui" },
            { label: frontmatter.title },
          ]}
          badges={
            <>
              <TemplateDetailBadge>{frontmatter.output_type}</TemplateDetailBadge>
              {frontmatter.tags?.map((tag) => (
                <TemplateDetailBadge key={tag} variant="primary">{tag}</TemplateDetailBadge>
              ))}
            </>
          }
          title={frontmatter.title}
          description={frontmatter.description}
          actions={[
            { label: "Get Started", href: "#usage" },
            ...(frontmatter.tutorial_url
              ? [{ label: "View Tutorial", href: frontmatter.tutorial_url, external: true, variant: "secondary" as const }]
              : []),
          ]}
          media={frontmatter.thumbnail ? (
            <img src={frontmatter.thumbnail} alt={frontmatter.title} className="h-full w-full object-cover" />
          ) : undefined}
          backgroundEffect={<ClientParticleCanvas />}
        />

        {/* Content Section */}
        <TemplateDetailContent>
            {/* About */}
            {sections["About"] && (
              <TemplateDetailSection title="About">
                <div className="space-y-4">
                  {(() => {
                    const content = sections["About"].replace(/📂|📁|🗂️/g, "");
                    const parts: React.ReactNode[] = [];
                    
                    // Split by both double newlines and single newlines to handle different formats
                    const lines = content.split(/\n/);
                    let i = 0;
                    let currentList: string[] = [];
                    let codeBlockLines: string[] = [];
                    let inCodeBlock = false;
                    let currentParagraph: string[] = [];
                    
                    const flushParagraph = () => {
                      if (currentParagraph.length > 0) {
                        const text = currentParagraph.join(" ");
                        parts.push(
                          <p key={`p-${parts.length}`} className="text-text-secondary leading-relaxed">
                            {renderMarkdownInline(text)}
                          </p>
                        );
                        currentParagraph = [];
                      }
                    };
                    
                    const flushList = () => {
                      if (currentList.length > 0) {
                        parts.push(
                          <ul key={`list-${parts.length}`} className="list-disc list-inside space-y-2">
                            {currentList.map((item, idx) => (
                              <li key={idx} className="text-text-secondary">{renderMarkdownInline(item.replace(/^-\s*/, ""))}</li>
                            ))}
                          </ul>
                        );
                        currentList = [];
                      }
                    };
                    
                    while (i < lines.length) {
                      const line = lines[i];
                      const trimmed = line.trim();
                      
                      // Check for code block markers or tree structure
                      if (trimmed.startsWith("```") || (trimmed.includes("ComfyUI/") && !inCodeBlock)) {                        flushParagraph();                        flushList();
                        inCodeBlock = true;
                        if (!trimmed.startsWith("```")) {
                          codeBlockLines.push(line);
                        }
                        i++;
                        continue;
                      }
                      
                      // Collect code block lines
                      if (inCodeBlock) {
                        if (trimmed.startsWith("```") || (i === lines.length - 1) || (!trimmed.includes("├") && !trimmed.includes("└") && !trimmed.includes("│") && codeBlockLines.length > 0 && !line.match(/\.(safetensors|ckpt)/))) {
                          if (codeBlockLines.length > 0) {
                            parts.push(
                              <TemplateCodeBlock key={`code-${parts.length}`} code={codeBlockLines.join("\n")} className="my-4" />
                            );
                            codeBlockLines = [];
                          }
                          inCodeBlock = false;
                          i++;
                          continue;
                        }
                        codeBlockLines.push(line);
                        i++;
                        continue;
                      }
                      
                      // Empty line
                      if (!trimmed) {
                        flushParagraph();
                        flushList();
                        i++;
                        continue;
                      }
                      
                      // List items
                      if (trimmed.startsWith("- ")) {
                        flushParagraph();
                        currentList.push(trimmed);
                        i++;
                        continue;
                      }
                      
                      // Regular text line - accumulate into paragraph
                      flushList();
                      if (trimmed) {
                        currentParagraph.push(trimmed);
                      }
                      i++;
                    }
                    
                    flushParagraph();
                    flushList();
                    
                    return parts;
                  })()}
                </div>
              </TemplateDetailSection>
            )}

            {/* Parameters */}
            {sections["Parameters"] && (
              <TemplateDetailSection title="Parameters">
                <TemplateTable>
                      <thead>
                        <tr className="border-b border-border-medium/30 bg-surface-low">
                          <th className="px-5 py-4 text-left font-semibold text-text-muted">Parameter</th>
                          <th className="px-5 py-4 text-left font-semibold text-text-muted">Type</th>
                          <th className="px-5 py-4 text-left font-semibold text-text-muted">Default</th>
                          <th className="px-5 py-4 text-left font-semibold text-text-muted">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const table = parseMarkdownTable(sections["Parameters"]);
                          if (!table) return null;
                          return table.rows.map((row, i) => (
                            <tr key={i} className="border-b border-border-medium/30 transition-colors last:border-0 hover:bg-surface-low">
                              {row.map((cell, j) => (
                                <td key={j} className="px-5 py-4 text-text-secondary">
                                  {j === 0 ? (
                                    <code className="bg-surface-low px-2.5 py-1 rounded text-sm font-mono text-primary">
                                      {cell.replace(/`/g, "")}
                                    </code>
                                  ) : (
                                    cell.replace(/`/g, "")
                                  )}
                                </td>
                              ))}
                            </tr>
                          ));
                        })()}
                      </tbody>
                </TemplateTable>
              </TemplateDetailSection>
            )}

            {/* Usage */}
            {sections["Usage"] && (
              <TemplateDetailSection id="usage" title="Usage">
                <TemplateCodeBlock code={sections["Usage"].replace(/^```[a-z]*\n?|```$/gm, "").trim()} />
              </TemplateDetailSection>
            )}

            {/* Required Models */}
            {sections["Required Models"] && (
              <TemplateDetailSection title="Required Models">
                <ul className="space-y-3">
                  {sections["Required Models"].split("\n").filter(Boolean).map((line, i) => {
                    const match = line.match(/\[(.+?)\]\((.+?)\)/);
                    const filename = match ? match[1] : line.replace(/^-\s*/, "").trim();
                    const url = match ? match[2] : null;
                    return (
                      <li key={i} className="flex items-center gap-2">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-border-medium/50 bg-background px-4 py-2 font-mono text-sm text-primary transition-all hover:border-primary/30 hover:bg-surface-low"
                          >
                            {filename}
                          </a>
                        ) : (
                          <code className="rounded-lg border border-border-medium/50 bg-background px-4 py-2 font-mono text-sm text-text-secondary">
                            {filename}
                          </code>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </TemplateDetailSection>
            )}

            {/* Example Prompt */}
            {sections["Example Prompt"] && (
              <TemplateDetailSection title="Example Prompt">
                <TemplateDetailPanel>
                  <div className="border-b border-border-medium/30 bg-surface-low px-6 py-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Prompt Example</span>
                  </div>
                  <div className="p-6">
                    <p className="leading-relaxed text-text-secondary italic">{`"${sections["Example Prompt"]}"`}</p>
                  </div>
                </TemplateDetailPanel>
              </TemplateDetailSection>
            )}
        </TemplateDetailContent>

        <TemplateCtaCard
          title="Ready to run this template?"
          description="Install the CLI and run this template on GPU in seconds."
          code={`pip install hypercli-cli && hyper comfyui run ${templateId}`}
          actions={[{ label: "View Documentation", href: "/docs" }]}
        />
      </main>
      <Footer />
    </>
  );
}
