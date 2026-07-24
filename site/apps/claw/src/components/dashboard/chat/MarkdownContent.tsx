"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, Check, Copy, Info, Lightbulb, ShieldAlert, type LucideIcon } from "lucide-react";
import Markdown from "react-markdown";
import remend from "remend";
import { Prism as SyntaxHighlighter, type SyntaxHighlighterProps } from "react-syntax-highlighter";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeOptions } from "rehype-sanitize";
import remarkEmoji from "remark-emoji";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  KNOWN_FILE_EXTENSIONS,
  isImageFileReference,
  isKnownNonImageFileReference,
  knownFileExtensionsPattern,
} from "@hypercli/shared-ui/files";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { writeClipboardText } from "@/lib/browser-clipboard";
import {
  isCompleteOpenClawEmbedDirective,
  openClawEmbedFromHref,
  openClawEmbedHref,
  parseOpenClawEmbedDirective,
  sandboxedOpenClawEmbedDocument,
  type OpenClawEmbed,
} from "@/lib/openclaw-embed";
import { ChatImageViewer } from "./ChatImageViewer";
import { useTypewriter } from "./useTypewriter";
import { ResourceImage } from "@/components/ResourceImage";
import { TooltipHint } from "@/components/ClawTooltip";

interface MarkdownContentProps {
  content: string;
  typewriter?: boolean;
  isStreaming?: boolean;
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
const MERMAID_THEME_FALLBACKS = {
  dark: {
    background: "#0a0a0b",
    surface: "#141416",
    foreground: "#fafafa",
    border: "rgba(255, 255, 255, 0.24)",
    secondaryText: "#a1a1a6",
  },
  light: {
    background: "#f7f8f4",
    surface: "#ffffff",
    foreground: "#0d1511",
    border: "rgba(13, 21, 17, 0.2)",
    secondaryText: "#35463f",
  },
} as const;
const SYNTAX_BASE_STYLE: CSSProperties = {
  color: "var(--foreground)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  textAlign: "left",
  whiteSpace: "pre",
  wordBreak: "normal",
  lineHeight: 1.5,
  tabSize: 2,
};
const SYNTAX_COMMENT_STYLE: CSSProperties = { color: "var(--text-tertiary)", fontStyle: "italic" };
const SYNTAX_WARNING_STYLE: CSSProperties = { color: "var(--warning)" };
const SYNTAX_DESTRUCTIVE_STYLE: CSSProperties = { color: "var(--destructive)" };
const SYNTAX_ACCENT_STYLE: CSSProperties = { color: "var(--selection-accent)" };
const SEMANTIC_SYNTAX_THEME: NonNullable<SyntaxHighlighterProps["style"]> = {
  'code[class*="language-"]': SYNTAX_BASE_STYLE,
  'pre[class*="language-"]': SYNTAX_BASE_STYLE,
  comment: SYNTAX_COMMENT_STYLE,
  prolog: SYNTAX_COMMENT_STYLE,
  cdata: SYNTAX_COMMENT_STYLE,
  punctuation: { color: "var(--text-secondary)" },
  doctype: { color: "var(--text-secondary)" },
  entity: { color: "var(--text-secondary)" },
  "attr-name": SYNTAX_WARNING_STYLE,
  "class-name": SYNTAX_WARNING_STYLE,
  boolean: SYNTAX_WARNING_STYLE,
  constant: SYNTAX_WARNING_STYLE,
  number: SYNTAX_WARNING_STYLE,
  atrule: SYNTAX_WARNING_STYLE,
  keyword: SYNTAX_ACCENT_STYLE,
  property: SYNTAX_DESTRUCTIVE_STYLE,
  tag: SYNTAX_DESTRUCTIVE_STYLE,
  symbol: SYNTAX_DESTRUCTIVE_STYLE,
  deleted: SYNTAX_DESTRUCTIVE_STYLE,
  important: SYNTAX_DESTRUCTIVE_STYLE,
  selector: { color: "var(--success)" },
  string: { color: "var(--success)" },
  char: { color: "var(--success)" },
  builtin: { color: "var(--success)" },
  inserted: { color: "var(--success)" },
  regex: { color: "var(--success)" },
  "attr-value": { color: "var(--success)" },
  variable: SYNTAX_ACCENT_STYLE,
  operator: { color: "var(--text-secondary)" },
  function: SYNTAX_ACCENT_STYLE,
  url: SYNTAX_ACCENT_STYLE,
  bold: { fontWeight: 700 },
  italic: { fontStyle: "italic" },
};
export const CHAT_MARKDOWN_IMAGE_CLASS = "h-auto max-h-[320px] max-w-full rounded-md object-contain sm:max-w-[320px]";
export const CHAT_MEDIA_LINK_CLASS = "block max-w-full";
const CODE_META_MARKER = "__OPENCLAW_CODE_META__:";
const WORKSPACE_FILE_LINK_PREFIX = "#openclaw-file/";
const FILE_MENTION_EXTENSIONS = knownFileExtensionsPattern();
const FILE_MENTION_EXTENSION_SET = new Set(KNOWN_FILE_EXTENSIONS);
const FILE_MENTION_PATTERN = new RegExp(
  `(^|[\\s([{<"'])([^\\s)\\]}>"',;:!?]+\\.(?:${FILE_MENTION_EXTENSIONS}))(?=$|[\\s)\\]}>"',.;:!?])`,
  "gi",
);
const MARKDOWN_SANITIZE_SCHEMA: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "abbr", "video"],
  attributes: {
    ...defaultSchema.attributes,
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), ["dataAlertType", "note", "tip", "important", "warning", "caution"]],
    source: [...(defaultSchema.attributes?.source ?? []), "src", "type"],
    video: ["src", "title"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data", "blob"],
  },
};
const MARKDOWN_REHYPE_PLUGINS: NonNullable<Parameters<typeof Markdown>[0]["rehypePlugins"]> = [
  rehypeSupportedHtml,
  rehypeRaw,
  [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA],
  rehypeKatex,
];
const MarkdownLinkContext = createContext(false);
const MarkdownStreamingContext = createContext(false);
const MarkdownWorkspaceFileContext = createContext<((path: string) => void) | undefined>(undefined);
let mermaidImportPromise: Promise<typeof import("mermaid")> | null = null;
let mermaidRenderAttemptId = 0;

interface MarkdownAbbreviation {
  term: string;
  title: string;
}

type MarkdownAlertType = "note" | "tip" | "important" | "warning" | "caution";

const MARKDOWN_ALERTS: Record<MarkdownAlertType, { label: string; icon: LucideIcon; className: string; iconClassName: string }> = {
  note: {
    label: "Note",
    icon: Info,
    className: "border-info/50 bg-info/8",
    iconClassName: "text-info",
  },
  tip: {
    label: "Tip",
    icon: Lightbulb,
    className: "border-primary/50 bg-primary/8",
    iconClassName: "text-primary",
  },
  important: {
    label: "Important",
    icon: ShieldAlert,
    className: "border-primary/50 bg-primary/8",
    iconClassName: "text-primary",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    className: "border-warning/50 bg-warning/8",
    iconClassName: "text-warning",
  },
  caution: {
    label: "Caution",
    icon: AlertCircle,
    className: "border-destructive/50 bg-destructive/8",
    iconClassName: "text-destructive",
  },
};

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

function isVideoHtmlBlock(value: string): boolean {
  const trimmed = value.trim();
  if (!/^<video(?:\s|>)/i.test(trimmed) || !/<\/video\s*>$/i.test(trimmed) || trimmed.includes("<!--")) return false;
  const tags = trimmed.match(/<\/?[A-Za-z][^>]*>/g) ?? [];
  if (tags.length < 2 || !/^<video(?:\s|>)/i.test(tags[0] ?? "") || !/^<\/video\s*>$/i.test(tags.at(-1) ?? "")) return false;
  return tags.slice(1, -1).every((tag) => /^<source(?:\s|\/?>)/i.test(tag));
}

function isKbdHtmlTag(value: string): boolean {
  const trimmed = value.trim();
  return /^<kbd(?:\s+[^<>]*)?>$/i.test(trimmed) || /^<\/kbd\s*>$/i.test(trimmed);
}

function retainSupportedHtmlInAst(node: unknown): void {
  if (!isRecord(node)) return;
  const children = Array.isArray(node.children) ? node.children : null;
  if (!children) return;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!isRecord(child)) continue;
    if (child.type === "raw") {
      if (!(typeof child.value === "string" && (isVideoHtmlBlock(child.value) || isKbdHtmlTag(child.value)))) {
        children.splice(index, 1);
        index -= 1;
      }
      continue;
    }
    retainSupportedHtmlInAst(child);
  }
}

function rehypeSupportedHtml() {
  return (tree: unknown) => retainSupportedHtmlInAst(tree);
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

function nodeSourceText(node: Record<string, unknown>, source: string): string | null {
  const position = isRecord(node.position) ? node.position : null;
  const start = isRecord(position?.start) && typeof position.start.offset === "number" ? position.start.offset : null;
  const end = isRecord(position?.end) && typeof position.end.offset === "number" ? position.end.offset : null;
  return start != null && end != null ? source.slice(start, end) : null;
}

function applyOpenClawEmbedsToAst(node: unknown, source: string): void {
  if (!isRecord(node)) return;
  const children = Array.isArray(node.children) ? node.children : null;
  if (!children) return;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!isRecord(child)) continue;
    if (child.type === "paragraph") {
      const directiveSource = nodeSourceText(child, source);
      if (directiveSource && isCompleteOpenClawEmbedDirective(directiveSource)) {
        const embed = parseOpenClawEmbedDirective(directiveSource);
        children[index] = embed
          ? {
            type: "link",
            url: openClawEmbedHref(embed),
            children: [{ type: "text", value: embed.title }],
          }
          : {
            type: "paragraph",
            children: [{ type: "text", value: directiveSource.trim() }],
          };
        continue;
      }
    }
    applyOpenClawEmbedsToAst(child, source);
  }
}

function markdownAlertType(value: unknown): MarkdownAlertType | null {
  return typeof value === "string" && value in MARKDOWN_ALERTS ? value as MarkdownAlertType : null;
}

function applyMarkdownAlertsToAst(node: unknown): void {
  if (!isRecord(node)) return;
  const children = Array.isArray(node.children) ? node.children : null;
  if (!children) return;

  if (node.type === "blockquote") {
    const firstParagraph = isRecord(children[0]) && children[0].type === "paragraph" ? children[0] : null;
    const paragraphChildren = firstParagraph && Array.isArray(firstParagraph.children) ? firstParagraph.children : null;
    const firstText = paragraphChildren && isRecord(paragraphChildren[0]) && paragraphChildren[0].type === "text" ? paragraphChildren[0] : null;
    if (firstText && typeof firstText.value === "string") {
      const marker = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:[ \t]*\n[ \t]*|[ \t]+|$)/i.exec(firstText.value);
      const type = markdownAlertType(marker?.[1]?.toLowerCase());
      if (marker && type) {
        const nextText = firstText.value.slice(marker[0].length);
        if (nextText) firstText.value = nextText;
        else paragraphChildren?.shift();
        if (paragraphChildren?.length === 0) children.shift();
        const data = isRecord(node.data) ? node.data : {};
        const hProperties = isRecord(data.hProperties) ? data.hProperties : {};
        node.data = { ...data, hProperties: { ...hProperties, dataAlertType: type } };
      }
    }
  }

  for (const child of children) applyMarkdownAlertsToAst(child);
}

function remarkAbbreviations(abbreviations: MarkdownAbbreviation[]) {
  return function transformAbbreviations() {
    return (tree: unknown) => applyAbbreviationsToAst(tree, abbreviations);
  };
}

function remarkCodeMeta() {
  return (tree: unknown) => applyCodeMetaToAst(tree);
}

function remarkOpenClawEmbeds(source: string) {
  return () => (tree: unknown) => applyOpenClawEmbedsToAst(tree, source);
}

function remarkMarkdownAlerts() {
  return (tree: unknown) => applyMarkdownAlertsToAst(tree);
}

function remarkWorkspaceFileLinks() {
  return (tree: unknown) => applyWorkspaceFileLinksToAst(tree);
}

function markdownRemarkPlugins(abbreviations: MarkdownAbbreviation[], linkWorkspaceFiles: boolean, source: string): NonNullable<Parameters<typeof Markdown>[0]["remarkPlugins"]> {
  return [
    remarkGfm,
    remarkMath,
    [remarkEmoji, { emoticon: false }],
    remarkMarkdownAlerts,
    remarkOpenClawEmbeds(source),
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
  if (isImageFileReference(trimmed)) return true;
  if (/^(?:https?:\/\/|\/)/i.test(trimmed)) return !isKnownNonImageFileReference(trimmed);
  return false;
}

function isRenderableMarkdownVideoSrc(src: string): boolean {
  const trimmed = src.trim();
  const normalized = trimmed.replace(/^\/+/, "");
  if (!trimmed || /^(?:media:|javascript:|file:)/i.test(trimmed)) return false;
  if (/^(?:home\/node\/\.openclaw\/workspace|\.?openclaw\/workspace|workspace|home)(?:\/|$)/i.test(normalized)) return false;
  if (/^(?:data:video\/|blob:|https?:\/\/|\/)/i.test(trimmed)) return true;
  return /\.(?:mp4|m4v|mov|webm|ogv|ogg)(?:[?#].*)?$/i.test(trimmed);
}

function concreteMermaidColor(styles: CSSStyleDeclaration, property: string, fallback: string): string {
  const value = styles.getPropertyValue(property).trim();
  return /^(?:#[\dA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[A-Za-z]+)$/i.test(value) ? value : fallback;
}

function resolvedMermaidThemeVariables() {
  const root = document.documentElement;
  const styles = window.getComputedStyle(root);
  const fallback = root.getAttribute("data-theme") === "light" ? MERMAID_THEME_FALLBACKS.light : MERMAID_THEME_FALLBACKS.dark;
  const surface = concreteMermaidColor(styles, "--surface-low", fallback.surface);
  const foreground = concreteMermaidColor(styles, "--foreground", fallback.foreground);
  return {
    background: concreteMermaidColor(styles, "--background", fallback.background),
    mainBkg: surface,
    primaryColor: surface,
    primaryTextColor: foreground,
    primaryBorderColor: concreteMermaidColor(styles, "--border-medium", fallback.border),
    lineColor: concreteMermaidColor(styles, "--text-secondary", fallback.secondaryText),
    textColor: foreground,
  };
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
  const isStreaming = useContext(MarkdownStreamingContext);
  const reactId = useId();
  const diagramIdPrefix = useMemo(() => `markdown-mermaid-${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`, [reactId]);
  const activeAttemptRef = useRef(0);
  const [result, setResult] = useState<{ chart: string; svg: string; error: string | null } | null>(null);
  const currentResult = result?.chart === chart ? result : null;
  const trimmedChart = chart.trim();
  const svg = currentResult?.svg ?? "";
  const error = !trimmedChart ? "Diagram is empty." : currentResult?.error ?? null;

  useEffect(() => {
    if (!trimmedChart) return;
    const attemptId = ++mermaidRenderAttemptId;
    const diagramId = `${diagramIdPrefix}-${attemptId}`;
    activeAttemptRef.current = attemptId;

    async function renderDiagram() {
      try {
        const { default: mermaid } = await (mermaidImportPromise ??= import("mermaid"));
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: resolvedMermaidThemeVariables(),
        });
        const result = await mermaid.render(diagramId, trimmedChart);
        if (activeAttemptRef.current === attemptId) {
          setResult({ chart, svg: result.svg, error: null });
        }
      } catch (err) {
        if (activeAttemptRef.current === attemptId) {
          setResult({ chart, svg: "", error: err instanceof Error ? err.message : "Could not render diagram." });
        }
      }
    }

    void renderDiagram();

    return () => {
      if (activeAttemptRef.current === attemptId) activeAttemptRef.current = 0;
    };
  }, [chart, diagramIdPrefix, trimmedChart]);

  if (error && !isStreaming) {
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
  const [copyState, setCopyState] = useState<{ code: string; status: "idle" | "copied" | "failed" }>({
    code: "",
    status: "idle",
  });
  const copyResetTimerRef = useRef<number | null>(null);
  const copyStatus = copyState.code === code ? copyState.status : "idle";
  const codeLabel = language && language !== "text" ? `${language} code` : "code";

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
  }, []);

  const copyCode = async () => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
    const copied = await writeClipboardText(code);
    setCopyState({ code, status: copied ? "copied" : "failed" });
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopyState((current) => current.code === code ? { code, status: "idle" } : current);
      copyResetTimerRef.current = null;
    }, 2_000);
  };

  return (
    <figure className={MARKDOWN_CODE_BLOCK_CLASS}>
      <figcaption className="flex min-w-0 items-center justify-between gap-3 border-b border-border/70 px-3 py-1.5 text-[10px] uppercase tracking-wide text-text-muted">
        <span className="truncate font-mono">{language || "code"}</span>
        <span className="flex shrink-0 items-center gap-2">
          {codeMeta.showLineNumbers && <span>Line numbers</span>}
          <button
            type="button"
            onClick={() => { void copyCode(); }}
            aria-label={copyStatus === "copied" ? "Code copied" : copyStatus === "failed" ? `Copy ${codeLabel} failed; try again` : `Copy ${codeLabel}`}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-medium tracking-normal transition-colors hover:bg-surface-low hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--selection-accent-rgb)_/_0.45)]"
          >
            {copyStatus === "copied" ? <Check aria-hidden="true" className="h-3 w-3" /> : <Copy aria-hidden="true" className="h-3 w-3" />}
            <span aria-live="polite">{copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Retry" : "Copy"}</span>
          </button>
        </span>
      </figcaption>
      <SyntaxHighlighter
        language={language || "text"}
        style={SEMANTIC_SYNTAX_THEME}
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
  const embed = openClawEmbedFromHref(href);
  if (embed) return <MarkdownOpenClawEmbed embed={embed} />;
  const workspacePath = workspacePathFromHref(href);
  const isExternal = typeof href === "string" && /^(?:https?:|mailto:|irc:|ircs:|xmpp:)/i.test(href);
  const link = (
    <a
      href={href}
      onClick={workspacePath && onOpenWorkspaceFile ? (event) => {
        event.preventDefault();
        onOpenWorkspaceFile(workspacePath);
      } : undefined}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className={`${className ?? ""} break-words text-accent hover:underline [overflow-wrap:anywhere]`}
    >
      {children}
    </a>
  );
  return (
    <MarkdownLinkContext.Provider value={Boolean(href)}>
      {workspacePath ? <TooltipHint label="Open in files">{link}</TooltipHint> : link}
    </MarkdownLinkContext.Provider>
  );
}

function MarkdownImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const insideLink = useContext(MarkdownLinkContext);
  const imageAlt = typeof alt === "string" ? alt : "image";
  const imageTitle = typeof title === "string" ? title : undefined;
  if (!(typeof src === "string" && src && isRenderableMarkdownImageSrc(src))) return <MarkdownMediaUnavailable />;
  if (insideLink) {
    const image = (
      <ResourceImage
        src={src}
        alt={imageAlt}
        width={320}
        height={320}
        sizes="(max-width: 640px) 100vw, 320px"
        className={CHAT_MARKDOWN_IMAGE_CLASS}
        loading="lazy"
      />
    );
    return imageTitle ? (
      <TooltipHint label={imageTitle}>
        <span className="inline-flex" tabIndex={0}>{image}</span>
      </TooltipHint>
    ) : image;
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

function MarkdownVideo({ src, title, children }: { src?: string; title?: string; children?: ReactNode }) {
  const videoSrc = typeof src === "string" && isRenderableMarkdownVideoSrc(src) ? src : undefined;
  const label = title || (videoSrc ? mediaFileNameFromUrl(videoSrc, "video") : "Video preview");
  return (
    <video
      src={videoSrc}
      controls
      playsInline
      preload="metadata"
      title={title}
      aria-label={label === "Video preview" ? label : `Video preview ${label}`}
      className="my-2 max-h-[320px] w-full max-w-[28rem] rounded-md border border-border bg-black"
    >
      {children}
    </video>
  );
}

function MarkdownVideoSource({ src, type }: { src?: string; type?: string }) {
  if (!(typeof src === "string" && isRenderableMarkdownVideoSrc(src))) return null;
  const sourceType = typeof type === "string" && /^video\/[A-Za-z0-9.+-]+$/i.test(type) ? type : undefined;
  return <source src={src} type={sourceType} />;
}

function MarkdownOpenClawEmbed({ embed }: { embed: OpenClawEmbed }) {
  return (
    <figure className="my-2 w-full max-w-[40rem] overflow-hidden rounded-lg border border-border bg-background/50">
      <figcaption className="border-b border-border/70 px-3 py-2 text-xs font-medium text-text-secondary">
        {embed.title}
      </figcaption>
      <iframe
        title={embed.title}
        srcDoc={sandboxedOpenClawEmbedDocument(embed.html)}
        sandbox=""
        referrerPolicy="no-referrer"
        loading="lazy"
        className="block w-full border-0 bg-white"
        style={{ height: `${embed.height}px` }}
      />
    </figure>
  );
}

function MarkdownAlert({ type, children }: { type: MarkdownAlertType; children?: ReactNode }) {
  const alert = MARKDOWN_ALERTS[type];
  const Icon = alert.icon;
  return (
    <aside
      role="note"
      aria-label={`${alert.label} callout`}
      className={`${MARKDOWN_WRAP_CLASS} my-3 rounded-r-lg border-l-[3px] px-3 py-2.5 ${alert.className}`}
    >
      <div className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${alert.iconClassName}`}>
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>{alert.label}</span>
      </div>
      <div className="text-text-secondary [&>*:last-child]:mb-0">{children}</div>
    </aside>
  );
}

function markdownAlertTypeFromNode(node: unknown): MarkdownAlertType | null {
  if (!isRecord(node) || !isRecord(node.properties)) return null;
  return markdownAlertType(node.properties.dataAlertType);
}

function MarkdownTaskCheckbox({ initialChecked }: { initialChecked: boolean }) {
  const [checked, setChecked] = useState(initialChecked);
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => setChecked(event.currentTarget.checked)}
      aria-label={checked ? "Mark task incomplete" : "Mark task complete"}
      title="Toggle task locally"
      className="mr-2 h-4 w-4 shrink-0 cursor-pointer align-middle accent-[var(--selection-accent)]"
    />
  );
}

const CHAT_MARKDOWN_COMPONENTS: Parameters<typeof Markdown>[0]["components"] = {
  p: ({ children }) => <p className={MARKDOWN_BLOCK_CLASS}>{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  kbd: ({ children }) => (
    <kbd className="mx-0.5 inline-flex min-h-5 min-w-5 items-center justify-center rounded border border-border border-b-2 bg-surface-low px-1.5 py-0.5 align-baseline font-mono text-[0.8em] font-medium leading-none text-foreground">
      {children}
    </kbd>
  ),
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
  ul: ({ children, className }) => {
    const taskList = className?.split(/\s+/).includes("contains-task-list") ?? false;
    return (
      <ul className={`${MARKDOWN_WRAP_CLASS} mb-2 space-y-1 pl-5 ${taskList ? "list-none" : "list-disc"} ${className ?? ""}`}>
        {children}
      </ul>
    );
  },
  ol: ({ children, className }) => <ol className={`${MARKDOWN_WRAP_CLASS} mb-2 list-decimal space-y-1 pl-5 ${className ?? ""}`}>{children}</ol>,
  li: ({ children, className }) => <li className={`${MARKDOWN_WRAP_CLASS} ${className ?? ""}`}>{children}</li>,
  input: ({ type, checked, disabled, node, ...props }) => {
    void node;
    if (type === "checkbox") {
      return <MarkdownTaskCheckbox key={checked ? "checked" : "unchecked"} initialChecked={Boolean(checked)} />;
    }
    return <input {...props} type={type} disabled={disabled} />;
  },
  a: ({ href, children, className }) => <MarkdownLink href={href} className={className}>{children}</MarkdownLink>,
  abbr: ({ children, title }) => {
    const label = typeof title === "string" ? title : undefined;
    const abbreviation = <abbr tabIndex={label ? 0 : undefined}>{children}</abbr>;
    return label ? <TooltipHint label={label}>{abbreviation}</TooltipHint> : abbreviation;
  },
  h1: ({ children, className }) => <h1 className={`${className ?? ""} ${MARKDOWN_WRAP_CLASS} mb-2 text-lg font-bold`}>{children}</h1>,
  h2: ({ children, className }) => <h2 className={`${className ?? ""} ${MARKDOWN_WRAP_CLASS} mb-2 text-base font-bold`}>{children}</h2>,
  h3: ({ children, className }) => <h3 className={`${className ?? ""} ${MARKDOWN_WRAP_CLASS} mb-1 text-sm font-bold`}>{children}</h3>,
  blockquote: ({ children, node }) => {
    const alertType = markdownAlertTypeFromNode(node);
    return alertType
      ? <MarkdownAlert type={alertType}>{children}</MarkdownAlert>
      : <blockquote className={`${MARKDOWN_WRAP_CLASS} my-2 border-l-2 border-text-muted pl-3 italic text-text-secondary`}>{children}</blockquote>;
  },
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
  video: ({ src, title, children }) => (
    <MarkdownVideo
      src={typeof src === "string" ? src : undefined}
      title={typeof title === "string" ? title : undefined}
    >
      {children}
    </MarkdownVideo>
  ),
  source: ({ src, type }) => (
    <MarkdownVideoSource
      src={typeof src === "string" ? src : undefined}
      type={typeof type === "string" ? type : undefined}
    />
  ),
};

function renderMarkdown(text: string, linkWorkspaceFiles: boolean) {
  const prepared = prepareMarkdownContent(text);
  return (
    <Markdown
      components={CHAT_MARKDOWN_COMPONENTS}
      rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
      remarkPlugins={markdownRemarkPlugins(prepared.abbreviations, linkWorkspaceFiles, prepared.content)}
    >
      {prepared.content}
    </Markdown>
  );
}

export function MarkdownContent({ content, typewriter = false, isStreaming = false, className, style, onOpenWorkspaceFile }: MarkdownContentProps) {
  const displayedContent = useTypewriter(content, typewriter);
  const renderableContent = useMemo(
    () => isStreaming ? remend(displayedContent, { linkMode: "text-only" }) : displayedContent,
    [displayedContent, isStreaming],
  );
  const linkWorkspaceFiles = Boolean(onOpenWorkspaceFile);
  const renderedContent = useMemo(() => renderMarkdown(renderableContent, linkWorkspaceFiles), [linkWorkspaceFiles, renderableContent]);

  return (
    <MarkdownStreamingContext.Provider value={isStreaming}>
      <MarkdownWorkspaceFileContext.Provider value={onOpenWorkspaceFile}>
        <div className={`prose-chat min-w-0 max-w-full overflow-hidden break-words leading-relaxed [overflow-wrap:anywhere] ${className ?? ""}`} style={style}>
          <div className="min-w-0 max-w-full overflow-hidden">{renderedContent}</div>
        </div>
      </MarkdownWorkspaceFileContext.Provider>
    </MarkdownStreamingContext.Provider>
  );
}
