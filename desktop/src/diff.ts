export interface DiffLine {
  type: "add" | "del" | "context";
  text: string;
}

export interface DiffPayload {
  path?: string;
  /** null when the file did not exist before (write/create). */
  oldText: string | null;
  newText: string;
}

const MAX_MIDDLE_LINES = 2000;

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length === 0 && b.length === 0) return [];

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const head: DiffLine[] = a.slice(0, start).map((text) => ({ type: "context", text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ type: "context", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let middle: DiffLine[];
  if (midA.length + midB.length > MAX_MIDDLE_LINES) {
    middle = [
      ...midA.map((text): DiffLine => ({ type: "del", text })),
      ...midB.map((text): DiffLine => ({ type: "add", text })),
    ];
  } else {
    middle = myersDiffLines(midA, midB);
  }
  return [...head, ...middle, ...tail];
}

function myersDiffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((text) => ({ type: "add", text }));
  if (m === 0) return a.map((text) => ({ type: "del", text }));

  const max = n + m;
  const trace: Map<number, number>[] = [];
  let v = new Map<number, number>([[1, 0]]);
  let foundD = -1;
  outer: for (let d = 0; d <= max; d += 1) {
    const next = new Map<number, number>();
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1));
      let x = down ? (v.get(k + 1) ?? 0) : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      next.set(k, x);
      if (x >= n && y >= m) {
        trace.push(next);
        foundD = d;
        break outer;
      }
    }
    trace.push(next);
    v = next;
  }

  const lines: DiffLine[] = [];
  let x = n;
  let y = m;
  for (let d = foundD; d > 0; d -= 1) {
    const vPrev = trace[d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && (vPrev.get(k - 1) ?? -1) < (vPrev.get(k + 1) ?? -1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = vPrev.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      lines.push({ type: "context", text: a[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (down) {
      lines.push({ type: "add", text: b[y - 1] });
      y -= 1;
    } else {
      lines.push({ type: "del", text: a[x - 1] });
      x -= 1;
    }
  }
  while (x > 0 && y > 0) {
    lines.push({ type: "context", text: a[x - 1] });
    x -= 1;
    y -= 1;
  }
  return lines.reverse();
}

export function parseUnifiedDiff(text: string): { path?: string; lines: DiffLine[] } | undefined {
  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  let path: string | undefined;
  const lines: DiffLine[] = [];
  let inHunks = false;
  const stripPrefix = (value: string) => value.replace(/^[ab]\//, "");
  for (const raw of rawLines) {
    if (raw.startsWith("--- ")) {
      const name = raw.slice(4).trim();
      if (name !== "/dev/null") path = stripPrefix(name);
      continue;
    }
    if (raw.startsWith("+++ ")) {
      const name = raw.slice(4).trim();
      if (name !== "/dev/null") path = stripPrefix(name);
      continue;
    }
    if (raw.startsWith("@@")) {
      inHunks = true;
      continue;
    }
    if (raw.startsWith("diff --git") || raw.startsWith("index ") || raw.startsWith("\\")) {
      continue;
    }
    if (!inHunks) continue;
    if (raw.startsWith("+")) {
      lines.push({ type: "add", text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      lines.push({ type: "del", text: raw.slice(1) });
    } else if (raw.startsWith(" ") || raw === "") {
      lines.push({ type: "context", text: raw.slice(1) });
    }
  }
  if (!path && lines.length === 0) return undefined;
  return { path, lines };
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export function diffPayloadsFromContent(content: unknown): DiffPayload[] {
  if (!Array.isArray(content)) return [];
  const payloads: DiffPayload[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    if (record.type !== "diff") continue;
    const newText = typeof record.newText === "string"
      ? record.newText
      : typeof record.new_text === "string"
        ? record.new_text
        : undefined;
    if (newText === undefined) continue;
    const oldRaw = record.oldText ?? record.old_text;
    payloads.push({
      path: typeof record.path === "string" && record.path ? record.path : undefined,
      oldText: typeof oldRaw === "string" ? oldRaw : null,
      newText,
    });
  }
  return payloads;
}

export function diffPayloadsFromInput(rawInput: unknown): DiffPayload[] {
  if (Array.isArray(rawInput)) {
    return rawInput.flatMap((item) => diffPayloadsFromInput(item));
  }
  if (!rawInput || typeof rawInput !== "object") return [];
  const input = rawInput as Record<string, unknown>;
  const content = diffPayloadsFromContent(input.content);
  if (content.length > 0) return content;

  const path = firstString(input, ["filePath", "file_path", "path", "filename"]);
  const oldText = firstString(input, ["oldString", "old_string", "oldText", "old_text", "oldContent", "old_content"]);
  const newText = firstString(input, ["newString", "new_string", "newText", "new_text", "newContent", "new_content"]);
  const body = firstString(input, ["content"]);

  // Edit shape: a path plus a paired old/new text (opencode sends
  // {filePath, oldString, newString}; other runtimes vary the spelling).
  if (path && oldText !== undefined && newText !== undefined) {
    return [{ path, oldText, newText }];
  }
  // Write/create shape: a path plus content with no old text (fs/write_text_file).
  // `text` is deliberately not a write-body key — ACP text blocks carry one and
  // a file path is never paired with it.
  if (path && body !== undefined && body.length > 0) {
    return [{ path, oldText: null, newText: body }];
  }

  for (const key of ["input", "args", "arguments", "rawInput"]) {
    const nested = diffPayloadsFromInput(input[key]);
    if (nested.length > 0) return nested;
  }
  return [];
}
