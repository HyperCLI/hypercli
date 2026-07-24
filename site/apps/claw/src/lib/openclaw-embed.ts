const EMBED_HREF_PREFIX = "#openclaw-embed/";
const DEFAULT_EMBED_HEIGHT = 240;
const MIN_EMBED_HEIGHT = 120;
const MAX_EMBED_HEIGHT = 640;
const MAX_EMBED_DOCUMENT_LENGTH = 64_000;

export interface OpenClawEmbed {
  title: string;
  height: number;
  html: string;
}

function parseDirectiveAttributes(value: string): Record<string, string> | null {
  const attributes: Record<string, string> = {};
  let cursor = 0;

  while (cursor < value.length) {
    while (/\s/.test(value[cursor] ?? "")) cursor += 1;
    if (cursor >= value.length) break;

    const nameMatch = /^[A-Za-z][A-Za-z0-9-]*/.exec(value.slice(cursor));
    if (!nameMatch) return null;
    const name = nameMatch[0].toLowerCase();
    cursor += nameMatch[0].length;
    while (/\s/.test(value[cursor] ?? "")) cursor += 1;
    if (value[cursor] !== "=") return null;
    cursor += 1;
    while (/\s/.test(value[cursor] ?? "")) cursor += 1;

    const quote = value[cursor];
    if (quote !== '"' && quote !== "'") return null;
    cursor += 1;
    let attributeValue = "";
    let closed = false;
    while (cursor < value.length) {
      const character = value[cursor] ?? "";
      if (character === quote) {
        cursor += 1;
        closed = true;
        break;
      }
      if (character === "\\" && (value[cursor + 1] === quote || value[cursor + 1] === "\\")) {
        attributeValue += value[cursor + 1];
        cursor += 2;
        continue;
      }
      attributeValue += character;
      cursor += 1;
    }

    if (!closed || name in attributes) return null;
    attributes[name] = attributeValue;
  }

  return attributes;
}

function decodeBase64Utf8(value: string): string | null {
  if (typeof globalThis.atob !== "function") return null;
  try {
    const binary = globalThis.atob(value.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function htmlFromDataUrl(url: string): string | null {
  if (url.length > MAX_EMBED_DOCUMENT_LENGTH * 2) return null;
  const match = /^data:text\/html((?:;[^,]*)?),(.*)$/is.exec(url.trim());
  if (!match) return null;

  const parameters = (match[1] ?? "").split(";").filter(Boolean);
  let base64 = false;
  for (const parameter of parameters) {
    if (/^base64$/i.test(parameter)) {
      base64 = true;
      continue;
    }
    if (/^charset=(?:utf-8|us-ascii)$/i.test(parameter)) continue;
    return null;
  }

  const payload = match[2] ?? "";
  let html: string | null;
  if (base64) {
    html = decodeBase64Utf8(payload);
  } else {
    try {
      html = decodeURIComponent(payload);
    } catch {
      html = payload;
    }
  }

  if (!html?.trim() || html.length > MAX_EMBED_DOCUMENT_LENGTH || html.includes("\0")) return null;
  return html;
}

function normalizedEmbed(value: unknown): OpenClawEmbed | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.title !== "string" || !candidate.title.trim() || candidate.title.length > 120) return null;
  if (typeof candidate.height !== "number" || !Number.isInteger(candidate.height)) return null;
  if (candidate.height < MIN_EMBED_HEIGHT || candidate.height > MAX_EMBED_HEIGHT) return null;
  if (typeof candidate.html !== "string" || !candidate.html.trim() || candidate.html.length > MAX_EMBED_DOCUMENT_LENGTH) return null;
  return { title: candidate.title, height: candidate.height, html: candidate.html };
}

export function isCompleteOpenClawEmbedDirective(value: string): boolean {
  return /^\s*\[embed\b[\s\S]*\/\]\s*$/i.test(value);
}

export function parseOpenClawEmbedDirective(value: string): OpenClawEmbed | null {
  const match = /^\s*\[embed\s+([\s\S]*?)\s*\/\]\s*$/i.exec(value);
  if (!match) return null;
  const attributes = parseDirectiveAttributes(match[1] ?? "");
  if (!attributes || Object.keys(attributes).some((name) => !["url", "title", "height"].includes(name))) return null;

  const html = attributes.url ? htmlFromDataUrl(attributes.url) : null;
  if (!html) return null;
  const title = attributes.title?.trim() || "Embedded content";
  if (title.length > 120) return null;
  const requestedHeight = attributes.height == null ? DEFAULT_EMBED_HEIGHT : Number(attributes.height);
  if (attributes.height != null && !/^\d+$/.test(attributes.height)) return null;
  const height = Math.max(MIN_EMBED_HEIGHT, Math.min(MAX_EMBED_HEIGHT, requestedHeight));
  return { title, height, html };
}

export function openClawEmbedHref(embed: OpenClawEmbed): string {
  return `${EMBED_HREF_PREFIX}${encodeURIComponent(JSON.stringify(embed))}`;
}

export function openClawEmbedFromHref(href: string | undefined): OpenClawEmbed | null {
  if (!href?.startsWith(EMBED_HREF_PREFIX)) return null;
  try {
    return normalizedEmbed(JSON.parse(decodeURIComponent(href.slice(EMBED_HREF_PREFIX.length))));
  } catch {
    return null;
  }
}

export function sandboxedOpenClawEmbedDocument(html: string): string {
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; form-action 'none'; base-uri 'none'";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${meta}`);
  if (/<html(?:\s[^>]*)?>/i.test(html)) return html.replace(/<html(?:\s[^>]*)?>/i, (root) => `${root}<head>${meta}</head>`);
  return `${meta}${html}`;
}
