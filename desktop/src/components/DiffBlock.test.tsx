import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiffBlock, DiffLines } from "./DiffBlock";
import { computeLineDiff } from "../diff";

describe("DiffBlock", () => {
  it("renders the file header with counts and diff rows for a small edit", () => {
    const html = renderToStaticMarkup(
      <DiffBlock path="/workspace/app.ts" oldText={"a\nb\nc"} newText={"a\nx\nc"} />,
    );
    expect(html).toContain("app.ts");
    expect(html).toContain("+1");
    expect(html).toContain("−1");
    expect(html).toContain("diff-row-add");
    expect(html).toContain("diff-row-del");
    expect(html).toContain("diff-row-context");
    expect(html).toContain("<span class=\"diff-text\">x</span>");
    expect(html).toContain("diff-body");
  });

  it("marks a newly created file", () => {
    const html = renderToStaticMarkup(
      <DiffBlock path="docs/new.md" oldText={null} newText={"one\ntwo"} />,
    );
    expect(html).toContain("new file");
    expect(html).toContain("+2");
  });

  it("collapses to the header when the changed-line count is large", () => {
    const oldText = Array.from({ length: 50 }, (_, i) => `old ${i}`).join("\n");
    const newText = Array.from({ length: 50 }, (_, i) => `new ${i}`).join("\n");
    const html = renderToStaticMarkup(<DiffBlock path="big.ts" oldText={oldText} newText={newText} />);
    expect(html).not.toContain("diff-body");
    expect(html).toContain("+50");
  });

  it("caps the rendered rows and offers to reveal more", () => {
    const oldText = Array.from({ length: 500 }, (_, i) => `a${i}`).join("\n");
    const newText = Array.from({ length: 500 }, (_, i) => `b${i}`).join("\n");
    const lines = computeLineDiff(oldText, newText);
    const html = renderToStaticMarkup(<DiffLines lines={lines} />);
    const rows = html.match(/diff-row /g) ?? [];
    expect(rows).toHaveLength(400);
    expect(html).toContain("more");
    expect(html).toContain("600 hidden lines");
  });

  it("accepts a unified diff string", () => {
    const unified = "--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-old\n+new\n";
    const html = renderToStaticMarkup(<DiffBlock diff={unified} />);
    expect(html).toContain("f.ts");
    expect(html).toContain("diff-row-del");
    expect(html).toContain("diff-row-add");
  });
});
