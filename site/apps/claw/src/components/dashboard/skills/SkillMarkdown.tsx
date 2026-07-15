"use client";

import Markdown from "react-markdown";

const SKILL_MARKDOWN_COMPONENTS: Parameters<typeof Markdown>[0]["components"] = {
  h1: ({ children }) => <h1 className="mb-3 text-[17px] font-semibold leading-tight text-foreground">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-5 text-[14px] font-semibold leading-tight text-foreground first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-[12px] font-semibold leading-tight text-foreground first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-3 text-[12px] leading-relaxed text-text-secondary last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-text-secondary">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-[12px] leading-relaxed text-text-secondary">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  code: ({ children, className }) => {
    if (className?.includes("language-")) {
      return (
        <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-background/75 p-3 text-[11px] leading-relaxed text-text-secondary">
          <code>{children}</code>
        </pre>
      );
    }
    return <code className="rounded-md border border-border bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-foreground">{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-border-strong pl-3 text-[12px] text-text-muted">{children}</blockquote>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--selection-accent)] hover:underline">{children}</a>,
};

export function SkillMarkdown({ content }: { content: string }) {
  return <Markdown components={SKILL_MARKDOWN_COMPONENTS}>{content}</Markdown>;
}
