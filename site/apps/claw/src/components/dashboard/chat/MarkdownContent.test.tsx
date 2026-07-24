import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MarkdownContent } from "./MarkdownContent";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, chart: string) => ({
    svg: `<svg data-testid="mermaid-svg"><text>${chart}</text></svg>`,
  })),
}));

vi.mock("mermaid", () => ({
  default: mermaidMock,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function mermaidMarkdown(chart: string): string {
  return ["```mermaid", chart, "```"].join("\n");
}

describe("MarkdownContent", () => {
  beforeEach(() => {
    mermaidMock.initialize.mockClear();
    mermaidMock.render.mockReset();
    mermaidMock.render.mockImplementation(async (_id: string, chart: string) => ({
      svg: `<svg data-testid="mermaid-svg"><text>${chart}</text></svg>`,
    }));
  });

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

  it("renders interactive task lists without clipped list markers", () => {
    const content = [
      "Tasks:",
      "",
      "- [ ] Parent task",
      "  - [x] Child task",
      "- [x] Completed task",
      "",
      "Regular list:",
      "",
      "- First item",
      "- Second item",
    ].join("\n");
    const { container, rerender } = render(<MarkdownContent content={content} />);
    const taskLists = Array.from(container.querySelectorAll("ul.contains-task-list"));
    const regularList = Array.from(container.querySelectorAll("ul")).find((list) => !list.classList.contains("contains-task-list"));
    const checkboxes = screen.getAllByRole("checkbox");

    expect(taskLists.length).toBeGreaterThanOrEqual(2);
    taskLists.forEach((list) => {
      expect(list).toHaveClass("list-none", "pl-5");
      expect(list).not.toHaveClass("list-disc");
    });
    expect(regularList).toHaveClass("list-disc", "pl-5");
    expect(checkboxes).toHaveLength(3);
    checkboxes.forEach((checkbox) => expect(checkbox).not.toBeDisabled());
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();

    fireEvent.click(checkboxes[0]!);
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[0]).toHaveAccessibleName("Mark task incomplete");

    rerender(<MarkdownContent content={content} />);
    expect(screen.getAllByRole("checkbox")[0]).toBe(checkboxes[0]);
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
  });

  it("keeps incomplete streamed emphasis structurally stable until its closing marker arrives", () => {
    const { container, rerender } = render(
      <MarkdownContent content="This is **bold te" isStreaming />,
    );
    const strong = screen.getByText("bold te");

    expect(strong.tagName).toBe("STRONG");
    expect(container).not.toHaveTextContent("**");

    rerender(
      <MarkdownContent content="This is **bold text that continues" isStreaming />,
    );
    expect(screen.getByText("bold text that continues")).toBe(strong);

    rerender(
      <MarkdownContent content="This is **bold text that continues**" isStreaming />,
    );
    expect(screen.getByText("bold text that continues")).toBe(strong);
    expect(container).not.toHaveTextContent("**");
  });

  it("repairs a single-asterisk emphasis span across cumulative stream updates", () => {
    const { rerender } = render(
      <MarkdownContent content="This is *a partial sentence" isStreaming />,
    );
    const emphasis = screen.getByText("a partial sentence");

    expect(emphasis.tagName).toBe("EM");

    rerender(
      <MarkdownContent content="This is *a partial sentence that continues" isStreaming />,
    );
    expect(screen.getByText("a partial sentence that continues")).toBe(emphasis);

    rerender(
      <MarkdownContent content="This is *a partial sentence that continues*" isStreaming />,
    );
    expect(screen.getByText("a partial sentence that continues")).toBe(emphasis);
  });

  it("recomputes streaming repairs from replacements and flushes exact malformed source when settled", () => {
    const { container, rerender } = render(
      <MarkdownContent content="Before **partial" isStreaming />,
    );
    expect(container.querySelector("strong")).toHaveTextContent("partial");

    rerender(<MarkdownContent content="Replacement without formatting" isStreaming />);
    expect(container.querySelector("strong")).not.toBeInTheDocument();
    expect(container).toHaveTextContent("Replacement without formatting");
    expect(container).not.toHaveTextContent("partial");

    rerender(<MarkdownContent content="Final **unfinished" />);
    expect(container.querySelector("strong")).not.toBeInTheDocument();
    expect(container).toHaveTextContent("Final **unfinished");
  });

  it("keeps incomplete streamed links inert and suppresses incomplete images", () => {
    const { container, rerender } = render(
      <MarkdownContent content="Read [the docs](https://exam" isStreaming />,
    );

    expect(container).toHaveTextContent("Read the docs");
    expect(screen.queryByRole("link", { name: "the docs" })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("https://exam");

    rerender(
      <MarkdownContent content="Read [the docs](https://example.com)" isStreaming />,
    );
    expect(screen.getByRole("link", { name: "the docs" })).toHaveAttribute("href", "https://example.com");

    rerender(
      <MarkdownContent content="Preview: ![generated image](https://exam" isStreaming />,
    );
    expect(screen.queryByRole("img", { name: "generated image" })).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("https://exam");
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
    expect(container.querySelector("pre code")).toHaveStyle({ color: "var(--foreground)" });
  });

  it("copies the exact contents of each generated code block", async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      const { unmount } = render(
        <MarkdownContent
          content={[
            "```python",
            "print('first')",
            "```",
            "",
            "```css",
            ".card { color: red; }",
            "```",
          ].join("\n")}
        />,
      );

      const pythonCopy = screen.getByRole("button", { name: "Copy python code" });
      const cssCopy = screen.getByRole("button", { name: "Copy css code" });
      fireEvent.click(cssCopy);

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(".card { color: red; }"));
      expect(screen.getByRole("button", { name: "Code copied" })).toHaveTextContent("Copied");
      expect(pythonCopy).toHaveTextContent("Copy");

      fireEvent.click(pythonCopy);
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("print('first')"));
      expect(screen.getAllByRole("button", { name: "Code copied" })).toHaveLength(2);
      unmount();
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });

  it("keeps Mermaid output tied to the current chart across deferred renders", async () => {
    const chartA = "flowchart TD\n  A[First] --> B[Done]";
    const chartB = "flowchart LR\n  B[Second] --> C[Done]";
    const firstA = deferred<{ svg: string }>();
    const secondA = deferred<{ svg: string }>();
    const pendingB = deferred<{ svg: string }>();
    let chartARenders = 0;
    mermaidMock.render.mockImplementation((_id: string, chart: string) => {
      if (chart === chartA) {
        chartARenders += 1;
        return chartARenders === 1 ? firstA.promise : secondA.promise;
      }
      return pendingB.promise;
    });

    const { rerender } = render(<MarkdownContent content={mermaidMarkdown(chartA)} />);
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledWith(expect.any(String), chartA));

    rerender(<MarkdownContent content={mermaidMarkdown(chartB)} />);
    expect(screen.getByRole("status", { name: /rendering diagram/i })).toBeInTheDocument();
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledWith(expect.any(String), chartB));

    await act(async () => {
      pendingB.resolve({ svg: '<svg data-testid="mermaid-b"></svg>' });
      await pendingB.promise;
    });
    expect(await screen.findByTestId("mermaid-b")).toBeInTheDocument();

    await act(async () => {
      firstA.resolve({ svg: '<svg data-testid="stale-mermaid-a"></svg>' });
      await firstA.promise;
    });
    expect(screen.getByTestId("mermaid-b")).toBeInTheDocument();
    expect(screen.queryByTestId("stale-mermaid-a")).not.toBeInTheDocument();

    rerender(<MarkdownContent content={mermaidMarkdown(chartA)} />);
    expect(screen.queryByTestId("mermaid-b")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: /rendering diagram/i })).toBeInTheDocument();
    await waitFor(() => expect(chartARenders).toBe(2));

    await act(async () => {
      secondA.resolve({ svg: '<svg data-testid="mermaid-a"></svg>' });
      await secondA.promise;
    });
    expect(await screen.findByTestId("mermaid-a")).toBeInTheDocument();
  });

  it("hides transient Mermaid parse errors while streaming and recovers", async () => {
    const partialChart = "gantt\n  title Test schedule\n  section Phase 1\n  Text types :";
    const completeChart = `${partialChart} done, 2026-01-01, 1d`;
    mermaidMock.render
      .mockRejectedValueOnce(new Error("Parse error: expecting taskData"))
      .mockResolvedValueOnce({ svg: '<svg data-testid="streamed-mermaid"></svg>' });

    const { container, rerender } = render(
      <MarkdownContent content={mermaidMarkdown(partialChart)} isStreaming />,
    );
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledWith(expect.any(String), partialChart));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole("status", { name: /rendering diagram/i })).toBeInTheDocument();
    expect(screen.queryByText(/parse error/i)).not.toBeInTheDocument();
    expect(container.querySelector("pre")).not.toBeInTheDocument();

    rerender(<MarkdownContent content={mermaidMarkdown(completeChart)} isStreaming />);
    expect(await screen.findByTestId("streamed-mermaid")).toBeInTheDocument();
    expect(screen.queryByText(/parse error/i)).not.toBeInTheDocument();
  });

  it("shows Mermaid parse details once an invalid stream settles", async () => {
    const invalidChart = "gantt\n  section Phase 1\n  Text types :";
    mermaidMock.render.mockRejectedValueOnce(new Error("Parse error: expecting taskData"));

    const { container, rerender } = render(
      <MarkdownContent content={mermaidMarkdown(invalidChart)} isStreaming />,
    );
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledWith(expect.any(String), invalidChart));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText(/parse error/i)).not.toBeInTheDocument();

    rerender(<MarkdownContent content={mermaidMarkdown(invalidChart)} />);
    expect(await screen.findByText("Parse error: expecting taskData")).toBeInTheDocument();
    expect(container.querySelector("pre code")?.textContent).toBe(invalidChart);
  });

  it("uses unique Mermaid render IDs for concurrent diagrams in StrictMode", async () => {
    render(
      <StrictMode>
        <MarkdownContent
          content={[
            mermaidMarkdown("flowchart TD\n  A --> B"),
            mermaidMarkdown("flowchart LR\n  C --> D"),
          ].join("\n\n")}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getAllByRole("img", { name: /mermaid diagram/i })).toHaveLength(2));
    const renderIds = mermaidMock.render.mock.calls.map(([id]) => id);
    expect(renderIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(renderIds).size).toBe(renderIds.length);
    expect(renderIds.every((id) => id.startsWith("markdown-mermaid-"))).toBe(true);
  });

  it("resolves concrete active-theme colors before initializing Mermaid", async () => {
    const root = document.documentElement;
    const tokens = {
      "--background": "#010203",
      "--surface-low": "#111213",
      "--foreground": "#f1f2f3",
      "--border-medium": "rgba(1, 2, 3, 0.4)",
      "--text-secondary": "#a1a2a3",
    };
    const previousTokens = Object.fromEntries(Object.keys(tokens).map((property) => [property, root.style.getPropertyValue(property)]));

    try {
      Object.entries(tokens).forEach(([property, value]) => root.style.setProperty(property, value));
      render(<MarkdownContent content={mermaidMarkdown("flowchart TD\n  A --> B")} />);

      await waitFor(() => expect(mermaidMock.initialize).toHaveBeenCalled());
      expect(mermaidMock.initialize).toHaveBeenLastCalledWith(expect.objectContaining({
        themeVariables: {
          background: "#010203",
          mainBkg: "#111213",
          primaryColor: "#111213",
          primaryTextColor: "#f1f2f3",
          primaryBorderColor: "rgba(1, 2, 3, 0.4)",
          lineColor: "#a1a2a3",
          textColor: "#f1f2f3",
        },
      }));
      const configuration = mermaidMock.initialize.mock.calls.at(-1)?.[0];
      expect(Object.values(configuration?.themeVariables ?? {}).every((value) => !String(value).includes("var("))).toBe(true);
    } finally {
      Object.entries(previousTokens).forEach(([property, value]) => {
        if (value) root.style.setProperty(property, value);
        else root.style.removeProperty(property);
      });
    }
  });

  it("falls back to concrete light-theme colors for unresolved tokens", async () => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute("data-theme");
    const previousSurface = root.style.getPropertyValue("--surface-low");
    root.setAttribute("data-theme", "light");
    root.style.setProperty("--surface-low", "var(--missing-mermaid-surface)");

    try {
      render(<MarkdownContent content={mermaidMarkdown("flowchart TD\n  A --> B")} />);

      await waitFor(() => expect(mermaidMock.initialize).toHaveBeenCalled());
      expect(mermaidMock.initialize.mock.calls.at(-1)?.[0]?.themeVariables).toEqual(expect.objectContaining({
        mainBkg: "#ffffff",
        primaryColor: "#ffffff",
      }));
    } finally {
      if (previousTheme) root.setAttribute("data-theme", previousTheme);
      else root.removeAttribute("data-theme");
      if (previousSurface) root.style.setProperty("--surface-low", previousSurface);
      else root.style.removeProperty("--surface-low");
    }
  });

  it("renders basic images and presents image titles as tooltips", async () => {
    render(
      <MarkdownContent content={'![Preview image](https://example.com/preview.png "Preview title")'} />,
    );

    const imageTrigger = screen.getByRole("button", { name: /view preview image/i });
    expect(screen.getByAltText("Preview image")).not.toHaveAttribute("title");
    fireEvent.focus(imageTrigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Preview title");
  });

  it("ignores raw HTML while rendering markdown syntax", () => {
    render(
      <MarkdownContent content={'<h2>Raw heading</h2>\n\n**Markdown survives**\n\n<script>alert("x")</script>\n\n<iframe src="https://example.com"></iframe>'} />,
    );

    expect(screen.queryByRole("heading", { name: "Raw heading" })).not.toBeInTheDocument();
    expect(screen.getByText("Markdown survives")).toHaveClass("font-semibold");
    expect(screen.queryByText(/alert\("x"\)/i)).not.toBeInTheDocument();
    expect(document.querySelector("iframe")).not.toBeInTheDocument();
  });

  it("renders a complete OpenClaw data HTML embed in a strict sandbox", () => {
    const html = '<html><head><style>body{font-family:Arial;background:#1a1a2e;color:#fff}</style></head><body><h1>Embedded Content</h1></body></html>';
    render(
      <MarkdownContent content={`[embed url="data:text/html,${html}" title="Test Embed" height="200" /]`} />,
    );

    const frame = screen.getByTitle("Test Embed");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).not.toHaveAttribute("src");
    expect(frame).not.toHaveAttribute("allow");
    expect(frame).toHaveStyle({ height: "200px" });
    expect(frame.getAttribute("srcdoc")).toContain("Content-Security-Policy");
    expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
    expect(frame.getAttribute("srcdoc")).toContain("<h1>Embedded Content</h1>");
  });

  it("keeps unsupported embed directives literal", () => {
    const unsafeDirective = '[embed url="javascript:alert(1)" title="Unsafe" height="200" /]';
    render(<MarkdownContent content={unsafeDirective} />);

    expect(screen.getByText(unsafeDirective)).toBeInTheDocument();
    expect(document.querySelector("iframe")).not.toBeInTheDocument();
  });

  it("waits for a streamed embed directive to complete before rendering it", () => {
    const { rerender } = render(
      <MarkdownContent content={'[embed url="data:text/html,<h1>Partial</h1>" title="Test Embed"'} isStreaming />,
    );
    expect(document.querySelector("iframe")).not.toBeInTheDocument();

    rerender(
      <MarkdownContent content={'[embed url="data:text/html,<h1>Complete</h1>" title="Test Embed" height="200" /]'} isStreaming />,
    );
    expect(screen.getByTitle("Test Embed")).toBeInTheDocument();
  });

  it("does not interpret embed directives inside fenced code", () => {
    const directive = '[embed url="data:text/html,<h1>Code</h1>" title="Code Embed" height="200" /]';
    const { container } = render(<MarkdownContent content={["```text", directive, "```"].join("\n")} />);

    expect(screen.queryByTitle("Code Embed")).not.toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent(directive);
  });

  it("renders inline HTML keyboard keys as semantic keycaps", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy.",
          "",
          "Press <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> to reopen a closed tab.",
          "",
          "- <kbd>Alt</kbd> + <kbd>F4</kbd> to close window",
        ].join("\n")}
      />,
    );

    const keys = Array.from(container.querySelectorAll("kbd"));
    expect(keys.map((key) => key.textContent)).toEqual(["Ctrl", "C", "Cmd", "Shift", "T", "Alt", "F4"]);
    keys.forEach((key) => expect(key).toHaveClass("font-mono", "border-b-2", "bg-surface-low"));
  });

  it("strips attributes from inline keyboard markup", () => {
    const { container } = render(
      <MarkdownContent content={'Press <kbd onclick="alert(1)" style="display:none" title="Hidden">Ctrl</kbd> + <kbd>C</kbd>.'} />,
    );

    const key = container.querySelector("kbd");
    expect(key).toHaveTextContent("Ctrl");
    expect(key).not.toHaveAttribute("onclick");
    expect(key).not.toHaveAttribute("style");
    expect(key).not.toHaveAttribute("title");
  });

  it("keeps streamed keyboard markup stable when the closing tag arrives", () => {
    const { container, rerender } = render(<MarkdownContent content="Press <kbd>Ctrl" isStreaming />);
    const key = container.querySelector("kbd");
    expect(key).toHaveTextContent("Ctrl");

    rerender(<MarkdownContent content="Press <kbd>Ctrl</kbd> + <kbd>C</kbd>" isStreaming />);
    expect(container.querySelector("kbd")).toBe(key);
    expect(Array.from(container.querySelectorAll("kbd")).map((item) => item.textContent)).toEqual(["Ctrl", "C"]);
  });

  it("renders GitHub-style note alerts without exposing the marker", () => {
    render(
      <MarkdownContent content={'> [!NOTE] This is a note callout. It should render with distinctive "note" styling.'} />,
    );

    const callout = screen.getByRole("note", { name: "Note callout" });
    expect(callout).toHaveClass("border-info/50", "bg-info/8");
    expect(within(callout).getByText("Note")).toBeInTheDocument();
    expect(callout).toHaveTextContent("This is a note callout.");
    expect(callout).not.toHaveTextContent("[!NOTE]");
    expect(callout.querySelector("blockquote")).not.toBeInTheDocument();
  });

  it.each([
    ["TIP", "Tip callout", "border-primary/50"],
    ["IMPORTANT", "Important callout", "border-primary/50"],
    ["WARNING", "Warning callout", "border-warning/50"],
    ["CAUTION", "Caution callout", "border-destructive/50"],
  ])("renders the %s alert variant", (marker, accessibleName, borderClass) => {
    render(<MarkdownContent content={`> [!${marker}]\n> Alert body`} />);

    const callout = screen.getByRole("note", { name: accessibleName });
    expect(callout).toHaveClass(borderClass);
    expect(callout).toHaveTextContent("Alert body");
  });

  it("preserves ordinary and unknown blockquotes", () => {
    const { container } = render(
      <MarkdownContent content={["> Ordinary quote", "", "> [!UNKNOWN]", "> Unknown quote"].join("\n")} />,
    );

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    const quotes = Array.from(container.querySelectorAll("blockquote"));
    expect(quotes).toHaveLength(2);
    quotes.forEach((quote) => expect(quote).toHaveClass("italic", "border-text-muted"));
    expect(container).toHaveTextContent("[!UNKNOWN]");
  });

  it("renders a sanitized HTML video block with native controls", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "Here is a test video via URL:",
          "",
          '<video controls width="640">',
          '  <source src="https://www.w3schools.com/html/mov_bbb.mp4" type="video/mp4">',
          "  Your browser does not support the video tag.",
          "</video>",
          "",
          "*(If you don't see a player, this frontend may not support HTML video tags.)*",
        ].join("\n")}
      />,
    );

    const video = screen.getByLabelText("Video preview");
    const source = container.querySelector("video source");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).not.toHaveAttribute("width");
    expect(source).toHaveAttribute("src", "https://www.w3schools.com/html/mov_bbb.mp4");
    expect(source).toHaveAttribute("type", "video/mp4");
    expect(screen.getByText(/if you don't see a player/i)).toHaveClass("italic");
  });

  it("drops executable video attributes and unsafe video sources", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          '<video autoplay onplay="alert(1)" style="display:none">',
          '  <source src="javascript:alert(2)" type="text/html" onerror="alert(3)">',
          "</video>",
        ].join("\n")}
      />,
    );

    const video = screen.getByLabelText("Video preview");
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video).not.toHaveAttribute("onplay");
    expect(video).not.toHaveAttribute("style");
    expect(container.querySelector("video source")).not.toBeInTheDocument();
  });

  it("does not interpret video HTML inside a fenced code block", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "```html",
          '<video controls><source src="https://example.com/demo.mp4" type="video/mp4"></video>',
          "```",
        ].join("\n")}
      />,
    );

    expect(screen.queryByLabelText(/video preview/i)).not.toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent("<video controls>");
  });

  it("renders linked images with custom title tooltips", async () => {
    render(
      <MarkdownContent content={'[![Logo](https://example.com/logo.png "Logo title")](https://example.com)'} />,
    );

    const link = screen.getByRole("link", { name: /logo/i });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(link).getByAltText("Logo")).not.toHaveAttribute("title");
    expect(within(link).queryByRole("button")).not.toBeInTheDocument();
    fireEvent.focus(within(link).getByAltText("Logo").parentElement!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Logo title");
  });

  it("renders footnotes, abbreviations, and emoji shortcodes", async () => {
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

    const abbreviation = container.querySelector("abbr");
    expect(abbreviation).toHaveTextContent("HTML");
    expect(abbreviation).not.toHaveAttribute("title");
    fireEvent.focus(abbreviation!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("HyperText Markup Language");
    expect(screen.getByText(/🚀/)).toBeInTheDocument();
    expect(screen.getByText("Footnote detail.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute("href", "#user-content-fn-1");
  });

  it("links file mentions to the workspace file opener", () => {
    const onOpenWorkspaceFile = vi.fn();
    render(
      <MarkdownContent
        content="Updated src/app.tsx and /home/node/.openclaw/workspace/report.md."
        onOpenWorkspaceFile={onOpenWorkspaceFile}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "src/app.tsx" }));
    fireEvent.click(screen.getByRole("link", { name: "/home/node/.openclaw/workspace/report.md" }));

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith("src/app.tsx");
    expect(onOpenWorkspaceFile).toHaveBeenCalledWith(".openclaw/workspace/report.md");
  });

  it("links inline-code file mentions to the workspace file opener", () => {
    const onOpenWorkspaceFile = vi.fn();
    render(<MarkdownContent content="Open `src/app.tsx`." onOpenWorkspaceFile={onOpenWorkspaceFile} />);

    const link = screen.getByRole("link", { name: "src/app.tsx" });
    expect(within(link).getByText("src/app.tsx")).toHaveClass("font-mono");
    fireEvent.click(link);

    expect(onOpenWorkspaceFile).toHaveBeenCalledWith("src/app.tsx");
  });

  it("does not linkify file mentions inside code blocks", () => {
    const onOpenWorkspaceFile = vi.fn();
    const { container } = render(
      <MarkdownContent
        content={["```text", "src/app.tsx", "```"].join("\n")}
        onOpenWorkspaceFile={onOpenWorkspaceFile}
      />,
    );

    expect(screen.queryByRole("link", { name: "src/app.tsx" })).not.toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent("src/app.tsx");
  });

  it("does not linkify common technology names as bare files", () => {
    const onOpenWorkspaceFile = vi.fn();
    render(<MarkdownContent content="The project runs on Node.js." onOpenWorkspaceFile={onOpenWorkspaceFile} />);

    expect(screen.queryByRole("link", { name: "Node.js" })).not.toBeInTheDocument();
    expect(screen.getByText(/node\.js/i)).toBeInTheDocument();
  });
});
