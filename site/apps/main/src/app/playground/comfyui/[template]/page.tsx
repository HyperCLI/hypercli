import React from "react";
import { Header, Footer } from "@hypercli/shared-ui";
import Link from "next/link";
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
      parts.push(<strong key={key++} className="font-semibold text-white">{boldMatch[1]}</strong>);
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
        {/* Hero Section - Two Column Layout */}
        <div className="relative py-16 sm:py-24 bg-background overflow-hidden border-b border-white/5">
          {/* Particle Canvas Background */
          <ClientParticleCanvas />
          
          {/* Grain texture */}
          <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMDAiIGhlaWdodD0iMzAwIj48ZmlsdGVyIGlkPSJhIiB4PSIwIiB5PSIwIj48ZmVUdXJidWxlbmNlIGJhc2VGcmVxdWVuY3k9Ii43NSIgc3RpdGNoVGlsZXM9InN0aXRjaCIgdHlwZT0iZnJhY3RhbE5vaXNlIi8+PGZlQ29sb3JNYXRyaXggdHlwZT0ic2F0dXJhdGUiIHZhbHVlcz0iMCIvPjwvZmlsdGVyPjxwYXRoIGQ9Ik0wIDBoMzAwdjMwMEgweiIgZmlsdGVyPSJ1cmwoI2EpIiBvcGFjaXR5PSIuMDUiLz48L3N2Zz4=')]" />
          
          <div className="relative z-20 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Breadcrumb */}
            <nav className="mb-8 text-sm">
              <Link href="/playground" className="text-muted-foreground hover:text-primary hover:underline transition-colors">
                Playground
              </Link>
              <span className="text-muted-foreground/40 mx-2">/</span>
              <Link href="/playground/comfyui" className="text-muted-foreground hover:text-primary hover:underline transition-colors">
                ComfyUI Templates
              </Link>
              <span className="text-muted-foreground/40 mx-2">/</span>
              <span className="text-white font-medium">{frontmatter.title}</span>
            </nav>

            {/* Two Column Hero */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
              {/* Left Column - Info */}
              <div>
                {/* Tags */}
                <div className="flex flex-wrap items-center gap-2 mb-6">
                  <span className="px-4 py-1.5 bg-surface-low border border-white/10 rounded-full text-sm font-medium text-secondary-foreground">
                    {frontmatter.output_type}
                  </span>
                  {frontmatter.tags?.map((tag, i) => (
                    <span key={i} className="px-4 py-1.5 bg-primary/10 border border-primary/20 text-primary rounded-full text-sm font-medium">
                      {tag}
                    </span>
                  ))}
                </div>

                <h1 className="text-[40px] sm:text-[48px] lg:text-[56px] font-bold tracking-[-0.03em] text-white leading-[1.05] mb-6">
                  {frontmatter.title}
                </h1>

                {frontmatter.description && (
                  <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
                    {frontmatter.description}
                  </p>
                )}

                {/* Quick Actions */}
                <div className="flex flex-wrap gap-4">
                  <Link
                    href="#usage"
                    className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground rounded-xl hover:bg-primary-hover transition-all font-semibold shadow-[0_0_30px_rgba(56,211,159,0.25)]"
                  >
                    Get Started
                  </Link>
                  {frontmatter.tutorial_url && (
                    <a
                      href={frontmatter.tutorial_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-8 py-4 bg-surface-low border border-white/10 text-white font-semibold rounded-xl hover:bg-surface-high hover:border-white/20 transition-all">
                    >
                      View Tutorial
                      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>

              {/* Right Column - Thumbnail */}
              {frontmatter.thumbnail && (
                <div className="bg-surface-low rounded-2xl overflow-hidden border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
                  <img
                    src={frontmatter.thumbnail}
                    alt={frontmatter.title}
                    className="w-full aspect-square object-cover"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content Section */}
        <section className="py-16 sm:py-20 bg-background">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* About */}
            {sections["About"] && (
              <div className="mb-16">
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">About</h2>
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
                          <p key={`p-${parts.length}`} className="text-secondary-foreground leading-relaxed">
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
                              <li key={idx} className="text-secondary-foreground">{renderMarkdownInline(item.replace(/^-\s*/, ""))}</li>
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
                              <div key={`code-${parts.length}`} className="my-4 bg-background border border-white/10 rounded-xl p-6">
                                <pre className="text-sm text-secondary-foreground overflow-x-auto leading-relaxed">
                                  <code className="font-mono">{codeBlockLines.join("\n")}</code>
                                </pre>
                              </div>
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
              </div>
            )}

            {/* Parameters */}
            {sections["Parameters"] && (
              <div className="mb-16">
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">Parameters</h2>
                <div className="bg-background border border-white/10 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-surface-low border-b border-white/5">
                          <th className="text-left py-4 px-5 font-semibold text-muted-foreground">Parameter</th>
                          <th className="text-left py-4 px-5 font-semibold text-muted-foreground">Type</th>
                          <th className="text-left py-4 px-5 font-semibold text-muted-foreground">Default</th>
                          <th className="text-left py-4 px-5 font-semibold text-muted-foreground">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const table = parseMarkdownTable(sections["Parameters"]);
                          if (!table) return null;
                          return table.rows.map((row, i) => (
                            <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-surface-low transition-colors">
                              {row.map((cell, j) => (
                                <td key={j} className="py-4 px-5 text-secondary-foreground">
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
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Usage */}
            {sections["Usage"] && (
              <div id="usage" className="mb-16 scroll-mt-8">
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">Usage</h2>
                <div className="bg-background border border-white/10 rounded-xl overflow-hidden">
                  <pre className="p-6 text-sm text-secondary-foreground overflow-x-auto leading-relaxed">
                    <code className="font-mono">{sections["Usage"].replace(/^```[a-z]*\n?|```$/gm, "").trim()}</code>
                  </pre>
                </div>
              </div>
            )}

            {/* Required Models */}
            {sections["Required Models"] && (
              <div className="mb-16">
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">Required Models</h2>
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
                            className="bg-background border border-white/10 px-4 py-2 rounded-lg text-sm font-mono text-primary hover:bg-surface-low hover:border-primary/30 transition-all"
                          >
                            {filename}
                          </a>
                        ) : (
                          <code className="bg-background border border-white/10 px-4 py-2 rounded-lg text-sm font-mono text-secondary-foreground">
                            {filename}
                          </code>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Example Prompt */}
            {sections["Example Prompt"] && (
              <div className="mb-16">
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6 tracking-tight">Example Prompt</h2>
                <div className="bg-background border border-white/10 rounded-xl overflow-hidden">
                  <div className="bg-surface-low border-b border-white/5 px-6 py-3">
                    <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Prompt Example</span>
                  </div>
                  <div className="p-6">
                    <p className="text-secondary-foreground leading-relaxed italic">"{sections["Example Prompt"]}"</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 sm:py-20 bg-background border-t border-white/5">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

            {/* CTA */}
            <div className="p-10 bg-background border border-white/10 rounded-2xl relative overflow-hidden">
              {/* Subtle gradient overlay */}
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(56,211,159,0.05)_0%,transparent_50%)] pointer-events-none" />
              
              <div className="relative">
                <h3 className="text-3xl sm:text-4xl font-bold text-white mb-3 tracking-tight">Ready to run this template?</h3>
                <p className="text-lg text-muted-foreground mb-6">
                  Install the CLI and run this template on GPU in seconds.
                </p>
                <div className="bg-background border border-white/10 rounded-xl overflow-hidden mb-8">
                  <pre className="p-6 text-sm text-primary overflow-x-auto leading-relaxed">
                    <code className="font-mono">pip install c3-cli && c3 comfyui run {templateId}</code>
                  </pre>
                </div>
                <Link
                  href="/docs"
                  className="inline-flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground rounded-xl hover:bg-primary-hover transition-all font-semibold shadow-[0_0_30px_rgba(56,211,159,0.25)]"
                >
                  View Documentation
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
