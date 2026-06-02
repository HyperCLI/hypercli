import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders chat markdown tables, code blocks, lists, and links", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "Here's a table:",
          "",
          "| Section | Width | Purpose |",
          "|---------|-------|---------|",
          "| Left | 75 cm | Double hanging |",
          "| Center | 50 cm | Storage |",
          "",
          "```text",
          "panel: 250cm x 55cm",
          "```",
          "",
          "1. Cut all panels.",
          "2. Install rods.",
          "",
          "[Open docs](https://example.com/docs)",
        ].join("\n")}
      />,
    );

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Section" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "Double hanging" })).toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent("panel: 250cm x 55cm");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Open docs" })).toHaveAttribute("target", "_blank");
  });

  it("wraps long markdown content instead of enabling horizontal scroll", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "| Very long header | Another long header |",
          "|------------------|---------------------|",
          "| supercalifragilisticexpialidocioussupercalifragilisticexpialidocious | https://example.com/really/long/path/that/should/not/push/the/chat/wider |",
          "",
          "```text",
          "const value = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';",
          "```",
        ].join("\n")}
      />,
    );

    const table = screen.getByRole("table");
    const tableWrapper = table.parentElement;
    const pre = container.querySelector("pre");
    const firstCell = within(table).getByRole("cell", { name: /supercalifragilistic/i });

    expect(tableWrapper).toHaveClass("overflow-hidden");
    expect(tableWrapper).not.toHaveClass("overflow-x-auto");
    expect(table).toHaveClass("table-fixed");
    expect(firstCell.className).toContain("[overflow-wrap:anywhere]");
    expect(pre).toHaveStyle({ whiteSpace: "pre-wrap" });
    expect(pre).toHaveStyle({ overflow: "hidden" });
  });

  it("renders fenced code language, line numbers, and highlighted lines", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "```tsx {2} showLineNumbers",
          "const value = 1;",
          "return value;",
          "```",
        ].join("\n")}
      />,
    );

    expect(screen.getByText("tsx")).toBeInTheDocument();
    expect(screen.getByText("Line numbers")).toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent("return value;");
    expect(container.querySelector('[style*="border-left"]')).toBeInTheDocument();
  });

  it("renders basic images and preserves image titles", () => {
    render(
      <MarkdownContent content={'![Preview image](https://example.com/preview.png "Preview title")'} />,
    );

    expect(screen.getByRole("button", { name: /view preview image/i })).toBeInTheDocument();
    expect(screen.getByAltText("Preview image")).toHaveAttribute("title", "Preview title");
  });

  it("ignores raw HTML while rendering markdown syntax", () => {
    render(
      <MarkdownContent content={'<h2>Raw heading</h2>\n\n**Markdown survives**\n\n<script>alert("x")</script>'} />,
    );

    expect(screen.queryByRole("heading", { name: "Raw heading" })).not.toBeInTheDocument();
    expect(screen.getByText("Markdown survives")).toHaveClass("font-semibold");
    expect(screen.queryByText(/alert\("x"\)/i)).not.toBeInTheDocument();
  });

  it("renders linked images as images inside links", () => {
    render(
      <MarkdownContent content={'[![Logo](https://example.com/logo.png "Logo title")](https://example.com)'} />,
    );

    const link = screen.getByRole("link", { name: /logo/i });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(link).getByAltText("Logo")).toHaveAttribute("title", "Logo title");
    expect(within(link).queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders footnotes, abbreviations, and emoji shortcodes", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "The HTML parser ships with footnotes[^1] :rocket:.",
          "",
          "*[HTML]: HyperText Markup Language",
          "",
          "[^1]: Footnote detail.",
        ].join("\n")}
      />,
    );

    expect(container.querySelector('abbr[title="HyperText Markup Language"]')).toHaveTextContent("HTML");
    expect(screen.getByText(/🚀/)).toBeInTheDocument();
    expect(screen.getByText("Footnote detail.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute("href", "#user-content-fn-1");
  });
});
