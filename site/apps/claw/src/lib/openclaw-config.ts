import {
  resolveOpenClawConfigUiHint,
  type OpenClawConfigSchemaResponse,
  type OpenClawConfigUiHint,
} from "@hypercli.com/sdk/openclaw/gateway";
import type { JsonObject } from "@/app/dashboard/agents/types";

export const OPENCLAW_SYNC_ROOT = "/home/node";
export const OPENCLAW_WORKSPACE_PREFIX = ".openclaw/workspace";
export const OPENCLAW_WORKSPACE_DIR = `${OPENCLAW_SYNC_ROOT}/${OPENCLAW_WORKSPACE_PREFIX}`;

export function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

export function deepCloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (ch) => ch.toUpperCase());
}

export function getPathValue(root: JsonObject, path: string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    const obj = asObject(cursor);
    if (!obj) return undefined;
    cursor = obj[key];
  }
  return cursor;
}

export function setPathValue(root: JsonObject, path: string[], value: unknown): JsonObject {
  if (path.length === 0) return root;
  const next = deepCloneJsonObject(root);
  let cursor: JsonObject = next;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    const child = asObject(cursor[key]);
    if (!child) cursor[key] = {};
    cursor = asObject(cursor[key]) as JsonObject;
  }
  cursor[path[path.length - 1]] = value;
  return next;
}

export function getOpenClawUiHint(
  schemaBundle: OpenClawConfigSchemaResponse | null,
  path: string[],
): OpenClawConfigUiHint | null {
  return resolveOpenClawConfigUiHint(schemaBundle, path.join("."))?.hint ?? null;
}

export function sortOpenClawEntries(
  entries: Array<[string, unknown]>,
  schemaBundle: OpenClawConfigSchemaResponse | null,
  basePath: string[] = [],
): Array<[string, unknown]> {
  return [...entries].sort(([leftKey], [rightKey]) => {
    const leftHint = getOpenClawUiHint(schemaBundle, [...basePath, leftKey]);
    const rightHint = getOpenClawUiHint(schemaBundle, [...basePath, rightKey]);
    const leftOrder = typeof leftHint?.order === "number" ? leftHint.order : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof rightHint?.order === "number" ? rightHint.order : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftLabel = leftHint?.label?.trim() || humanizeKey(leftKey);
    const rightLabel = rightHint?.label?.trim() || humanizeKey(rightKey);
    return leftLabel.localeCompare(rightLabel);
  });
}

/** Extract the workspace voice file path from a chat message body. */
export function extractVoicePathFromMessage(content: string): string | null {
  const absoluteMatch = content.match(/\/home\/node\/\.openclaw\/workspace\/voice-[\w.-]+\.webm\b/i);
  if (absoluteMatch?.[0]) return absoluteMatch[0];
  const fileMatch = content.match(/\bvoice-[\w.-]+\.webm\b/i);
  if (!fileMatch?.[0]) return null;
  return `${OPENCLAW_WORKSPACE_DIR}/${fileMatch[0]}`;
}
