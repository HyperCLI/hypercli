"use client";

import Markdown from "react-markdown";
import { ResourceImage } from "@/components/ResourceImage";

interface MarkdownContentProps {
  content: string;
}

const MARKDOWN_WRAP_CLASS = "min-w-0 max-w-full break-words [overflow-wrap:anywhere]";
const MARKDOWN_BLOCK_CLASS = `${MARKDOWN_WRAP_CLASS} mb-2 last:mb-0`;
const MARKDOWN_INLINE_CODE_CLASS = "max-w-full break-words rounded bg-background/50 px-1 py-0.5 font-mono text-xs text-[#f0c56c] [overflow-wrap:anywhere]";
const MARKDOWN_PRE_CLASS = "my-2 max-w-full overflow-x-auto rounded-md border border-border bg-background/50 px-3 py-2 font-mono text-xs";
const MARKDOWN_IMAGE_CLASS = "h-auto max-h-[320px] max-w-full rounded-md object-contain sm:max-w-[320px]";

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="prose-chat max-w-full leading-relaxed">
      <Markdown
        components={{
          p: ({ children }) => <p className={MARKDOWN_BLOCK_CLASS}>{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children, className }) => {
            const isBlock = className?.includes("language-");
            return isBlock ? (
              <pre className={MARKDOWN_PRE_CLASS}>
                <code>{children}</code>
              </pre>
            ) : (
              <code className={MARKDOWN_INLINE_CODE_CLASS}>{children}</code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          ul: ({ children }) => <ul className={`${MARKDOWN_WRAP_CLASS} mb-2 list-disc space-y-1 pl-4`}>{children}</ul>,
          ol: ({ children }) => <ol className={`${MARKDOWN_WRAP_CLASS} mb-2 list-decimal space-y-1 pl-4`}>{children}</ol>,
          li: ({ children }) => <li className={MARKDOWN_WRAP_CLASS}>{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="break-words text-accent hover:underline [overflow-wrap:anywhere]">
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className={`${MARKDOWN_WRAP_CLASS} mb-2 text-lg font-bold`}>{children}</h1>,
          h2: ({ children }) => <h2 className={`${MARKDOWN_WRAP_CLASS} mb-2 text-base font-bold`}>{children}</h2>,
          h3: ({ children }) => <h3 className={`${MARKDOWN_WRAP_CLASS} mb-1 text-sm font-bold`}>{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className={`${MARKDOWN_WRAP_CLASS} my-2 border-l-2 border-text-muted pl-3 italic text-text-secondary`}>{children}</blockquote>
          ),
          hr: () => <hr className="border-border my-3" />,
          table: ({ children }) => (
            <div className="my-2 max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border-b border-border px-2 py-1 font-semibold text-foreground">{children}</th>,
          td: ({ children }) => <td className="border-b border-border/60 px-2 py-1 text-text-secondary">{children}</td>,
          img: ({ src, alt }) =>
            typeof src === "string" && src ? (
              <a href={src} target="_blank" rel="noopener noreferrer" className="my-2 block max-w-full">
                <ResourceImage
                  src={src}
                  alt={typeof alt === "string" ? alt : "image"}
                  width={320}
                  height={320}
                  sizes="(max-width: 640px) 100vw, 320px"
                  className={MARKDOWN_IMAGE_CLASS}
                  loading="lazy"
                />
              </a>
            ) : null,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
