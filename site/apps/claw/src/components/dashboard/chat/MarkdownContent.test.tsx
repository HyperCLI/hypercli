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
    expect(pre).toHaveClass("whitespace-pre-wrap");
    expect(pre).not.toHaveClass("overflow-x-auto");
  });
});
