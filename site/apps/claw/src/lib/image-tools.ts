/**
 * Helpers for detecting image file paths in tool call arguments
 * and constructing preview URLs for inline rendering in chat.
 */

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;

const FILE_READ_TOOLS = /^(Read|read_file|ReadFile|read|file_read|View)$/i;
const FILE_WRITE_TOOLS = /^(Write|write_file|WriteFile|save_file|SaveFile|create_file|CreateFile)$/i;

/** Strip the persisted agent root so the path is workspace-relative for the file API. */
function toApiPath(path: string): string {
  return path.replace(/^\/app\//, "");
}

export function encodePath(path: string): string {
  return toApiPath(path).split("/").filter(Boolean).map((p) => encodeURIComponent(p)).join("/");
}

export function extractFilePathFromArgs(args: string): string | null {
  try {
    const parsed = JSON.parse(args);
    return parsed.file_path || parsed.path || parsed.filename || null;
  } catch {
    const match = args.match(/"(?:file_path|path|filename)"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  }
}

export function extractImagePath(tc: { name: string; args: string; result?: string }): string | null {
  const filePath = extractFilePathFromArgs(tc.args);
  if (!filePath || !IMAGE_EXTENSIONS.test(filePath)) return null;

  // If result text mentions image, it's definitely an image operation
  if (tc.result && /image/i.test(tc.result)) return filePath;

  // If the tool name looks like a file read/write and the path is an image, show it
  if (FILE_READ_TOOLS.test(tc.name) || FILE_WRITE_TOOLS.test(tc.name)) return filePath;

  return null;
}
