/**
 * Parser for the workspaces `/tomd` Markdown document shape: a YAML
 * frontmatter block between `---` fences carrying typed file metadata, then
 * a Markdown body. The frontmatter writer is the tomd pipeline's own emitter
 * (agents/workspaces `_frontmatter_scalar`): scalars are double-quoted
 * strings, booleans, numbers, or `null`; lists/objects are inline JSON. This
 * parser is dependency-free and scoped to that emitted shape (plus block
 * `- item` lists for robustness) so the SDK stays yaml-free.
 */

export interface WorkspaceTomdFrontmatter {
  fileId?: string;
  path?: string;
  version?: number;
  index?: number;
  partCount?: number;
  state?: string;
  keywords?: string[];
  summary?: string;
  sizeBytes?: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  createdAt?: string;
  updatedAt?: string;
  downloadCommand?: string;
  detectedType?: string;
  docType?: string;
  enriched?: boolean;
  language?: string;
  longSummary?: string;
  pageCount?: number;
  title?: string;
  /** Keys not mapped above, kept verbatim (snake_case) so new backend keys never break parsing. */
  extra: Record<string, unknown>;
}

export interface WorkspaceTomdDocument {
  frontmatter: WorkspaceTomdFrontmatter;
  /** The Markdown body after the closing frontmatter fence. */
  body: string;
  /**
   * The body minus the sections the tomd pipeline generates from the same
   * frontmatter (`## Keywords`, `## Summary`, `## Long Summary`,
   * `## Section Summaries`) — they duplicate a metadata header, so rich
   * previews render this instead. Everything else, including `## Full Text`,
   * is kept.
   */
  contentBody: string;
}

const KNOWN_KEYS: Record<string, keyof WorkspaceTomdFrontmatter> = {
  file_id: 'fileId',
  path: 'path',
  version: 'version',
  index: 'index',
  part_count: 'partCount',
  state: 'state',
  keywords: 'keywords',
  summary: 'summary',
  size_bytes: 'sizeBytes',
  content_type: 'contentType',
  etag: 'etag',
  last_modified: 'lastModified',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  download_command: 'downloadCommand',
  detected_type: 'detectedType',
  doc_type: 'docType',
  enriched: 'enriched',
  language: 'language',
  long_summary: 'longSummary',
  page_count: 'pageCount',
  title: 'title',
};

const GENERATED_SECTION_TITLES = new Set(['keywords', 'summary', 'long summary', 'section summaries']);

/**
 * Split a `/tomd` Markdown document into typed frontmatter and body.
 * Missing or unterminated frontmatter is not an error: the whole input is
 * treated as the body with an empty frontmatter.
 */
export function parseWorkspaceTomd(markdown: string): WorkspaceTomdDocument {
  const { data, body } = splitFrontmatter(typeof markdown === 'string' ? markdown : '');
  return {
    frontmatter: toFrontmatter(data),
    body,
    contentBody: stripWorkspaceTomdGeneratedSections(body),
  };
}

/**
 * Remove the tomd-generated `## Keywords` / `## Summary` / `## Long Summary`
 * / `## Section Summaries` sections (each runs until the next level-1/2
 * heading). Headings inside fenced code blocks are left alone.
 */
export function stripWorkspaceTomdGeneratedSections(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];
  let skipping = false;
  let fence: string | null = null;
  for (const line of lines) {
    const fenceMatch = /^(```+|~~~+)/.exec(line.trim());
    if (fenceMatch) {
      fence = fence === null ? fenceMatch[1][0].repeat(3) : fence === fenceMatch[1][0].repeat(3) ? null : fence;
    }
    if (fence === null) {
      const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading && heading[1].length <= 2) {
        skipping = GENERATED_SECTION_TITLES.has(heading[2].toLowerCase());
      }
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function splitFrontmatter(markdown: string): { data: Record<string, unknown>; body: string } {
  const empty = { data: {}, body: markdown };
  const firstBreak = markdown.indexOf('\n');
  const firstLine = (firstBreak === -1 ? markdown : markdown.slice(0, firstBreak)).replace(/\r$/, '');
  if (firstLine.trim() !== '---') return empty;
  let pos = firstBreak + 1;
  while (pos < markdown.length) {
    const nextBreak = markdown.indexOf('\n', pos);
    const line = (nextBreak === -1 ? markdown.slice(pos) : markdown.slice(pos, nextBreak)).replace(/\r$/, '');
    if (line.trim() === '---') {
      const raw = markdown.slice(firstBreak + 1, pos);
      const rest = nextBreak === -1 ? '' : markdown.slice(nextBreak + 1);
      return { data: parseFrontmatterBlock(raw), body: rest.replace(/^(\r?\n)+/, '') };
    }
    if (nextBreak === -1) break;
    pos = nextBreak + 1;
  }
  // Unterminated fence: treat the whole document as body.
  return empty;
}

function parseFrontmatterBlock(raw: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && listKey) {
      const items = Array.isArray(data[listKey]) ? (data[listKey] as unknown[]) : [];
      items.push(parseFrontmatterScalar(listItem[1].trim()));
      data[listKey] = items;
      continue;
    }
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    const value = line.slice(separator + 1).trim();
    if (!value) {
      data[key] = [];
      listKey = key;
      continue;
    }
    listKey = null;
    data[key] = parseFrontmatterScalar(value);
  }
  return data;
}

function parseFrontmatterScalar(value: string): unknown {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1);
  }
  if (value.startsWith('[') || value.startsWith('{')) {
    try {
      return JSON.parse(value);
    } catch {
      if (value.startsWith('[') && value.endsWith(']')) {
        return value
          .slice(1, -1)
          .split(',')
          .map((item) => item.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      }
      return value;
    }
  }
  const lowered = value.toLowerCase();
  if (lowered === 'true') return true;
  if (lowered === 'false') return false;
  if (lowered === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function toFrontmatter(data: Record<string, unknown>): WorkspaceTomdFrontmatter {
  const frontmatter: WorkspaceTomdFrontmatter = { extra: {} };
  for (const [key, value] of Object.entries(data)) {
    const mapped = KNOWN_KEYS[key];
    if (mapped) {
      (frontmatter as unknown as Record<string, unknown>)[mapped] = value;
    } else {
      frontmatter.extra[key] = value;
    }
  }
  return frontmatter;
}
