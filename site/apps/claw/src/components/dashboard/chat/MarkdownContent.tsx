"use client";

import { createContext, useContext, useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Markdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeOptions } from "rehype-sanitize";
import remarkEmoji from "remark-emoji";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { ChatImageViewer } from "./ChatImageViewer";
import { useTypewriter } from "./useTypewriter";
import { ResourceImage } from "@/components/ResourceImage";

interface MarkdownContentProps {
  content: string;
  typewriter?: boolean;
  className?: string;
  style?: CSSProperties;
  onOpenWorkspaceFile?: (path: string) => void;
}

const MARKDOWN_WRAP_CLASS = "min-w-0 max-w-full break-words [overflow-wrap:anywhere]";
const MARKDOWN_BLOCK_CLASS = `${MARKDOWN_WRAP_CLASS} mb-2 last:mb-0`;
const MARKDOWN_INLINE_CODE_CLASS = "max-w-full break-words rounded bg-background/50 px-1 py-0.5 font-mono text-xs text-warning [overflow-wrap:anywhere]";
const MARKDOWN_PRE_CLASS = `${MARKDOWN_WRAP_CLASS} my-2 overflow-hidden whitespace-pre-wrap rounded-md border border-border bg-background/50 px-3 py-2 font-mono text-xs`;
const MARKDOWN_CODE_BLOCK_CLASS = `${MARKDOWN_WRAP_CLASS} my-2 overflow-hidden rounded-lg border border-border bg-background/70`;
const MARKDOWN_DIAGRAM_WRAP_CLASS = `${MARKDOWN_WRAP_CLASS} my-3 overflow-hidden rounded-lg border border-border bg-background/50 p-3`;
const MARKDOWN_TABLE_WRAP_CLASS = "my-2 w-full max-w-full overflow-hidden";
const MARKDOWN_TABLE_CLASS = "w-full table-fixed border-collapse text-left text-xs";
const MARKDOWN_TABLE_CELL_CLASS = "border-b border-border/60 px-2 py-1 align-top break-words [overflow-wrap:anywhere]";
export const CHAT_MARKDOWN_IMAGE_CLASS = "h-auto max-h-[320px] max-w-full rounded-md object-contain sm:max-w-[320px]";
export const CHAT_MEDIA_LINK_CLASS = "block max-w-full";
const CODE_META_MARKER = "__OPENCLAW_CODE_META__:";
const MARKDOWN_IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#].*)?$/i;
const MARKDOWN_NON_IMAGE_EXTENSIONS = /\.(pdf|csv|txt|md|json|ya?ml|zip|gz|tar|xlsx?|docx?|pptx?)(?:[?#].*)?$/i;
const WORKSPACE_FILE_LINK_PREFIX = "#openclaw-file/";
const FILE_MENTION_EXTENSIONS = "a|aac|avi|bmp|c|cc|cjs|cpp|cs|css|csv|doc|docx|env|epub|fish|flac|gif|go|gz|h|hpp|htm|html|ico|java|jpeg|jpg|js|json|jsonc|jsx|kt|lock|log|m4a|md|mdx|mjs|mov|mp3|mp4|oga|ogg|opus|pdf|php|png|ppt|pptx|ps1|py|rb|rs|sass|scss|sh|sql|svg|swift|tar|tgz|toml|ts|tsx|tsv|txt|wav|weba|webm|webp|xls|xlsx|xml|yaml|yml|zip|zsh";
const FILE_MENTION_EXTENSION_SET = new Set(FILE_MENTION_EXTENSIONS.split("|"));
const FILE_MENTION_PATTERN = new RegExp(
  `(^|[\\s([{<"'])([^\\s)\\]}>"',;:!?]+\\.(?:${FILE_MENTION_EXTENSIONS}))(?=$|[\\s)\\]}>"',.;:!?])`,
  "gi",
);
const MARKDOWN_SANITIZE_SCHEMA: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "abbr"],
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data", "blob"],
  },
};
const MARKDOWN_REHYPE_PLUGINS: NonNullable<Parameters<typeof Markdown>[0]["rehypePlugins"]> = [
  [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA],
  rehypeKatex,
];
const MarkdownLinkContext = createContext(false);
const MarkdownWorkspaceFileContext = createContext<((path: string) => void) | undefined>(undefined);

interface MarkdownAbbreviation {
  term: string;
  title: string;
}

function mediaFileNameFromUrl(url: string, fallback = "image"): string {
  try {
    const parsed = new URL(url, "https://hypercli.local");
    const name = parsed.pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : fallback;
  } catch {
    return url.split(/[?#]/)[0].split("/").filter(Boolean).pop() || fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function workspaceFileHref(path: string): string {
  return `${WORKSPACE_FILE_LINK_PREFIX}${encodeURIComponent(path)}`;
}

function workspacePathFromHref(href: string | undefined): string | null {
  if (!href?.startsWith(WORKSPACE_FILE_LINK_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(WORKSPACE_FILE_LINK_PREFIX.length));
  } catch {
    return null;
  }
}

function stripFileMentionPunctuation(value: string): string {
  let next = value.trim();
  while (/[),.;!?]$/.test(next)) {
    const candidate = next.slice(0, -1).trimEnd();
    if (!/\.(?:[A-Za-z0-9]{1,8})$/i.test(candidate)) break;
    next = candidate;
  }
  return next;
}

function isCommonBareWorkspaceFileName(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    /^(?:readme|license|licence|changelog|agents|package|package-lock|pnpm-lock|yarn|tsconfig|jsconfig)\.[a-z0-9.]+$/.test(lower) ||
    /^(?:next|vite|tailwind|postcss|eslint|prettier|vitest|playwright|turbo)\.config\.[a-z0-9.]+$/.test(lower) ||
    /^\.[a-z0-9_-]+$/.test(lower)
  );
}

function normalizedWorkspaceFileMention(value: string): string | null {
  const trimmed = stripFileMentionPunctuation(value).replace(/\\/g, "/");
  if (!trimmed || /^(?:https?:|mailto:|data:|blob:|media:)/i.test(trimmed) || trimmed.includes("://")) return null;
  if (/^\//.test(trimmed) && !/^\/home\/node\/\.openclaw\/workspace\//i.test(trimmed)) return null;
  if (/^[A-Za-z0-9-]+\.[A-Za-z0-9.-]+\//.test(trimmed)) return null;
  if (!trimmed.includes("/") && !isCommonBareWorkspaceFileName(trimmed)) return null;
  const pathWithoutQuery = trimmed.split(/[?#]/)[0] ?? trimmed;
  const extension = pathWithoutQuery.split(".").pop()?.toLowerCase() ?? "";
  if (!FILE_MENTION_EXTENSION_SET.has(extension)) return null;
  return normalizeOpenClawWorkspaceFilePath(trimmed);
}

function fileMentionNodes(text: string): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  let cursor = 0;

  for (const match of text.matchAll(FILE_MENTION_PATTERN)) {
    const fullMatch = match[0] ?? "";
    const prefix = match[1] ?? "";
    const rawPath = match[2] ?? "";
    const start = match.index ?? 0;
    const pathStart = start + prefix.length;
    const normalizedPath = normalizedWorkspaceFileMention(rawPath);
    if (!normalizedPath) continue;

    if (pathStart > cursor) nodes.push({ type: "text", value: text.slice(cursor, pathStart) });
    nodes.push({
      type: "link",
      url: workspaceFileHref(normalizedPath),
      children: [{ type: "text", value: rawPath }],
    });
    cursor = start + fullMatch.length;
  }

  if (cursor < text.length) nodes.push({ type: "text", value: text.slice(cursor) });
  return nodes.length > 0 ? nodes : [{ type: "text", value: text }];
}

function isFenceClose(line: string, fence: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith(fence[0].repeat(fence.length));
}

function encodeCodeFenceMetadata(content: string): string {
  const lines = content.split("\n");
  const nextLines: string[] = [];
  let activeFence = "";

  for (const line of lines) {
    if (activeFence) {
      if (isFenceClose(line, activeFence)) activeFence = "";
      nextLines.push(line);
      continue;
    }

    const opening = /^(\s*)(`{3,}|~{3,})([^\s`~]+)?(?:[ \t]+(.+))?$/.exec(line);
    if (!opening) {
      nextLines.push(line);
      continue;
    }

    const prefix = opening[1] ?? "";
    const fence = opening[2] ?? "```";
    const language = opening[3]?.trim() || "text";
    const meta = opening[4]?.trim() || "";
    activeFence = fence;
    nextLines.push(`${prefix}${fence}${language}`);
    if (meta) nextLines.push(`${CODE_META_MARKER}${encodeURIComponent(meta)}`);
  }

  return nextLines.join("\n");
}

function decodeCodeTextAndMeta(children: ReactNode, fallbackMeta: string): { code: string; meta: string } {
  let code = String(children).replace(/\n$/, "");
  if (!code.startsWith(CODE_META_MARKER)) return { code, meta: fallbackMeta };
  const lineEnd = code.indexOf("\n");
  const encodedMeta = code.slice(CODE_META_MARKER.length, lineEnd === -1 ? undefined : lineEnd).trim();
  try {
    return {
      code: lineEnd === -1 ? "" : code.slice(lineEnd + 1),
      meta: decodeURIComponent(encodedMeta),
    };
  } catch {
    return {
      code: lineEnd === -1 ? "" : code.slice(lineEnd + 1),
      meta: fallbackMeta,
    };
  }
}

function prepareMarkdownContent(content: string): { content: string; abbreviations: MarkdownAbbreviation[] } {
  const abbreviations: MarkdownAbbreviation[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const markdownLines: string[] = [];
  let activeFence = "";

  for (const line of lines) {
    if (activeFence) {
      if (isFenceClose(line, activeFence)) activeFence = "";
    } else {
      const opening = /^(\s*)(`{3,}|~{3,})/.exec(line);
      if (opening?.[2]) activeFence = opening[2];
      const match = /^\*\[([^\]]+)]:\s+(.+?)\s*$/.exec(line);
      if (!activeFence && match?.[1] && match[2]) {
        abbreviations.push({ term: match[1], title: match[2] });
        continue;
      }
    }
    markdownLines.push(line);
  }

  return { content: encodeCodeFenceMetadata(markdownLines.join("\n")), abbreviations };
}

function abbreviationNodes(text: string, abbreviations: MarkdownAbbreviation[]): Array<Record<string, unknown>> {
  if (abbreviations.length === 0 || !text) return [{ type: "text", value: text }];
  const byTerm = new Map(abbreviations.map((abbr) => [abbr.term, abbr]));
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_])(${abbreviations.map((abbr) => escapeRegExp(abbr.term)).join("|")})(?=$|[^A-Za-z0-9_])`,
    "g",
  );
  const nodes: Array<Record<string, unknown>> = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const fullMatch = match[0] ?? "";
    const prefix = match[1] ?? "";
    const term = match[2] ?? "";
    const start = match.index ?? 0;
    const termStart = start + prefix.length;
    const abbreviation = byTerm.get(term);
    if (!abbreviation) continue;

    if (termStart > cursor) nodes.push({ type: "text", value: text.slice(cursor, termStart) });
    nodes.push({
      type: "abbreviation",
      data: {
        hName: "abbr",
        hProperties: { title: abbreviation.title },
      },
      children: [{ type: "text", value: abbreviation.term }],
    });
    cursor = start + fullMatch.length;
  }

  if (cursor < text.length) nodes.push({ type: "text", value: text.slice(cursor) });
  return nodes.length > 0 ? nodes : [{ type: "text", value: text }];
}

function applyAbbreviationsToAst(node: unknown, abbreviations: MarkdownAbbreviation[]): void {
  if (!isRecord(node) || abbreviations.length === 0) return;
  const children = Array.isArray(node.children) ? node.children : null;
  if (!children) return;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!isRecord(child)) continue;
    if (child.type === "text" && typeof child.value === "string") {
      const nextNodes = abbreviationNodes(child.value, abbreviations);
      children.splice(index, 1, ...nextNodes);
      index += nextNodes.length - 1;
      continue;
    }
    if (child.type === "code" || child.type === "inlineCode" || child.type === "html" || child.type === "link") continue;
    applyAbbreviationsToAst(child, abbreviations);
  }
}

function applyWorkspaceFileLinksToAst(node: unknown): void {
  if (!isRecord(node)) return;
  const children = Array.isArray(node.children) ? node.children : null;
  if (!children) return;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!isRecord(child)) continue;
    if (child.type === "text" && typeof child.value === "string") {
      const nextNodes = fileMentionNodes(child.value);
      children.splice(index, 1, ...nextNodes);
      index += nextNodes.length - 1;
      continue;
    }
    if (child.type === "inlineCode" && typeof child.value === "string") {
      const normalizedPath = normalizedWorkspaceFileMention(child.value);
      if (normalizedPath) {
        children.splice(index, 1, {
          type: "link",
          url: workspaceFileHref(normalizedPath),
          children: [child],
        });
      }
      continue;
    }
    if (child.type === "code" || child.type === "html" || child.type === "link" || child.type === "image") continue;
    applyWorkspaceFileLinksToAst(child);
  }
}

function applyCodeMetaToAst(node: unknown): void {
  if (!isRecord(node)) return;
  if (node.type === "code" && typeof node.meta === "string" && node.meta.trim()) {
    const data = isRecord(node.data) ? node.data : {};
    const hProperties = isRecord(data.hProperties) ? data.hProperties : {};
    node.data = {
      ...data,
      hProperties: {
        ...hProperties,
        dataMeta: node.meta,
      },
    };
  }

  const children = Array.isArray(node.children) ? node.children : null;
  if (!children) return;
  for (const child of children) applyCodeMetaToAst(child);
}

function remarkAbbreviations(abbreviations: MarkdownAbbreviation[]) {
  return function transformAbbreviations() {
    return (tree: unknown) => applyAbbreviationsToAst(tree, abbreviations);
  };
}

function remarkCodeMeta() {
  return (tree: unknown) => applyCodeMetaToAst(tree);
}

function remarkWorkspaceFileLinks() {
  return (tree: unknown) => applyWorkspaceFileLinksToAst(tree);
}

function markdownRemarkPlugins(abbreviations: MarkdownAbbreviation[], linkWorkspaceFiles: boolean): NonNullable<Parameters<typeof Markdown>[0]["remarkPlugins"]> {
  return [
    remarkGfm,
    remarkMath,
    [remarkEmoji, { emoticon: false }],
    remarkCodeMeta,
    remarkAbbreviations(abbreviations),
    ...(linkWorkspaceFiles ? [remarkWorkspaceFileLinks] : []),
  ];
}

function isRenderableMarkdownImageSrc(src: string): boolean {
  const trimmed = src.trim();
  const normalized = trimmed.replace(/^\/+/, "");
  if (!trimmed || /^media:/i.test(trimmed)) return false;
  if (/^(?:home\/node\/\.openclaw\/workspace|\.?openclaw\/workspace|workspace|home)(?:\/|$)/i.test(normalized)) return false;
  if (/^(?:data:image\/|blob:)/i.test(trimmed)) return true;
  if (MARKDOWN_IMAGE_EXTENSIONS.test(trimmed)) return true;
  if (/^(?:https?:\/\/|\/)/i.test(trimmed)) return !MARKDOWN_NON_IMAGE_EXTENSIONS.test(trimmed);
  return false;
}

function MarkdownMediaUnavailable() {
  return (
    <span
      role="status"
      aria-label="Media preview unavailable"
      className="my-2 inline-flex max-w-full rounded-md border border-border bg-background/50 px-2.5 py-1.5 text-xs text-text-secondary"
    >
      Preview unavailable
    </span>
  );
}

function MarkdownMermaidDiagram({ chart }: { chart: string }) {
  const reactId = useId();
  const diagramId = useMemo(() => `markdown-mermaid-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`, [reactId]);
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmedChart = chart.trim();
    if (!trimmedChart) {
      setSvg("");
      setError("Diagram is empty.");
      return;
    }

    let cancelled = false;
    setSvg("");
    setError(null);

    async function renderDiagram() {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            background: "transparent",
            mainBkg: "var(--surface-low)",
            primaryColor: "var(--surface-low)",
            primaryTextColor: "var(--foreground)",
            primaryBorderColor: "var(--border-medium)",
            lineColor: "var(--text-secondary)",
            textColor: "var(--foreground)",
          },
        });
        const result = await mermaid.render(diagramId, trimmedChart);
        if (!cancelled) setSvg(result.svg);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not render diagram.");
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [chart, diagramId]);

  if (error) {
    return (
      <div className={MARKDOWN_DIAGRAM_WRAP_CLASS}>
        <p className="mb-2 text-xs text-destructive">{error}</p>
        <pre className={MARKDOWN_PRE_CLASS}>
          <code className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{chart}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div role="status" aria-label="Rendering diagram" className={`${MARKDOWN_DIAGRAM_WRAP_CLASS} text-xs text-text-muted`}>
        Rendering diagram...
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label="Mermaid diagram"
      className={`${MARKDOWN_DIAGRAM_WRAP_CLASS} [&_svg]:h-auto [&_svg]:max-w-full`}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function codeNodeMeta(node: unknown): string {
  if (!isRecord(node)) return "";
  const data = isRecord(node.data) ? node.data : null;
  if (typeof data?.meta === "string") return data.meta;
  const properties = isRecord(node.properties) ? node.properties : null;
  if (typeof properties?.meta === "string") return properties.meta;
  if (typeof properties?.metastring === "string") return properties.metastring;
  if (typeof properties?.dataMeta === "string") return properties.dataMeta;
  return "";
}

function parseLineSet(value: string): Set<number> {
  const lines = new Set<number>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
    if (range?.[1] && range[2]) {
      const start = Number.parseInt(range[1], 10);
      const end = Number.parseInt(range[2], 10);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        for (let line = Math.min(start, end); line <= Math.max(start, end); line += 1) lines.add(line);
      }
      continue;
    }
    const line = Number.parseInt(trimmed, 10);
    if (Number.isFinite(line)) lines.add(line);
  }
  return lines;
}

function parseCodeMeta(meta: string): { showLineNumbers: boolean; highlightedLines: Set<number>; startingLineNumber: number } {
  const highlightedLineText = /\{([^}]+)}/.exec(meta)?.[1]
    ?? /(?:highlight|lines)=['"]?([0-9,\-\s]+)['"]?/i.exec(meta)?.[1]
    ?? "";
  const startText = /(?:start|startLine|startingLineNumber)=['"]?(\d+)['"]?/i.exec(meta)?.[1] ?? "1";
  const highlightedLines = parseLineSet(highlightedLineText);
  const requestedLineNumbers = /(?:showLineNumbers|lineNumbers|linenos|numberLines)/i.test(meta);
  const startingLineNumber = Number.parseInt(startText, 10);
  return {
    showLineNumbers: requestedLineNumbers || highlightedLines.size > 0,
    highlightedLines,
    startingLineNumber: Number.isFinite(startingLineNumber) ? startingLineNumber : 1,
  };
}

function MarkdownCodeBlock({ code, language, meta }: { code: string; language?: string; meta: string }) {
  const codeMeta = parseCodeMeta(meta);
  return (
    <figure className={MARKDOWN_CODE_BLOCK_CLASS}>
      {(language || codeMeta.showLineNumbers) && (
        <figcaption className="flex min-w-0 items-center justify-between gap-3 border-b border-border/70 px-3 py-1.5 text-[10px] uppercase tracking-wide text-text-muted">
          <span className="truncate font-mono">{language || "code"}</span>
          {codeMeta.showLineNumbers && <span className="shrink-0">Line numbers</span>}
        </figcaption>
      )}
      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        PreTag="pre"
        CodeTag="code"
        showLineNumbers={codeMeta.showLineNumbers}
        startingLineNumber={codeMeta.startingLineNumber}
        wrapLines={codeMeta.highlightedLines.size > 0}
        wrapLongLines
        customStyle={{
          margin: 0,
          background: "transparent",
          padding: "0.75rem",
          fontSize: "0.75rem",
          lineHeight: 1.6,
          overflow: "hidden",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
        codeTagProps={{ className: "whitespace-pre-wrap break-words [overflow-wrap:anywhere]" }}
        lineNumberStyle={{
          minWidth: "2.25em",
          paddingRight: "1em",
          color: "var(--text-muted)",
          opacity: 0.75,
        }}
        lineProps={(lineNumber) => (
          codeMeta.highlightedLines.has(lineNumber)
            ? {
              style: {
                display: "block",
                margin: "0 -0.75rem",
                padding: "0 0.75rem",
                background: "var(--selection-accent-soft)",
                borderLeft: "2px solid var(--selection-accent)",
              },
            }
            : { style: { display: "block" } }
        )}
      >
        {code}
      </SyntaxHighlighter>
    </figure>
  );
}

function MarkdownLink({ href, children, className }: { href?: string; children?: ReactNode; className?: string }) {
  const onOpenWorkspaceFile = useContext(MarkdownWorkspaceFileContext);
  const workspacePath = workspacePathFromHref(href);
  const isExternal = typeof href === "string" && /^(?:https?:|mailto:|irc:|ircs:|xmpp:)/i.test(href);
  return (
    <MarkdownLinkContext.Provider value={Boolean(href)}>
      <a
        href={href}
        onClick={workspacePath && onOpenWorkspaceFile ? (event) => {
          event.preventDefault();
          onOpenWorkspaceFile(workspacePath);
        } : undefined}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        className={`${className ?? ""} break-words text-accent hover:underline [overflow-wrap:anywhere]`}
        title={workspacePath ? "Open in files" : undefined}
      >
        {children}
      </a>
    </MarkdownLinkContext.Provider>
  );
}

function MarkdownImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const insideLink = useContext(MarkdownLinkContext);
  const imageAlt = typeof alt === "string" ? alt : "image";
  const imageTitle = typeof title === "string" ? title : undefined;
  if (!(typeof src === "string" && src && isRenderableMarkdownImageSrc(src))) return <MarkdownMediaUnavailable />;
  if (insideLink) {
    return (
      <ResourceImage
        src={src}
        alt={imageAlt}
        title={imageTitle}
        width={320}
        height={320}
        sizes="(max-width: 640px) 100vw, 320px"
        className={CHAT_MARKDOWN_IMAGE_CLASS}
        loading="lazy"
      />
    );
  }
  return (
    <ChatImageViewer
      src={src}
      alt={imageAlt}
      title={imageTitle}
      width={320}
      height={320}
      sizes="(max-width: 640px) 100vw, 320px"
      className={CHAT_MARKDOWN_IMAGE_CLASS}
      containerClassName={`${CHAT_MEDIA_LINK_CLASS} my-2`}
      loading="lazy"
      downloadHref={src}
      downloadFileName={mediaFileNameFromUrl(src, imageAlt)}
    />
  );
}

const CHAT_MARKDOWN_COMPONENTS: Parameters<typeof Markdown>[0]["components"] = {
  p: ({ children }) => <p className={MARKDOWN_BLOCK_CLASS}>{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children, className, node }) => {
    const language = className?.match(/language-([^\s]+)/)?.[1]?.toLowerCase();
    const { code: text, meta } = decodeCodeTextAndMeta(children, codeNodeMeta(node));
    const isBlock = Boolean(language || meta || String(children).includes("\n"));
    if (isBlock && language === "mermaid") return <MarkdownMermaidDiagram chart={text} />;
    if (isBlock) return <MarkdownCodeBlock code={text} language={language} meta={meta} />;
    return (
      <code className={MARKDOWN_INLINE_CODE_CLASS}>{children}</code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  ul: ({ children }) => <ul className={`${MARKDOWN_WRAP_CLASS} mb-2 list-disc space-y-1 pl-4`}>{children}</ul>,
  ol: ({ children }) => <ol className={`${MARKDOWN_WRAP_CLASS} mb-2 list-decimal space-y-1 pl-4`}>{children}</ol>,
  li: ({ children }) => <li className={MARKDOWN_WRAP_CLASS}>{children}</li>,
  a: ({ href, children, className }) => <MarkdownLink href={href} className={className}>{children}</MarkdownLink>,
  h1: ({ children, className }) => <h1 className={`${className ?? ""} ${MARKDOWN_WRAP_CLASS} mb-2 text-lg font-bold`}>{children}</h1>,
  h2: ({ children, className }) => <h2 className={`${className ?? ""} ${MARKDOWN_WRAP_CLASS} mb-2 text-base font-bold`}>{children}</h2>,
  h3: ({ children, className }) => <h3 className={`${className ?? ""} ${MARKDOWN_WRAP_CLASS} mb-1 text-sm font-bold`}>{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className={`${MARKDOWN_WRAP_CLASS} my-2 border-l-2 border-text-muted pl-3 italic text-text-secondary`}>{children}</blockquote>
  ),
  hr: () => <hr className="border-border my-3" />,
  table: ({ children }) => (
    <div className={MARKDOWN_TABLE_WRAP_CLASS}>
      <table className={MARKDOWN_TABLE_CLASS}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th className={`${MARKDOWN_TABLE_CELL_CLASS} font-semibold text-foreground`}>{children}</th>,
  td: ({ children }) => <td className={`${MARKDOWN_TABLE_CELL_CLASS} text-text-secondary`}>{children}</td>,
  img: ({ src, alt, title }) => (
    <MarkdownImage
      src={typeof src === "string" ? src : undefined}
      alt={typeof alt === "string" ? alt : undefined}
      title={typeof title === "string" ? title : undefined}
    />
  ),
};

function renderMarkdown(text: string, linkWorkspaceFiles: boolean) {
  const prepared = prepareMarkdownContent(text);
  return (
    <Markdown
      components={CHAT_MARKDOWN_COMPONENTS}
      rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
      remarkPlugins={markdownRemarkPlugins(prepared.abbreviations, linkWorkspaceFiles)}
      skipHtml
    >
      {prepared.content}
    </Markdown>
  );
}

export function MarkdownContent({ content, typewriter = false, className, style, onOpenWorkspaceFile }: MarkdownContentProps) {
  const displayedContent = useTypewriter(content, typewriter);
  const linkWorkspaceFiles = Boolean(onOpenWorkspaceFile);
  const renderedContent = useMemo(() => renderMarkdown(displayedContent, linkWorkspaceFiles), [displayedContent, linkWorkspaceFiles]);

  return (
    <MarkdownWorkspaceFileContext.Provider value={onOpenWorkspaceFile}>
      <div className={`prose-chat min-w-0 max-w-full overflow-hidden break-words leading-relaxed [overflow-wrap:anywhere] ${className ?? ""}`} style={style}>
        <div className="min-w-0 max-w-full overflow-hidden">{renderedContent}</div>
      </div>
    </MarkdownWorkspaceFileContext.Provider>
  );
}
