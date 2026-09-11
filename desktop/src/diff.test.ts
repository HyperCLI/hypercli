import { describe, expect, it } from "vitest";
import {
  computeLineDiff,
  diffPayloadsFromContent,
  diffPayloadsFromInput,
  parseUnifiedDiff,
  splitLines,
} from "./diff";

function summarize(lines: ReturnType<typeof computeLineDiff>) {
  return lines.map((line) => `${line.type === "add" ? "+" : line.type === "del" ? "-" : " "}${line.text}`);
}

describe("splitLines", () => {
  it("splits on newlines and drops a single trailing empty segment", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
  });

  it("keeps interior and trailing blank lines", () => {
    expect(splitLines("a\n\n\nb")).toEqual(["a", "", "", "b"]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
  });

  it("normalizes CRLF", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
  });

  it("returns an empty list for empty input", () => {
    expect(splitLines("")).toEqual([]);
  });
});

describe("computeLineDiff", () => {
  it("produces an insert-only diff", () => {
    expect(summarize(computeLineDiff("", "one\ntwo\n"))).toEqual(["+one", "+two"]);
  });

  it("produces a delete-only diff", () => {
    expect(summarize(computeLineDiff("one\ntwo\n", ""))).toEqual(["-one", "-two"]);
  });

  it("produces a mixed diff with shared prefix and suffix as context", () => {
    const summary = summarize(computeLineDiff("a\nb\nc\nd\n", "a\nx\nc\ny\n"));
    expect(summary).toEqual([" a", "-b", "+x", " c", "-d", "+y"]);
  });

  it("handles blank lines as content, not separators", () => {
    expect(summarize(computeLineDiff("a\n\nb\n", "a\nb\n"))).toEqual([" a", "-", " b"]);
    expect(summarize(computeLineDiff("a\nb\n", "a\n\nb\n"))).toEqual([" a", "+", " b"]);
  });

  it("returns all context for identical inputs", () => {
    expect(computeLineDiff("same\nlines\n", "same\nlines\n")).toEqual([
      { type: "context", text: "same" },
      { type: "context", text: "lines" },
    ]);
  });

  it("keeps adjacent independent edits as edits, not context", () => {
    expect(summarize(computeLineDiff("a\nb\nc\n", "a\nx\nc\n"))).toEqual([" a", "-b", "+x", " c"]);
  });

  it("falls back to a full replace for very large inputs", () => {
    const oldText = Array.from({ length: 1600 }, (_, i) => `old-${i}`).join("\n");
    const newText = Array.from({ length: 1600 }, (_, i) => `new-${i}`).join("\n");
    const lines = computeLineDiff(oldText, newText);
    expect(lines.filter((line) => line.type === "del")).toHaveLength(1600);
    expect(lines.filter((line) => line.type === "add")).toHaveLength(1600);
    expect(lines.some((line) => line.type === "context")).toBe(false);
  });
});

describe("parseUnifiedDiff", () => {
  const unified = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index 1111111..2222222 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1,4 +1,4 @@",
    " import a;",
    "-const x = 1;",
    "+const x = 2;",
    " ",
    " export {};",
  ].join("\n");

  it("parses path and line markers", () => {
    const parsed = parseUnifiedDiff(unified);
    expect(parsed?.path).toBe("src/app.ts");
    expect(parsed?.lines.map((line) => `${line.type}:${line.text}`)).toEqual([
      "context:import a;",
      "del:const x = 1;",
      "add:const x = 2;",
      "context:",
      "context:export {};",
    ]);
  });

  it("returns undefined for a string without hunks or headers", () => {
    expect(parseUnifiedDiff("not a diff")).toBeUndefined();
  });

  it("records blank context lines inside a hunk", () => {
    const parsed = parseUnifiedDiff("--- a/f\n+++ b/f\n@@ -1 +1 @@\n \n-x\n+y\n\\ No newline at end of file");
    expect(parsed?.lines).toEqual([
      { type: "context", text: "" },
      { type: "del", text: "x" },
      { type: "add", text: "y" },
    ]);
  });
});

describe("diffPayloadsFromContent", () => {
  it("extracts ACP diff content blocks", () => {
    const payloads = diffPayloadsFromContent([
      { type: "content", content: { type: "text", text: "hi" } },
      { type: "diff", path: "/workspace/a.ts", oldText: "old\n", newText: "new\n" },
    ]);
    expect(payloads).toEqual([{ path: "/workspace/a.ts", oldText: "old\n", newText: "new\n" }]);
  });

  it("treats a null oldText as a new file", () => {
    const payloads = diffPayloadsFromContent([{ type: "diff", path: "/f", oldText: null, newText: "body" }]);
    expect(payloads).toEqual([{ path: "/f", oldText: null, newText: "body" }]);
  });

  it("ignores non-array input and non-diff blocks", () => {
    expect(diffPayloadsFromContent({ type: "diff", path: "/f", newText: "x" })).toEqual([]);
    expect(diffPayloadsFromContent([{ type: "text", text: "hi" }])).toEqual([]);
  });
});

describe("diffPayloadsFromInput", () => {
  it("extracts opencode-style edit args", () => {
    const payloads = diffPayloadsFromInput({
      filePath: "/workspace/app.ts",
      oldString: "const a = 1\n",
      newString: "const a = 2\n",
    });
    expect(payloads).toEqual([
      { path: "/workspace/app.ts", oldText: "const a = 1\n", newText: "const a = 2\n" },
    ]);
  });

  it("extracts snake_case edit args", () => {
    const payloads = diffPayloadsFromInput({
      file_path: "f.py",
      old_string: "a",
      new_string: "b",
    });
    expect(payloads).toEqual([{ path: "f.py", oldText: "a", newText: "b" }]);
  });

  it("extracts fs/write_text_file args as a new-file diff", () => {
    const payloads = diffPayloadsFromInput({ path: "/tmp/new.md", content: "# hi\n" });
    expect(payloads).toEqual([{ path: "/tmp/new.md", oldText: null, newText: "# hi\n" }]);
  });

  it("recurses through nested input/args wrappers", () => {
    const payloads = diffPayloadsFromInput({
      args: { input: { filePath: "a", oldString: "1", newString: "2" } },
    });
    expect(payloads).toEqual([{ path: "a", oldText: "1", newText: "2" }]);
  });

  it("does not treat a read-shaped payload as a diff", () => {
    expect(diffPayloadsFromInput({ filePath: "/workspace/app.ts" })).toEqual([]);
    expect(diffPayloadsFromInput({ command: "ls -la" })).toEqual([]);
    expect(diffPayloadsFromInput(undefined)).toEqual([]);
  });
});
