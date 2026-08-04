"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, Check, Copy, Info, Lightbulb, ShieldAlert, type LucideIcon } from "lucide-react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import { Prism as SyntaxHighlighter, type SyntaxHighlighterProps } from "react-syntax-highlighter";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeOptions } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  KNOWN_FILE_EXTENSIONS,
  isAudioFileReference,
  isImageFileReference,
  isKnownNonImageFileReference,
  knownFileExtensionsPattern,
} from "@hypercli/shared-ui/files";
import { normalizeOpenClawWorkspaceFilePath } from "@/lib/agent-file-path";
import { writeClipboardText } from "@/lib/browser-clipboard";
import { isSafeDirectMediaUrl } from "@/lib/chat-media";
import {
  isCompleteOpenClawEmbedDirective,
  openClawEmbedFromHref,
  openClawEmbedHref,
  parseOpenClawEmbedDirective,
  type OpenClawEmbed,
} from "@/lib/openclaw-embed";
import { ChatImageViewer } from "./ChatImageViewer";
import { AudioPlayer } from "./AudioPlayer";
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
const SAFE_SVG_TAG_NAMES = new Set(["circle", "desc", "ellipse", "g", "line", "path", "polygon", "polyline", "rect", "svg", "text", "title", "tspan"]);
const SAFE_PICTURE_TAG_NAMES = new Set(["img", "picture", "source"]);
const SAFE_FIGURE_TAG_NAMES = new Set(["audio", "figcaption", "img", "picture", "svg", "video"]);
const SAFE_FIGCAPTION_TAG_NAMES = new Set(["a", "abbr", "b", "br", "cite", "code", "del", "em", "i", "kbd", "s", "small", "span", "strong", "sub", "sup"]);
const SAFE_INDICATOR_FALLBACK_TAG_NAMES = new Set(["abbr", "b", "br", "code", "em", "i", "span", "strong"]);
const SAFE_SVG_COLOR = /^(?:none|currentColor|transparent|#[\dA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[A-Za-z]+)$/i;
const SAFE_SVG_PAINT_ATTRIBUTES: Array<string | [string, RegExp]> = [
  ["fill", SAFE_SVG_COLOR],
  ["stroke", SAFE_SVG_COLOR],
  "fillOpacity",
  "opacity",
  "strokeDasharray",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeOpacity",
  "strokeWidth",
  "transform",
  "vectorEffect",
];
const MARKDOWN_SANITIZE_SCHEMA: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "abbr", "audio", "circle", "desc", "ellipse", "figcaption", "figure", "g", "line", "meter", "path", "polygon", "polyline", "progress", "rect", "svg", "text", "title", "tspan", "video"],
  attributes: {
    ...defaultSchema.attributes,
    audio: ["src", "title"],
    blockquote: [
      ...(defaultSchema.attributes?.blockquote ?? []),
      ["dataAlertType", "note", "tip", "important", "warning", "caution"],
      ["dataSecurityNotice", "iframe", "object", "canvas", "embed"],
      "dataSecurityFallback",
    ],
    figure: [...(defaultSchema.attributes?.figure ?? []), ["dataMediaGallery", "true"]],
    img: [...(defaultSchema.attributes?.img ?? []), ["fetchPriority", "high", "low", "auto"]],
    meter: ["high", "low", "max", "min", "optimum", "value"],
    progress: ["max", "value"],
    source: [...(defaultSchema.attributes?.source ?? []), "src", "type"],
    svg: ["ariaLabel", "height", "preserveAspectRatio", ["role", "img", "presentation"], "viewBox", "width"],
    g: SAFE_SVG_PAINT_ATTRIBUTES,
    path: ["d", "pathLength", ...SAFE_SVG_PAINT_ATTRIBUTES],
    circle: ["cx", "cy", "r", ...SAFE_SVG_PAINT_ATTRIBUTES],
    ellipse: ["cx", "cy", "rx", "ry", ...SAFE_SVG_PAINT_ATTRIBUTES],
    line: ["x1", "x2", "y1", "y2", ...SAFE_SVG_PAINT_ATTRIBUTES],
    polygon: ["points", ...SAFE_SVG_PAINT_ATTRIBUTES],
    polyline: ["points", ...SAFE_SVG_PAINT_ATTRIBUTES],
    rect: ["height", "rx", "ry", "width", "x", "y", ...SAFE_SVG_PAINT_ATTRIBUTES],
    text: ["dominantBaseline", "fontSize", "fontWeight", "textAnchor", "x", "y", ...SAFE_SVG_PAINT_ATTRIBUTES],
    tspan: ["dx", "dy", "fontSize", "fontWeight", "textAnchor", "x", "y", ...SAFE_SVG_PAINT_ATTRIBUTES],
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
  rehypeReplaceBlockedActiveContent,
  rehypeRestrictSvg,
  [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA],
  rehypeKatex,
];
const MarkdownLinkContext = createContext(false);
const MarkdownImageGalleryContext = createContext(false);
const MarkdownPictureContext = createContext(false);
const MarkdownStreamingContext = createContext(false);
const MarkdownWorkspaceFileContext = createContext<((path: string) => void) | undefined>(undefined);
let mermaidImportPromise: Promise<typeof import("mermaid")> | null = null;
let mermaidRenderAttemptId = 0;

interface MarkdownAbbreviation {
  term: string;
  title: string;
}

type MarkdownAlertType = "note" | "tip" | "important" | "warning" | "caution";
type MarkdownSecurityNoticeType = "iframe" | "object" | "canvas" | "embed";

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
  if (/^data:/i.test(url.trim())) return fallback;
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

function isMediaHtmlBlock(value: string, tagName: "audio" | "video"): boolean {
  const trimmed = value.trim();
  const openingTag = new RegExp(`^<${tagName}(?:\\s|>)`, "i");
  const closingTag = new RegExp(`^<\\/${tagName}\\s*>$`, "i");
  const closingBlock = new RegExp(`<\\/${tagName}\\s*>$`, "i");
  if (!openingTag.test(trimmed) || !closingBlock.test(trimmed) || trimmed.includes("<!--")) return false;
  const tags = trimmed.match(/<\/?[A-Za-z][^>]*>/g) ?? [];
  if (tags.length < 2 || !openingTag.test(tags[0] ?? "") || !closingTag.test(tags.at(-1) ?? "")) return false;
  return tags.slice(1, -1).every((tag) => /^<source(?:\s|\/?>)/i.test(tag));
}

function isImageHtmlTag(value: string): boolean {
  return /^<img(?:\s+[^<>]*)?\/?>$/i.test(value.trim());
}

function isIframeHtmlBlock(value: string): boolean {
  const trimmed = value.trim();
  if (!/^<iframe(?:\s|>)/i.test(trimmed)) return false;
  return /<\/iframe\s*>$/i.test(trimmed) || /^<iframe(?:\s+[^<>]*)?\/>$/i.test(trimmed);
}

function isOpeningRawHtmlTag(value: string, tagName: string): boolean {
  return new RegExp(`^<${tagName}(?:\\s+[^<>]*)?>$`, "i").test(value.trim());
}

function isClosingRawHtmlTag(value: string, tagName: string): boolean {
  return new RegExp(`^<\\/${tagName}\\s*>$`, "i").test(value.trim());
}

function isEmbedHtmlTag(value: string): boolean {
  return /^<embed(?:\s+[^<>]*)?\/?>$/i.test(value.trim());
}

function securityNoticeAstNode(type: MarkdownSecurityNoticeType, fallback = ""): Record<string, unknown> {
  return {
    type: "element",
    tagName: "blockquote",
    properties: {
      dataSecurityNotice: type,
      ...(fallback ? { dataSecurityFallback: fallback.slice(0, 500) } : {}),
    },
    children: [],
  };
}

function closingRawHtmlTagIndex(children: unknown[], startIndex: number, tagName: string): number {
  return children.findIndex((candidate, index) => (
    index > startIndex && isRecord(candidate) && candidate.type === "raw" &&
    typeof candidate.value === "string" && isClosingRawHtmlTag(candidate.value, tagName)
  ));
}

function activeContentFallbackFromRange(children: unknown[]): string {
  const suppressedTags: string[] = [];
  const text: string[] = [];
  for (const child of children) {
    if (!isRecord(child)) continue;
    if (child.type === "raw" && typeof child.value === "string") {
      const closingTag = [...suppressedTags].reverse().find((tagName) => isClosingRawHtmlTag(child.value as string, tagName));
      if (closingTag) {
        suppressedTags.splice(suppressedTags.lastIndexOf(closingTag), 1);
        continue;
      }
      const openingTag = ["canvas", "iframe", "object", "script", "style"].find((tagName) => isOpeningRawHtmlTag(child.value as string, tagName));
      if (openingTag) suppressedTags.push(openingTag);
      continue;
    }
    if (suppressedTags.length === 0) text.push(activeContentFallbackText(child));
  }
  return text.join(" ").replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

function imageGalleryHtml(value: string): string | null {
  const trimmed = value.trim();
  const wrapper = /^<div(?:\s+[^<>]*)?>([\s\S]*)<\/div\s*>$/i.exec(trimmed);
  const inner = wrapper?.[1] ?? trimmed;
  const imagePattern = /<img(?:\s+[^<>]*)?\/?>/gi;
  const images = inner.match(imagePattern) ?? [];
  if (images.length < 2 || inner.replace(imagePattern, "").trim()) return null;
  return images.join("\n");
}

function isActiveContentHtmlBlock(value: string, tagName: "object" | "canvas"): boolean {
  const trimmed = value.trim();
  return new RegExp(`^<${tagName}(?:\\s|>)[\\s\\S]*<\\/${tagName}\\s*>$`, "i").test(trimmed);
}

function isCompleteRawHtmlBlock(value: string, tagName: "script" | "style"): boolean {
  const trimmed = value.trim();
  return new RegExp(`^<${tagName}(?:\\s|>)[\\s\\S]*<\\/${tagName}\\s*>$`, "i").test(trimmed);
}

function isNativeIndicatorHtmlBlock(value: string, tagName: "meter" | "progress"): boolean {
  const trimmed = value.trim();
  return new RegExp(`^<${tagName}(?:\\s|>)[\\s\\S]*<\\/${tagName}\\s*>$`, "i").test(trimmed);
}

function canvasHtmlWithoutTrailingScripts(value: string): string | null {
  const match = /^(<canvas(?:\s|>)[\s\S]*?<\/canvas\s*>)([\s\S]*)$/i.exec(value.trim());
  if (!match?.[1] || !/^(?:\s*<script(?:\s|>)[\s\S]*?<\/script\s*>)*\s*$/i.test(match[2] ?? "")) return null;
  return match[1];
}

function isSvgHtmlBlock(value: string): boolean {
  const trimmed = value.trim();
  return /^<svg(?:\s|>)/i.test(trimmed) && /<\/svg\s*>$/i.test(trimmed);
}

function isPictureHtmlBlock(value: string): boolean {
  const trimmed = value.trim();
  return /^<picture(?:\s|>)/i.test(trimmed) && /<\/picture\s*>$/i.test(trimmed);
}

function isFigureHtmlBlock(value: string): boolean {
  const trimmed = value.trim();
  return /^<figure(?:\s|>)/i.test(trimmed) && /<\/figure\s*>$/i.test(trimmed);
}

function isOpeningFigureHtmlTag(value: string): boolean {
  return /^<figure(?:\s+[^<>]*)?>$/i.test(value.trim());
}

function isClosingFigureHtmlTag(value: string): boolean {
  return /^<\/figure\s*>$/i.test(value.trim());
}

function isOpeningPictureHtmlTag(value: string): boolean {
  return /^<picture(?:\s+[^<>]*)?>$/i.test(value.trim());
}

function isClosingPictureHtmlTag(value: string): boolean {
  return /^<\/picture\s*>$/i.test(value.trim());
}

function isOpeningSvgHtmlTag(value: string): boolean {
  return /^<svg(?:\s+[^<>]*)?>$/i.test(value.trim());
}

function isClosingSvgHtmlTag(value: string): boolean {
  return /^<\/svg\s*>$/i.test(value.trim());
}

function retainSupportedHtmlInAst(node: unknown): void {
  if (!isRecord(node)) return;
  const children = Array.isArray(node.children) ? node.children : null;
  if (!children) return;
  let inlineAudioOrVideoOpen: "audio" | "video" | null = null;
  let inlineFigureOpen = false;
  let inlineIndicatorOpen: "meter" | "progress" | null = null;
  let inlineKbdOpen = false;
  let inlineSvgOpen = false;
  let inlinePictureOpen = false;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!isRecord(child)) continue;
    if (child.type === "raw") {
      let raw = typeof child.value === "string" ? child.value : "";
      const pairedTag = (["iframe", "object", "canvas"] as const).find((tagName) => isOpeningRawHtmlTag(raw, tagName));
      if (pairedTag) {
        const closingIndex = closingRawHtmlTagIndex(children, index, pairedTag);
        if (closingIndex < 0) {
          child.type = "text";
          continue;
        }
        const fallback = pairedTag === "object" || pairedTag === "canvas"
          ? activeContentFallbackFromRange(children.slice(index + 1, closingIndex))
          : "";
        children.splice(index, closingIndex - index + 1, securityNoticeAstNode(pairedTag, fallback));
        continue;
      }
      const strippedTag = (["script", "style"] as const).find((tagName) => isOpeningRawHtmlTag(raw, tagName));
      if (strippedTag) {
        const closingIndex = closingRawHtmlTagIndex(children, index, strippedTag);
        if (closingIndex < 0) {
          child.type = "text";
          continue;
        }
        children.splice(index, closingIndex - index + 1);
        index -= 1;
        continue;
      }
      if (isCompleteRawHtmlBlock(raw, "script") || isCompleteRawHtmlBlock(raw, "style")) {
        children.splice(index, 1);
        index -= 1;
        continue;
      }
      if (isEmbedHtmlTag(raw)) {
        children[index] = securityNoticeAstNode("embed");
        continue;
      }
      if (isIframeHtmlBlock(raw)) {
        children[index] = securityNoticeAstNode("iframe");
        continue;
      }
      const splitIndicatorTag = (["meter", "progress"] as const).find((tagName) => isOpeningRawHtmlTag(raw, tagName));
      if (splitIndicatorTag && closingRawHtmlTagIndex(children, index, splitIndicatorTag) < 0) {
        child.type = "text";
        continue;
      }
      const gallery = imageGalleryHtml(raw);
      if (gallery) {
        child.value = `<figure data-media-gallery="true">${gallery}</figure>`;
        continue;
      }
      const canvas = canvasHtmlWithoutTrailingScripts(raw);
      if (canvas) {
        child.value = canvas;
        raw = canvas;
      }
      const opensInlineIndicator = splitIndicatorTag && children.slice(index + 1).some((candidate) => (
        isRecord(candidate) && candidate.type === "raw" && typeof candidate.value === "string" && isClosingRawHtmlTag(candidate.value, splitIndicatorTag)
      )) ? splitIndicatorTag : undefined;
      const closesInlineIndicator = inlineIndicatorOpen !== null && isClosingRawHtmlTag(raw, inlineIndicatorOpen);
      const splitAudioOrVideoTag = (["audio", "video"] as const).find((tagName) => isOpeningRawHtmlTag(raw, tagName));
      const opensInlineAudioOrVideo = splitAudioOrVideoTag && closingRawHtmlTagIndex(children, index, splitAudioOrVideoTag) >= 0
        ? splitAudioOrVideoTag
        : undefined;
      const closesInlineAudioOrVideo = inlineAudioOrVideoOpen !== null && isClosingRawHtmlTag(raw, inlineAudioOrVideoOpen);
      const opensInlineFigure = isOpeningFigureHtmlTag(raw) && children.slice(index + 1).some((candidate) => (
        isRecord(candidate) && candidate.type === "raw" && typeof candidate.value === "string" && isClosingFigureHtmlTag(candidate.value)
      ));
      const closesInlineFigure = inlineFigureOpen && isClosingFigureHtmlTag(raw);
      const opensInlineSvg = isOpeningSvgHtmlTag(raw) && children.slice(index + 1).some((candidate) => (
        isRecord(candidate) && candidate.type === "raw" && typeof candidate.value === "string" && isClosingSvgHtmlTag(candidate.value)
      ));
      const closesInlineSvg = inlineSvgOpen && isClosingSvgHtmlTag(raw);
      const opensInlinePicture = isOpeningPictureHtmlTag(raw) && children.slice(index + 1).some((candidate) => (
        isRecord(candidate) && candidate.type === "raw" && typeof candidate.value === "string" && isClosingPictureHtmlTag(candidate.value)
      ));
      const closesInlinePicture = inlinePictureOpen && isClosingPictureHtmlTag(raw);
      const opensInlineKbd = isOpeningRawHtmlTag(raw, "kbd") && closingRawHtmlTagIndex(children, index, "kbd") >= 0;
      const closesInlineKbd = inlineKbdOpen && isClosingRawHtmlTag(raw, "kbd");
      const supported = isMediaHtmlBlock(raw, "audio") ||
        isMediaHtmlBlock(raw, "video") ||
        isImageHtmlTag(raw) ||
        isActiveContentHtmlBlock(raw, "object") ||
        isActiveContentHtmlBlock(raw, "canvas") ||
        isNativeIndicatorHtmlBlock(raw, "meter") ||
        isNativeIndicatorHtmlBlock(raw, "progress") ||
        isFigureHtmlBlock(raw) ||
        isPictureHtmlBlock(raw) ||
        isSvgHtmlBlock(raw) ||
        Boolean(opensInlineIndicator) ||
        inlineIndicatorOpen !== null ||
        Boolean(opensInlineAudioOrVideo) ||
        inlineAudioOrVideoOpen !== null ||
        opensInlineFigure ||
        inlineFigureOpen ||
        opensInlinePicture ||
        inlinePictureOpen ||
        opensInlineSvg ||
        inlineSvgOpen ||
        opensInlineKbd ||
        closesInlineKbd;
      if (!supported) {
        child.type = "text";
      } else if (opensInlineIndicator) {
        inlineIndicatorOpen = opensInlineIndicator;
      } else if (closesInlineIndicator) {
        inlineIndicatorOpen = null;
      } else if (opensInlineAudioOrVideo) {
        inlineAudioOrVideoOpen = opensInlineAudioOrVideo;
      } else if (closesInlineAudioOrVideo) {
        inlineAudioOrVideoOpen = null;
      } else if (opensInlineFigure) {
        inlineFigureOpen = true;
      } else if (closesInlineFigure) {
        inlineFigureOpen = false;
      } else if (opensInlineSvg) {
        inlineSvgOpen = true;
      } else if (closesInlineSvg) {
        inlineSvgOpen = false;
      } else if (opensInlinePicture) {
        inlinePictureOpen = true;
      } else if (closesInlinePicture) {
        inlinePictureOpen = false;
      } else if (opensInlineKbd) {
        inlineKbdOpen = true;
      } else if (closesInlineKbd) {
        inlineKbdOpen = false;
      }
      continue;
    }
    retainSupportedHtmlInAst(child);
  }
}

function rehypeSupportedHtml() {
  return (tree: unknown) => retainSupportedHtmlInAst(tree);
}

const ACTIVE_CONTENT_FALLBACK_SKIP_TAGS = new Set(["canvas", "iframe", "object", "script", "style"]);

function activeContentFallbackText(node: unknown): string {
  if (!isRecord(node)) return "";
  if (node.type === "text") return typeof node.value === "string" ? node.value : "";
  if (node.type === "element" && typeof node.tagName === "string" && ACTIVE_CONTENT_FALLBACK_SKIP_TAGS.has(node.tagName.toLowerCase())) return "";
  if (!Array.isArray(node.children)) return "";
  return node.children
    .map(activeContentFallbackText)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function replaceBlockedActiveContent(node: unknown): void {
  if (!isRecord(node) || !Array.isArray(node.children)) return;
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (!isRecord(child)) continue;
    const tagName = child.type === "element" && typeof child.tagName === "string" ? child.tagName.toLowerCase() : "";
    if (tagName === "object" || tagName === "canvas") {
      const fallback = Array.isArray(child.children)
        ? child.children.map(activeContentFallbackText).join(" ").replace(/\s+/g, " ").trim().slice(0, 500)
        : "";
      node.children[index] = {
        ...securityNoticeAstNode(tagName, fallback),
      };
      continue;
    }
    replaceBlockedActiveContent(child);
  }
}

function rehypeReplaceBlockedActiveContent() {
  return (tree: unknown) => replaceBlockedActiveContent(tree);
}

function restrictEmbeddedMediaSubtrees(
  node: unknown,
  insideSvg = false,
  insidePicture = false,
  insideAudioOrVideo = false,
  figureSection: "media" | "caption" | null = null,
  insideIndicator = false,
): void {
  if (!isRecord(node) || !Array.isArray(node.children)) return;
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (!isRecord(child)) continue;
    const childTagName = child.type === "element" && typeof child.tagName === "string" ? child.tagName.toLowerCase() : null;
    if (insideSvg && child.type === "element" && (
      !childTagName || !SAFE_SVG_TAG_NAMES.has(childTagName)
    )) {
      node.children.splice(index, 1);
      index -= 1;
      continue;
    }
    if (insidePicture && child.type === "element" && (
      !childTagName || !SAFE_PICTURE_TAG_NAMES.has(childTagName)
    )) {
      node.children.splice(index, 1);
      index -= 1;
      continue;
    }
    if (insideAudioOrVideo && child.type === "element" && childTagName !== "source") {
      node.children.splice(index, 1);
      index -= 1;
      continue;
    }
    if (insideIndicator && child.type === "element" && (
      !childTagName || !SAFE_INDICATOR_FALLBACK_TAG_NAMES.has(childTagName)
    )) {
      node.children.splice(index, 1);
      index -= 1;
      continue;
    }
    if (figureSection === "media" && (
      (child.type === "element" && (!childTagName || !SAFE_FIGURE_TAG_NAMES.has(childTagName))) ||
      (child.type === "text" && typeof child.value === "string" && child.value.trim())
    )) {
      node.children.splice(index, 1);
      index -= 1;
      continue;
    }
    if (figureSection === "caption" && child.type === "element" && (
      !childTagName || !SAFE_FIGCAPTION_TAG_NAMES.has(childTagName)
    )) {
      node.children.splice(index, 1);
      index -= 1;
      continue;
    }
    const childInsideSvg = insideSvg || childTagName === "svg";
    const childInsidePicture = insidePicture || childTagName === "picture";
    const childInsideAudioOrVideo = insideAudioOrVideo || childTagName === "audio" || childTagName === "video";
    const childInsideIndicator = insideIndicator || childTagName === "meter" || childTagName === "progress";
    const childFigureSection = childTagName === "figure"
      ? "media"
      : figureSection === "media"
        ? childTagName === "figcaption" ? "caption" : null
        : figureSection;
    restrictEmbeddedMediaSubtrees(child, childInsideSvg, childInsidePicture, childInsideAudioOrVideo, childFigureSection, childInsideIndicator);
  }
}

function rehypeRestrictSvg() {
  return (tree: unknown) => restrictEmbeddedMediaSubtrees(tree);
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
  const trimmed = line.trim();
  return trimmed.length >= fence.length && [...trimmed].every((character) => character === fence[0]);
}

function encodeCodeFenceMetadata(content: string): string {
  const lines = content.split("\n");
  const nextLines: string[] = [];
  let activeFence = "";
  let escapeFirstCodeLine = false;

  for (const line of lines) {
    if (activeFence) {
      if (isFenceClose(line, activeFence)) {
        activeFence = "";
        escapeFirstCodeLine = false;
        nextLines.push(line);
        continue;
      }
      nextLines.push(escapeFirstCodeLine && line.startsWith(CODE_META_MARKER) ? `${CODE_META_MARKER}${line}` : line);
      escapeFirstCodeLine = false;
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
    escapeFirstCodeLine = !meta;
    nextLines.push(`${prefix}${fence}${language}`);
    if (meta) nextLines.push(`${CODE_META_MARKER}${encodeURIComponent(meta)}`);
  }

  return nextLines.join("\n");
}

function decodeCodeTextAndMeta(children: ReactNode, fallbackMeta: string): { code: string; meta: string } {
  let code = String(children).replace(/\n$/, "");
  if (code.startsWith(`${CODE_META_MARKER}${CODE_META_MARKER}`)) {
    return { code: code.slice(CODE_META_MARKER.length), meta: fallbackMeta };
  }
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

function applyChatSoftBreaksToAst(node: unknown): void {
  if (!isRecord(node)) return;
  if (["code", "inlineCode", "html", "math", "inlineMath"].includes(String(node.type))) return;
  const children = Array.isArray(node.children) ? node.children : null;
  if (!children) return;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!isRecord(child)) continue;
    if (child.type === "text" && typeof child.value === "string" && child.value.includes("\n")) {
      const lines = child.value.split("\n");
      const nextNodes: Array<Record<string, unknown>> = [];
      lines.forEach((line, lineIndex) => {
        if (line) nextNodes.push({ type: "text", value: line });
        if (lineIndex < lines.length - 1) nextNodes.push({ type: "break" });
      });
      children.splice(index, 1, ...nextNodes);
      index += nextNodes.length - 1;
      continue;
    }
    applyChatSoftBreaksToAst(child);
  }
}

function nodeSourceText(node: Record<string, unknown>, source: string): string | null {
  const position = isRecord(node.position) ? node.position : null;
  const start = isRecord(position?.start) && typeof position.start.offset === "number" ? position.start.offset : null;
  const end = isRecord(position?.end) && typeof position.end.offset === "number" ? position.end.offset : null;
  return start != null && end != null ? source.slice(start, end) : null;
}

function isClosedStandaloneBlockMath(source: string): boolean {
  const lines = source.split("\n");
  return lines.length >= 3 &&
    /^[ \t]{0,3}\$\$[ \t]*$/.test(lines[0] ?? "") &&
    /^[ \t]{0,3}\$\$[ \t]*$/.test(lines.at(-1) ?? "");
}

function applyBlockOnlyMathToAst(node: unknown, source: string): void {
  if (!isRecord(node) || !Array.isArray(node.children)) return;

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    if (!isRecord(child)) continue;
    if (child.type === "inlineMath" || child.type === "math") {
      const value = typeof child.value === "string" ? child.value : "";
      const literal = nodeSourceText(child, source) ?? (child.type === "math" ? `$$\n${value}\n$$` : `$$${value}$$`);
      if (child.type === "math" && isClosedStandaloneBlockMath(literal)) continue;
      const textNode = { type: "text", value: literal, position: child.position };
      node.children[index] = child.type === "math"
        ? { type: "paragraph", children: [textNode], position: child.position }
        : textNode;
      continue;
    }
    applyBlockOnlyMathToAst(child, source);
  }
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

function remarkBlockOnlyMath(source: string) {
  return () => (tree: unknown) => applyBlockOnlyMathToAst(tree, source);
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

function remarkChatSoftBreaks() {
  return (tree: unknown) => applyChatSoftBreaksToAst(tree);
}

function markdownRemarkPlugins(abbreviations: MarkdownAbbreviation[], linkWorkspaceFiles: boolean, source: string): NonNullable<Parameters<typeof Markdown>[0]["remarkPlugins"]> {
  return [
    [remarkGfm, { singleTilde: false }],
    [remarkMath, { singleDollarTextMath: false }],
    remarkBlockOnlyMath(source),
    remarkMarkdownAlerts,
    remarkOpenClawEmbeds(source),
    remarkCodeMeta,
    remarkAbbreviations(abbreviations),
    ...(linkWorkspaceFiles ? [remarkWorkspaceFileLinks] : []),
    remarkChatSoftBreaks,
  ];
}

function normalizeRenderableMarkdownImageSrc(src: string): string | null {
  const trimmed = src.trim();
  const normalized = trimmed.replace(/^\/+/, "");
  if (!trimmed || /^media:/i.test(trimmed)) return null;
  if (/^(?:home\/node\/\.openclaw\/workspace|\.?openclaw\/workspace|workspace|home)(?:\/|$)/i.test(normalized)) return null;
  if (/^data:image\//i.test(trimmed)) {
    const match = /^data:image\/(avif|bmp|gif|jpe?g|png|webp);base64,([\s\S]+)$/i.exec(trimmed);
    if (!match?.[1] || !match[2]) return null;
    const compactPayload = match[2].replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compactPayload)) return null;
    const unpaddedPayload = compactPayload.replace(/=+$/, "");
    if (!unpaddedPayload || unpaddedPayload.length % 4 === 1) return null;
    const paddedPayload = unpaddedPayload.padEnd(Math.ceil(unpaddedPayload.length / 4) * 4, "=");
    return `data:image/${match[1].toLowerCase()};base64,${paddedPayload}`;
  }
  if (/^blob:/i.test(trimmed)) return trimmed;
  if (isImageFileReference(trimmed)) return trimmed;
  if (/^(?:https?:\/\/|\/)/i.test(trimmed)) return isKnownNonImageFileReference(trimmed) ? null : trimmed;
  return null;
}

function isRenderableMarkdownVideoSrc(src: string): boolean {
  const trimmed = src.trim();
  const normalized = trimmed.replace(/^\/+/, "");
  if (!trimmed || /^(?:media:|javascript:|file:)/i.test(trimmed)) return false;
  if (/^(?:home\/node\/\.openclaw\/workspace|\.?openclaw\/workspace|workspace|home)(?:\/|$)/i.test(normalized)) return false;
  if (/^(?:data:video\/|blob:|https?:\/\/|\/)/i.test(trimmed)) return true;
  return /\.(?:mp4|m4v|mov|webm|ogv|ogg)(?:[?#].*)?$/i.test(trimmed);
}

function isRenderableMarkdownAudioSrc(src: string): boolean {
  const trimmed = src.trim();
  const normalized = trimmed.replace(/^\/+/, "");
  if (!isSafeDirectMediaUrl(trimmed, "audio")) return false;
  if (/^(?:home\/node\/\.openclaw\/workspace|\.?openclaw\/workspace|workspace|home)(?:\/|$)/i.test(normalized)) return false;
  if (/^(?:data:audio\/|blob:|https?:\/\/|\/)/i.test(trimmed)) return true;
  return isAudioFileReference(trimmed);
}

function markdownUrlTransform(value: string, key: string): string {
  if (key === "src" && /^(?:data:(?:audio|image|video)\/|blob:)/i.test(value)) return value;
  return defaultUrlTransform(value);
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
    if (!trimmedChart || isStreaming) return;
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
  }, [chart, diagramIdPrefix, isStreaming, trimmedChart]);

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
  if (embed) return <MarkdownBlockedEmbed embed={embed} />;
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

function MarkdownImage({ src, alt, title, fetchPriority }: { src?: string; alt?: string; title?: string; fetchPriority?: string }) {
  const insideGallery = useContext(MarkdownImageGalleryContext);
  const insideLink = useContext(MarkdownLinkContext);
  const insidePicture = useContext(MarkdownPictureContext);
  const imageAlt = typeof alt === "string" ? alt : "image";
  const imageTitle = typeof title === "string" ? title : undefined;
  const imageFetchPriority = fetchPriority === "high" || fetchPriority === "low" || fetchPriority === "auto" ? fetchPriority : undefined;
  const imageSrc = typeof src === "string" ? normalizeRenderableMarkdownImageSrc(src) : null;
  if (!imageSrc) return insidePicture ? null : <MarkdownMediaUnavailable />;
  if (insidePicture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- picture source selection requires a direct img fallback.
      <img
        src={imageSrc}
        alt={imageAlt}
        title={imageTitle}
        width={320}
        height={320}
        loading="lazy"
        fetchPriority={imageFetchPriority}
        className={CHAT_MARKDOWN_IMAGE_CLASS}
      />
    );
  }
  if (insideLink) {
    const image = (
      <ResourceImage
        src={imageSrc}
        alt={imageAlt}
        width={320}
        height={320}
        sizes="(max-width: 640px) 100vw, 320px"
        className={CHAT_MARKDOWN_IMAGE_CLASS}
        loading="lazy"
        fetchPriority={imageFetchPriority}
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
      src={imageSrc}
      alt={imageAlt}
      title={imageTitle}
      width={320}
      height={320}
      sizes={insideGallery ? "(max-width: 640px) 50vw, 240px" : "(max-width: 640px) 100vw, 320px"}
      className={insideGallery ? "h-32 w-full max-w-full rounded-md object-cover sm:h-40" : CHAT_MARKDOWN_IMAGE_CLASS}
      containerClassName={insideGallery ? "h-full w-full min-w-0 overflow-hidden" : `${CHAT_MEDIA_LINK_CLASS} my-2`}
      loading="lazy"
      fetchPriority={imageFetchPriority}
      downloadHref={imageSrc}
      downloadFileName={mediaFileNameFromUrl(imageSrc, imageAlt)}
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

function safeMarkdownImageSrcSet(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return undefined;
  const safeEntries = entries.map((entry) => {
    const match = /^(\S+)(?:\s+(\d+w|\d+(?:\.\d+)?x))?$/.exec(entry);
    if (!match?.[1] || !normalizeRenderableMarkdownImageSrc(match[1]) || /^data:/i.test(match[1])) return null;
    return `${match[1]}${match[2] ? ` ${match[2]}` : ""}`;
  });
  return safeEntries.every((entry): entry is string => Boolean(entry)) ? safeEntries.join(", ") : undefined;
}

function MarkdownPictureSource({ srcSet, media, type }: { srcSet?: string; media?: string; type?: string }) {
  const safeSrcSet = safeMarkdownImageSrcSet(srcSet);
  if (!safeSrcSet) return null;
  const safeMedia = typeof media === "string" && media.length <= 200 && /^[A-Za-z0-9\s():.,/_-]+$/.test(media) ? media : undefined;
  const safeType = typeof type === "string" && /^image\/[A-Za-z0-9.+-]+$/i.test(type) ? type : undefined;
  return <source srcSet={safeSrcSet} media={safeMedia} type={safeType} />;
}

function MarkdownPicture({ children }: { children?: ReactNode }) {
  return (
    <MarkdownPictureContext.Provider value>
      <picture className="my-2 block max-w-full">{children}</picture>
    </MarkdownPictureContext.Provider>
  );
}

function markdownAudioSources(node: unknown): Array<{ src: string; type?: string }> {
  if (!isRecord(node) || !Array.isArray(node.children)) return [];
  return node.children.flatMap((child) => {
    if (!isRecord(child) || child.type !== "element" || child.tagName !== "source" || !isRecord(child.properties)) return [];
    const src = typeof child.properties.src === "string" ? child.properties.src : "";
    if (!isRenderableMarkdownAudioSrc(src)) return [];
    const type = typeof child.properties.type === "string" && /^audio\/[A-Za-z0-9.+-]+$/i.test(child.properties.type)
      ? child.properties.type
      : undefined;
    return [{ src, ...(type ? { type } : {}) }];
  });
}

function MarkdownAudio({ src, title, node }: { src?: string; title?: string; node?: unknown }) {
  const audioSrc = typeof src === "string" && isRenderableMarkdownAudioSrc(src) ? src : undefined;
  const sources = markdownAudioSources(node);
  const primarySource = audioSrc ?? sources[0]?.src;
  const label = title || (primarySource ? mediaFileNameFromUrl(primarySource, "Audio") : "Audio");
  return (
    <AudioPlayer
      src={audioSrc}
      sources={sources}
      title={label}
      downloadHref={primarySource}
      downloadFileName={primarySource ? mediaFileNameFromUrl(primarySource, "audio") : undefined}
      className="my-2"
    />
  );
}

function markdownIndicatorNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function MarkdownProgress({ value, max, children }: { value?: unknown; max?: unknown; children?: ReactNode }) {
  const parsedMax = markdownIndicatorNumber(max);
  const safeMax = parsedMax !== undefined && parsedMax > 0 ? parsedMax : 1;
  const parsedValue = markdownIndicatorNumber(value);
  const safeValue = parsedValue === undefined ? undefined : Math.min(safeMax, Math.max(0, parsedValue));
  const percentage = safeValue === undefined ? null : Math.round((safeValue / safeMax) * 100);
  return (
    <progress
      value={safeValue}
      max={safeMax}
      aria-label={percentage === null ? "Progress" : `${percentage}% complete`}
      className="my-2 block h-3 w-full max-w-sm overflow-hidden rounded-full accent-[var(--selection-accent)]"
    >
      {children}
    </progress>
  );
}

function MarkdownMeter({ value, min, max, low, high, optimum, children }: {
  value?: unknown;
  min?: unknown;
  max?: unknown;
  low?: unknown;
  high?: unknown;
  optimum?: unknown;
  children?: ReactNode;
}) {
  const safeMin = markdownIndicatorNumber(min) ?? 0;
  const parsedMax = markdownIndicatorNumber(max);
  const safeMax = parsedMax !== undefined && parsedMax > safeMin ? parsedMax : safeMin + 1;
  const parsedValue = markdownIndicatorNumber(value) ?? safeMin;
  const safeValue = Math.min(safeMax, Math.max(safeMin, parsedValue));
  const boundedOptionalValue = (candidate: unknown) => {
    const parsed = markdownIndicatorNumber(candidate);
    return parsed !== undefined && parsed >= safeMin && parsed <= safeMax ? parsed : undefined;
  };
  const percentage = Math.round(((safeValue - safeMin) / (safeMax - safeMin)) * 100);
  return (
    <meter
      value={safeValue}
      min={safeMin}
      max={safeMax}
      low={boundedOptionalValue(low)}
      high={boundedOptionalValue(high)}
      optimum={boundedOptionalValue(optimum)}
      aria-label={`${percentage}%`}
      className="my-2 block h-3 w-full max-w-sm accent-[var(--selection-accent)]"
    >
      {children}
    </meter>
  );
}

const MARKDOWN_SECURITY_NOTICES: Record<MarkdownSecurityNoticeType, { label: string; description: string }> = {
  iframe: {
    label: "Embedded frame blocked",
    description: "Iframes can load untrusted pages and run active content, so they are not displayed in chat.",
  },
  object: {
    label: "Embedded object blocked",
    description: "Object embeds can load untrusted external content or legacy plugins, so they are not displayed in chat.",
  },
  canvas: {
    label: "Interactive canvas blocked",
    description: "Script-driven canvases require executable content, which is not run in chat.",
  },
  embed: {
    label: "Legacy embed blocked",
    description: "Embed tags can load untrusted external content or legacy plugins, so they are not displayed in chat.",
  },
};

function MarkdownSecurityNotice({ type, title, fallback }: { type: MarkdownSecurityNoticeType; title?: string; fallback?: string }) {
  const notice = MARKDOWN_SECURITY_NOTICES[type];
  return (
    <aside
      role="note"
      aria-label={notice.label}
      className={`${MARKDOWN_WRAP_CLASS} my-3 rounded-r-lg border-l-[3px] border-warning/60 bg-warning/8 px-3 py-2.5`}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warning">
        <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span>{notice.label}</span>
      </div>
      <p className="text-sm text-text-secondary">
        {title ? `${title} was not displayed. ` : ""}
        {notice.description}
      </p>
      {fallback && (
        <p className="mt-2 border-t border-warning/20 pt-2 text-xs text-text-muted">
          <span className="font-medium text-text-secondary">Fallback:</span> {fallback}
        </p>
      )}
    </aside>
  );
}

function MarkdownBlockedEmbed({ embed }: { embed: OpenClawEmbed }) {
  return <MarkdownSecurityNotice type="iframe" title={embed.title} />;
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

function markdownSecurityNoticeFromNode(node: unknown): { type: MarkdownSecurityNoticeType; fallback?: string } | null {
  if (!isRecord(node) || !isRecord(node.properties)) return null;
  const type = node.properties.dataSecurityNotice;
  if (type !== "iframe" && type !== "object" && type !== "canvas" && type !== "embed") return null;
  const fallback = typeof node.properties.dataSecurityFallback === "string" ? node.properties.dataSecurityFallback : undefined;
  return { type, ...(fallback ? { fallback } : {}) };
}

function isMarkdownImageGalleryNode(node: unknown): boolean {
  return isRecord(node) && isRecord(node.properties) && node.properties.dataMediaGallery === "true";
}

function MarkdownImageGallery({ children }: { children?: ReactNode }) {
  return (
    <MarkdownImageGalleryContext.Provider value>
      <figure aria-label="Image gallery" className={`${MARKDOWN_WRAP_CLASS} my-3 grid w-full max-w-[48rem] grid-cols-2 gap-2 sm:grid-cols-3`}>
        {children}
      </figure>
    </MarkdownImageGalleryContext.Provider>
  );
}

function markdownParagraphContainsBlockMedia(node: unknown): boolean {
  return isRecord(node) && Array.isArray(node.children) && node.children.some((child) => (
    isRecord(child) && child.type === "element" && typeof child.tagName === "string" && ["audio", "blockquote", "figure", "video"].includes(child.tagName)
  ));
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
  p: ({ children, node }) => markdownParagraphContainsBlockMedia(node)
    ? <div className={MARKDOWN_BLOCK_CLASS}>{children}</div>
    : <p className={MARKDOWN_BLOCK_CLASS}>{children}</p>,
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
    const securityNotice = markdownSecurityNoticeFromNode(node);
    if (securityNotice) return <MarkdownSecurityNotice {...securityNotice} />;
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
  img: ({ src, alt, title, fetchPriority }) => (
    <MarkdownImage
      src={typeof src === "string" ? src : undefined}
      alt={typeof alt === "string" ? alt : undefined}
      title={typeof title === "string" ? title : undefined}
      fetchPriority={typeof fetchPriority === "string" ? fetchPriority : undefined}
    />
  ),
  svg: ({ children, node, className, ...props }) => {
    void node;
    return (
      <svg
        {...props}
        role="img"
        aria-label={props["aria-label"] ?? "Inline SVG"}
        className={`${className ?? ""} my-2 h-auto max-h-[320px] max-w-full`}
      >
        {children}
      </svg>
    );
  },
  picture: ({ children }) => <MarkdownPicture>{children}</MarkdownPicture>,
  progress: ({ value, max, children }) => <MarkdownProgress value={value} max={max}>{children}</MarkdownProgress>,
  meter: ({ value, min, max, low, high, optimum, children }) => (
    <MarkdownMeter value={value} min={min} max={max} low={low} high={high} optimum={optimum}>{children}</MarkdownMeter>
  ),
  figure: ({ children, node }) => isMarkdownImageGalleryNode(node)
    ? <MarkdownImageGallery>{children}</MarkdownImageGallery>
    : <figure className={`${MARKDOWN_WRAP_CLASS} my-3 w-fit max-w-full`}>{children}</figure>,
  figcaption: ({ children }) => <figcaption className="mt-1.5 max-w-prose text-xs italic text-text-secondary">{children}</figcaption>,
  audio: ({ src, title, node }) => (
    <MarkdownAudio
      src={typeof src === "string" ? src : undefined}
      title={typeof title === "string" ? title : undefined}
      node={node}
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
  source: ({ src, srcSet, media, type }) => typeof srcSet === "string"
    ? (
      <MarkdownPictureSource
        srcSet={srcSet}
        media={typeof media === "string" ? media : undefined}
        type={typeof type === "string" ? type : undefined}
      />
    )
    : (
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
      urlTransform={markdownUrlTransform}
    >
      {prepared.content}
    </Markdown>
  );
}

export function MarkdownContent({ content, typewriter = false, isStreaming = false, className, style, onOpenWorkspaceFile }: MarkdownContentProps) {
  const displayedContent = useTypewriter(content, typewriter);
  const linkWorkspaceFiles = Boolean(onOpenWorkspaceFile);
  const renderedContent = useMemo(() => renderMarkdown(displayedContent, linkWorkspaceFiles), [displayedContent, linkWorkspaceFiles]);

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
