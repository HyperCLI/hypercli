"use client";

import { useMemo, type CSSProperties } from "react";
import Markdown from "react-markdown";
import { ChatImageViewer } from "./ChatImageViewer";
import { useTypewriter } from "./useTypewriter";

interface MarkdownContentProps {
  content: string;
  typewriter?: boolean;
  className?: string;
  style?: CSSProperties;
}

const MARKDOWN_WRAP_CLASS = "min-w-0 max-w-full break-words [overflow-wrap:anywhere]";
const MARKDOWN_BLOCK_CLASS = `${MARKDOWN_WRAP_CLASS} mb-2 last:mb-0`;
const MARKDOWN_INLINE_CODE_CLASS = "max-w-full break-words rounded bg-background/50 px-1 py-0.5 font-mono text-xs text-[#f0c56c] [overflow-wrap:anywhere]";
const MARKDOWN_PRE_CLASS = "my-2 max-w-full overflow-x-auto rounded-md border border-border bg-background/50 px-3 py-2 font-mono text-xs";
export const CHAT_MARKDOWN_IMAGE_CLASS = "h-auto max-h-[320px] max-w-full rounded-md object-contain sm:max-w-[320px]";
export const CHAT_MEDIA_LINK_CLASS = "block max-w-full";

type MarkdownSegment =
  | { type: "markdown"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };

function mediaFileNameFromUrl(url: string, fallback = "image"): string {
  try {
    const parsed = new URL(url, "https://hypercli.local");
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : fallback;
  } catch {
    return url.split(/[?#]/)[0].split("/").filter(Boolean).pop() || fallback;
  }
}

const CHAT_MARKDOWN_COMPONENTS: Parameters<typeof Markdown>[0]["components"] = {
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
      <ChatImageViewer
        src={src}
        alt={typeof alt === "string" ? alt : "image"}
        width={320}
        height={320}
        sizes="(max-width: 640px) 100vw, 320px"
        className={CHAT_MARKDOWN_IMAGE_CLASS}
        containerClassName={`${CHAT_MEDIA_LINK_CLASS} my-2`}
        loading="lazy"
        downloadHref={src}
        downloadFileName={mediaFileNameFromUrl(src, typeof alt === "string" ? alt : "image")}
      />
    ) : null,
};

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableCandidateRow(line: string): boolean {
  return line.includes("|") && splitTableRow(line).length >= 2;
}

function isTableSeparatorRow(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTables(content: string): MarkdownSegment[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const segments: MarkdownSegment[] = [];
  const markdownBuffer: string[] = [];
  let inFence = false;

  const flushMarkdown = () => {
    if (markdownBuffer.length === 0) return;
    const text = markdownBuffer.join("\n");
    if (text.trim()) segments.push({ type: "markdown", text });
    markdownBuffer.length = 0;
  };

  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? "";
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      markdownBuffer.push(line);
      continue;
    }

    const nextLine = lines[cursor + 1] ?? "";
    if (!inFence && isTableCandidateRow(line) && isTableSeparatorRow(nextLine)) {
      flushMarkdown();
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      cursor += 2;
      while (cursor < lines.length && isTableCandidateRow(lines[cursor] ?? "")) {
        rows.push(splitTableRow(lines[cursor] ?? ""));
        cursor += 1;
      }
      cursor -= 1;
      segments.push({ type: "table", headers, rows });
      continue;
    }

    markdownBuffer.push(line);
  }

  flushMarkdown();
  return segments;
}

function renderMarkdown(text: string) {
  return <Markdown components={CHAT_MARKDOWN_COMPONENTS}>{text}</Markdown>;
}

export function MarkdownContent({ content, typewriter = false, className, style }: MarkdownContentProps) {
  const displayedContent = useTypewriter(content, typewriter);
  const segments = useMemo(() => splitMarkdownTables(displayedContent), [displayedContent]);

  return (
    <div className={`prose-chat max-w-full leading-relaxed ${className ?? ""}`} style={style}>
      {segments.map((segment, index) => {
        if (segment.type === "markdown") {
          return <div key={`markdown-${index}`}>{renderMarkdown(segment.text)}</div>;
        }
        return (
          <div key={`table-${index}`} className="my-2 max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-left text-xs">
              <thead>
                <tr>
                  {segment.headers.map((header, headerIndex) => (
                    <th key={`${header}-${headerIndex}`} className="border-b border-border px-2 py-1 font-semibold text-foreground">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segment.rows.map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`}>
                    {segment.headers.map((_, cellIndex) => (
                      <td key={`cell-${rowIndex}-${cellIndex}`} className="border-b border-border/60 px-2 py-1 text-text-secondary">
                        {row[cellIndex] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
