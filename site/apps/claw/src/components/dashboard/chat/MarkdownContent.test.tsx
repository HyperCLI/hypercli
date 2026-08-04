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

  it("keeps currency and shell variables as text while streaming and after settlement", () => {
    const content = "The $119,334 estimated balance conflicts with $94k equity. Compare $HOME with $PATH.";
    const { container, rerender } = render(<MarkdownContent content={content} isStreaming />);

    expect(container).toHaveTextContent(content);
    expect(container.querySelector(".katex")).not.toBeInTheDocument();

    rerender(<MarkdownContent content={content} />);
    expect(container).toHaveTextContent(content);
    expect(container.querySelector(".katex")).not.toBeInTheDocument();
  });

  it("keeps shell and inline double-dollar prose literal while streaming and settled", () => {
    const content = "Run echo $$ for the shell PID. Formula: $$E = mc^2$$.";
    const { container, rerender } = render(<MarkdownContent content={content} isStreaming />);

    expect(container).toHaveTextContent(content);
    expect(container.querySelector(".katex")).not.toBeInTheDocument();

    rerender(<MarkdownContent content={content} />);
    expect(container).toHaveTextContent(content);
    expect(container.querySelector(".katex")).not.toBeInTheDocument();
  });

  it("keeps unclosed flow math literal while streaming and settled", () => {
    const content = "$$\nE = mc^2";
    const { container, rerender } = render(<MarkdownContent content={content} isStreaming />);

    expect(container).toHaveTextContent("$$ E = mc^2");
    expect(container.querySelector(".katex")).not.toBeInTheDocument();
    expect(container.querySelectorAll("br")).toHaveLength(1);

    rerender(<MarkdownContent content={content} />);
    expect(container).toHaveTextContent("$$ E = mc^2");
    expect(container.querySelector(".katex")).not.toBeInTheDocument();
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("renders only closed standalone multiline double-dollar blocks as math", () => {
    const content = ["$$", "E = mc^2", "$$"].join("\n");
    const { container, rerender } = render(<MarkdownContent content={content} isStreaming />);

    expect(container.querySelector(".katex-display .katex")).toBeInTheDocument();

    rerender(<MarkdownContent content={content} />);
    expect(container.querySelector(".katex-display .katex")).toBeInTheDocument();
  });

  it("does not pair single tildes across prose", () => {
    const content = "10~20 and 30~40";
    const { container, rerender } = render(<MarkdownContent content={content} isStreaming />);

    expect(container.textContent).toBe(content);
    expect(container.querySelector("del")).not.toBeInTheDocument();

    rerender(<MarkdownContent content={content} />);
    expect(container.textContent).toBe(content);
    expect(container.querySelector("del")).not.toBeInTheDocument();
  });

  it("still renders explicit double-tilde strikethrough", () => {
    const { container } = render(<MarkdownContent content="Keep ~~obsolete~~ archived." isStreaming />);

    expect(container.querySelector("del")).toHaveTextContent("obsolete");
  });

  it("preserves single line breaks in streamed and settled chat text", () => {
    const content = "First line\nSecond line\nThird line";
    const { container, rerender } = render(<MarkdownContent content={content} isStreaming />);

    expect(container.querySelectorAll("p br")).toHaveLength(2);

    rerender(<MarkdownContent content={content} />);
    expect(container.querySelectorAll("p br")).toHaveLength(2);
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

  it.each([
    "arr[0",
    "[0, 1",
    "_DEBUG",
    "rm *.log",
    "src/**/test.ts",
    "cat <input.txt",
  ])("preserves ambiguous source exactly while streaming and settled: %s", (content) => {
    const { container, rerender } = render(<MarkdownContent content={content} isStreaming />);

    expect(container.textContent).toBe(content);

    rerender(<MarkdownContent content={content} />);
    expect(container.textContent).toBe(content);
  });

  it("keeps incomplete streamed strong emphasis literal until its closing marker arrives", () => {
    const { container, rerender } = render(
      <MarkdownContent content="This is **bold te" isStreaming />,
    );

    expect(container.textContent).toBe("This is **bold te");
    expect(container.querySelector("strong")).not.toBeInTheDocument();

    rerender(
      <MarkdownContent content="This is **bold text that continues" isStreaming />,
    );
    expect(container.textContent).toBe("This is **bold text that continues");
    expect(container.querySelector("strong")).not.toBeInTheDocument();

    rerender(
      <MarkdownContent content="This is **bold text that continues**" isStreaming />,
    );
    expect(container.querySelector("strong")).toHaveTextContent("bold text that continues");
    expect(container).not.toHaveTextContent("**");
  });

  it("keeps incomplete streamed emphasis literal until its closing marker arrives", () => {
    const { container, rerender } = render(
      <MarkdownContent content="This is *a partial sentence" isStreaming />,
    );

    expect(container.textContent).toBe("This is *a partial sentence");
    expect(container.querySelector("em")).not.toBeInTheDocument();

    rerender(
      <MarkdownContent content="This is *a partial sentence that continues" isStreaming />,
    );
    expect(container.textContent).toBe("This is *a partial sentence that continues");
    expect(container.querySelector("em")).not.toBeInTheDocument();

    rerender(
      <MarkdownContent content="This is *a partial sentence that continues*" isStreaming />,
    );
    expect(container.querySelector("em")).toHaveTextContent("a partial sentence that continues");
  });

  it("recomputes streaming source from replacements and keeps malformed settled source exact", () => {
    const { container, rerender } = render(
      <MarkdownContent content="Before **partial" isStreaming />,
    );
    expect(container.querySelector("strong")).not.toBeInTheDocument();
    expect(container.textContent).toBe("Before **partial");

    rerender(<MarkdownContent content="Replacement without formatting" isStreaming />);
    expect(container.querySelector("strong")).not.toBeInTheDocument();
    expect(container).toHaveTextContent("Replacement without formatting");
    expect(container).not.toHaveTextContent("partial");

    rerender(<MarkdownContent content="Final **unfinished" />);
    expect(container.querySelector("strong")).not.toBeInTheDocument();
    expect(container).toHaveTextContent("Final **unfinished");
  });

  it("keeps incomplete streamed links and images inert without dropping their source", () => {
    const { container, rerender } = render(
      <MarkdownContent content="Read [the docs](https://exam" isStreaming />,
    );

    expect(container.textContent).toBe("Read [the docs](https://exam");
    expect(screen.queryByRole("link", { name: "the docs" })).not.toBeInTheDocument();

    rerender(
      <MarkdownContent content="Read [the docs](https://example.com)" isStreaming />,
    );
    expect(screen.getByRole("link", { name: "the docs" })).toHaveAttribute("href", "https://example.com");

    rerender(
      <MarkdownContent content="Preview: ![generated image](https://exam" isStreaming />,
    );
    expect(screen.queryByRole("img", { name: "generated image" })).not.toBeInTheDocument();
    expect(container.textContent).toBe("Preview: ![generated image](https://exam");
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

  it("does not close a code fence when the marker has trailing text", () => {
    const content = [
      "```text",
      "first line",
      "``` trailing text",
      "second line",
      "```",
    ].join("\n");
    const { container } = render(<MarkdownContent content={content} />);

    expect(container.querySelectorAll("pre code")).toHaveLength(1);
    expect(container.querySelector("pre code")).toHaveTextContent("first line ``` trailing text second line");
  });

  it("preserves a literal first code line that begins with the metadata marker", () => {
    const firstLine = "__OPENCLAW_CODE_META__:literal source";
    const { container } = render(
      <MarkdownContent content={["```text", firstLine, "second line", "```"].join("\n")} />,
    );

    expect(container.querySelector("pre code")).toHaveTextContent(`${firstLine} second line`);
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

  it("defers Mermaid rendering until streaming settles", async () => {
    const partialChart = "gantt\n  title Test schedule\n  section Phase 1\n  Text types :";
    const completeChart = `${partialChart} done, 2026-01-01, 1d`;
    mermaidMock.render.mockResolvedValueOnce({ svg: '<svg data-testid="streamed-mermaid"></svg>' });

    const { container, rerender } = render(
      <MarkdownContent content={mermaidMarkdown(partialChart)} isStreaming />,
    );
    expect(screen.getByRole("status", { name: /rendering diagram/i })).toBeInTheDocument();
    expect(mermaidMock.render).not.toHaveBeenCalled();
    expect(screen.queryByText(/parse error/i)).not.toBeInTheDocument();
    expect(container.querySelector("pre")).not.toBeInTheDocument();

    rerender(<MarkdownContent content={mermaidMarkdown(completeChart)} isStreaming />);
    expect(mermaidMock.render).not.toHaveBeenCalled();
    rerender(<MarkdownContent content={mermaidMarkdown(completeChart)} />);
    expect(await screen.findByTestId("streamed-mermaid")).toBeInTheDocument();
    expect(screen.queryByText(/parse error/i)).not.toBeInTheDocument();
  });

  it("shows Mermaid parse details once an invalid stream settles", async () => {
    const invalidChart = "gantt\n  section Phase 1\n  Text types :";
    mermaidMock.render.mockRejectedValueOnce(new Error("Parse error: expecting taskData"));

    const { container, rerender } = render(
      <MarkdownContent content={mermaidMarkdown(invalidChart)} isStreaming />,
    );
    expect(mermaidMock.render).not.toHaveBeenCalled();
    expect(screen.queryByText(/parse error/i)).not.toBeInTheDocument();

    rerender(<MarkdownContent content={mermaidMarkdown(invalidChart)} />);
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledWith(expect.any(String), invalidChart));
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
    const previousMode = root.getAttribute("data-color-mode");
    const previousSurface = root.style.getPropertyValue("--surface-low");
    root.setAttribute("data-color-mode", "light");
    root.style.setProperty("--surface-low", "var(--missing-mermaid-surface)");

    try {
      render(<MarkdownContent content={mermaidMarkdown("flowchart TD\n  A --> B")} />);

      await waitFor(() => expect(mermaidMock.initialize).toHaveBeenCalled());
      expect(mermaidMock.initialize.mock.calls.at(-1)?.[0]?.themeVariables).toEqual(expect.objectContaining({
        mainBkg: "#f7f9fc",
        primaryColor: "#f7f9fc",
      }));
    } finally {
      if (previousMode) root.setAttribute("data-color-mode", previousMode);
      else root.removeAttribute("data-color-mode");
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

  it("renders sanitized HTML img tags through the chat image viewer", async () => {
    const { container } = render(
      <MarkdownContent
        content={'<img src="https://example.com/html-preview.png" alt="HTML preview" title="HTML image title" width="900" onerror="alert(1)" style="display:none">'}
      />,
    );

    const trigger = screen.getByRole("button", { name: "View HTML preview" });
    const image = screen.getByAltText("HTML preview");
    expect(image).not.toHaveAttribute("onerror");
    expect(image.getAttribute("style")).not.toContain("display");
    expect(image).not.toHaveAttribute("width", "900");
    expect(container.querySelector("img")).toBe(image);
    fireEvent.focus(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("HTML image title");
  });

  it("preserves valid HTML image fetch priority hints", () => {
    const { rerender } = render(
      <MarkdownContent content={'<img src="https://example.com/priority.jpg" alt="Priority image" fetchpriority="high">'} />,
    );

    expect(screen.getByAltText("Priority image")).toHaveAttribute("fetchpriority", "high");

    rerender(
      <MarkdownContent content={'<img src="https://example.com/invalid-priority.jpg" alt="Invalid priority" fetchpriority="urgent">'} />,
    );
    expect(screen.getByAltText("Invalid priority")).not.toHaveAttribute("fetchpriority");
  });

  it("normalizes and renders an inline base64 PNG", () => {
    const payload = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nAAAAABJRU5ErkJggg==";
    const wrappedPayload = `${payload.slice(0, 44)} \n ${payload.slice(44)}`;
    render(
      <MarkdownContent content={`<img src="data:image/png;base64,${wrappedPayload}" alt="Inline base64 PNG">`} />,
    );

    const image = screen.getByAltText("Inline base64 PNG");
    expect(image).toHaveAttribute("src", `data:image/png;base64,${payload}`);
    expect(screen.getByRole("button", { name: "View Inline base64 PNG" })).toBeInTheDocument();
  });

  it("rejects malformed and SVG image data URLs", () => {
    const { container, rerender } = render(
      <MarkdownContent content={'<img src="data:image/png;base64,%%%" alt="Malformed data">'} />,
    );
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: /media preview unavailable/i })).toBeInTheDocument();

    rerender(
      <MarkdownContent content={'<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4=" alt="Unsafe SVG data">'} />,
    );
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: /media preview unavailable/i })).toBeInTheDocument();
  });

  it("rejects unsafe HTML img sources", () => {
    const { container } = render(
      <MarkdownContent content={'<img src="javascript:alert(1)" alt="Unsafe image">'} />,
    );

    expect(screen.getByRole("status", { name: /media preview unavailable/i })).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view unsafe image/i })).not.toBeInTheDocument();
  });

  it("waits for a streamed HTML img tag to close before rendering it", () => {
    const { rerender } = render(
      <MarkdownContent content={'<img src="https://example.com/streamed.png" alt="Streamed image"'} isStreaming />,
    );
    expect(screen.queryByRole("button", { name: /view streamed image/i })).not.toBeInTheDocument();

    rerender(
      <MarkdownContent content={'<img src="https://example.com/streamed.png" alt="Streamed image">'} isStreaming />,
    );
    expect(screen.getByRole("button", { name: /view streamed image/i })).toBeInTheDocument();
  });

  it("renders adjacent HTML images as a responsive gallery", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          '<img src="https://example.com/gallery-one.jpg" alt="Gallery one" style="width:30%">',
          '<img src="https://example.com/gallery-two.jpg" alt="Gallery two" onerror="alert(1)">',
          '<img src="https://example.com/gallery-three.jpg" alt="Gallery three">',
        ].join("\n")}
      />,
    );

    const gallery = container.querySelector('figure[aria-label="Image gallery"]');
    expect(gallery).toBeInTheDocument();
    expect(gallery).toHaveClass("grid", "grid-cols-2", "sm:grid-cols-3");
    expect(within(gallery as HTMLElement).getAllByRole("button", { name: /view gallery/i })).toHaveLength(3);
    expect(screen.getByAltText("Gallery one").getAttribute("style")).not.toContain("width");
    expect(screen.getByAltText("Gallery two")).not.toHaveAttribute("onerror");
    expect(gallery?.parentElement?.tagName).not.toBe("P");
  });

  it("converts an image-only HTML flex wrapper into the safe gallery layout", () => {
    const { container } = render(
      <MarkdownContent
        content={'<div style="display:flex;gap:12px"><img src="https://example.com/left.jpg" alt="Left image"><img src="https://example.com/right.jpg" alt="Right image"></div>'}
      />,
    );

    const gallery = container.querySelector('figure[aria-label="Image gallery"]');
    expect(gallery).toBeInTheDocument();
    expect(within(gallery as HTMLElement).getByAltText("Left image")).toBeInTheDocument();
    expect(within(gallery as HTMLElement).getByAltText("Right image")).toBeInTheDocument();
    expect(container.querySelector('[style*="display:flex"]')).not.toBeInTheDocument();
  });

  it("renders sanitized HTML picture source sets with a direct image fallback", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "<picture>",
          '  <source media="(max-width: 640px)" srcset="https://example.com/small.webp 1x, https://example.com/small@2x.webp 2x" type="image/webp">',
          '  <source srcset="https://example.com/wide.jpg 1024w" type="image/jpeg">',
          '  <img src="https://example.com/fallback.jpg" alt="Responsive preview" title="Responsive image" onerror="alert(1)">',
          "</picture>",
        ].join("\n")}
      />,
    );

    const picture = container.querySelector("picture");
    const sources = container.querySelectorAll("picture > source");
    const image = screen.getByAltText("Responsive preview");
    expect(picture).toBeInTheDocument();
    expect(sources).toHaveLength(2);
    expect(sources[0]).toHaveAttribute("media", "(max-width: 640px)");
    expect(sources[0]).toHaveAttribute("srcset", "https://example.com/small.webp 1x, https://example.com/small@2x.webp 2x");
    expect(sources[1]).toHaveAttribute("srcset", "https://example.com/wide.jpg 1024w");
    expect(image.parentElement).toBe(picture);
    expect(image).not.toHaveAttribute("onerror");
    expect(screen.queryByRole("button", { name: /view responsive preview/i })).not.toBeInTheDocument();
  });

  it("drops unsafe picture source sets while retaining the safe fallback", () => {
    const { container } = render(
      <MarkdownContent
        content={'<picture><source srcset="javascript:alert(1) 1x" type="image/webp"><img src="https://example.com/fallback.jpg" alt="Safe fallback"></picture>'}
      />,
    );

    expect(container.querySelector("picture > source")).not.toBeInTheDocument();
    expect(screen.getByAltText("Safe fallback")).toBeInTheDocument();
  });

  it("waits for streamed picture markup to close", () => {
    const complete = '<picture><source srcset="https://example.com/small.webp 1x" type="image/webp"><img src="https://example.com/fallback.jpg" alt="Streamed picture"></picture>';
    const { container, rerender } = render(
      <MarkdownContent content={complete.slice(0, -10)} isStreaming />,
    );
    expect(container.querySelector("picture")).not.toBeInTheDocument();

    rerender(<MarkdownContent content={complete} isStreaming />);
    expect(container.querySelector("picture")).toBeInTheDocument();
    expect(screen.getByAltText("Streamed picture")).toBeInTheDocument();
  });

  it("renders a semantic HTML figure with a formatted caption", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "<figure>",
          '  <img src="https://example.com/figure.jpg" alt="System architecture">',
          '  <figcaption>A <strong>generated</strong> architecture <a href="https://example.com/details">diagram</a>.</figcaption>',
          "</figure>",
        ].join("\n")}
      />,
    );

    const figure = container.querySelector("figure");
    const caption = container.querySelector("figcaption");
    const image = screen.getByAltText("System architecture");
    expect(figure).toBeInTheDocument();
    expect(image.closest("figure")).toBe(figure);
    expect(caption).toHaveTextContent("A generated architecture diagram.");
    expect(within(caption as HTMLElement).getByText("generated").tagName).toBe("STRONG");
    expect(within(caption as HTMLElement).getByRole("link", { name: "diagram" })).toHaveAttribute("href", "https://example.com/details");
    expect(figure?.parentElement?.tagName).not.toBe("P");
  });

  it("restricts figure HTML to supported media and caption content", () => {
    const { container } = render(
      <MarkdownContent
        content={'<figure><h2>Injected heading</h2><script>alert(1)</script><iframe src="https://example.com"></iframe><img src="https://example.com/safe.jpg" alt="Safe figure"><figcaption>Safe <strong>caption</strong><img src="https://example.com/tracker.jpg" alt="Tracker"></figcaption></figure>'}
      />,
    );

    expect(screen.getByAltText("Safe figure")).toBeInTheDocument();
    expect(container.querySelector("figcaption")).toHaveTextContent("Safe caption");
    expect(screen.queryByRole("heading", { name: "Injected heading" })).not.toBeInTheDocument();
    expect(screen.queryByAltText("Tracker")).not.toBeInTheDocument();
    expect(container.querySelector("script, iframe")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("alert(1)");
  });

  it("waits for streamed figure markup to close", () => {
    const complete = '<figure><img src="https://example.com/streamed-figure.jpg" alt="Streamed figure"><figcaption>Complete caption</figcaption></figure>';
    const { container, rerender } = render(
      <MarkdownContent content={complete.slice(0, -9)} isStreaming />,
    );
    expect(container.querySelector("figure")).not.toBeInTheDocument();
    expect(screen.queryByAltText("Streamed figure")).not.toBeInTheDocument();

    rerender(<MarkdownContent content={complete} isStreaming />);
    expect(container.querySelector("figure")).toBeInTheDocument();
    expect(screen.getByAltText("Streamed figure")).toBeInTheDocument();
    expect(container.querySelector("figcaption")).toHaveTextContent("Complete caption");
  });

  it("renders a sanitized native progress element", () => {
    const { container } = render(
      <MarkdownContent content={'<progress value="70" max="100" style="display:none" onclick="alert(1)">70%</progress>'} />,
    );

    const progress = screen.getByRole("progressbar", { name: "70% complete" });
    expect(progress).toHaveAttribute("value", "70");
    expect(progress).toHaveAttribute("max", "100");
    expect(progress).not.toHaveAttribute("style");
    expect(progress).not.toHaveAttribute("onclick");
    expect(container).toHaveTextContent("70%");
  });

  it("renders a native meter with validated color-zone thresholds", () => {
    const { container } = render(
      <MarkdownContent content={'<meter value="0.6" min="0" max="1" low="0.3" high="0.8" optimum="0.9" onmouseover="alert(1)"><strong>60%</strong></meter>'} />,
    );

    const meter = container.querySelector("meter");
    expect(meter).toHaveAttribute("value", "0.6");
    expect(meter).toHaveAttribute("min", "0");
    expect(meter).toHaveAttribute("max", "1");
    expect(meter).toHaveAttribute("low", "0.3");
    expect(meter).toHaveAttribute("high", "0.8");
    expect(meter).toHaveAttribute("optimum", "0.9");
    expect(meter).toHaveAccessibleName("60%");
    expect(meter).not.toHaveAttribute("onmouseover");
    expect(within(meter as HTMLElement).getByText("60%").tagName).toBe("STRONG");
  });

  it("waits for streamed progress markup to close", () => {
    const complete = '<progress value="45" max="100">45%</progress>';
    const incomplete = complete.slice(0, -11);
    const { container, rerender } = render(
      <MarkdownContent content={incomplete} isStreaming />,
    );
    expect(container.querySelector("progress")).not.toBeInTheDocument();
    expect(container.textContent).toBe(incomplete);

    rerender(<MarkdownContent content={complete} isStreaming />);
    expect(screen.getByRole("progressbar", { name: "45% complete" })).toBeInTheDocument();
  });

  it("renders presentation-only inline SVG responsively", () => {
    const { container } = render(
      <MarkdownContent
        content={[
          '<svg viewBox="0 0 240 100" width="720" height="300" aria-label="Inline status diagram" onload="alert(1)" style="display:none">',
          '  <rect x="2" y="2" width="236" height="96" rx="12" fill="#141416" stroke="#63e452" stroke-width="4" />',
          '  <circle cx="42" cy="50" r="18" fill="currentColor" />',
          '  <path d="M70 50 H120" stroke="#fafafa" stroke-width="3" />',
          '  <text x="132" y="56" fill="#fafafa" font-size="18">Ready</text>',
          "</svg>",
        ].join("\n")}
      />,
    );

    const svg = screen.getByRole("img", { name: "Inline status diagram" });
    expect(svg).toHaveClass("h-auto", "max-h-[320px]", "max-w-full");
    expect(svg).toHaveAttribute("viewBox", "0 0 240 100");
    expect(svg).not.toHaveAttribute("onload");
    expect(svg).not.toHaveAttribute("style");
    expect(container.querySelector("rect")).toHaveAttribute("stroke", "#63e452");
    expect(container.querySelector("text")).toHaveTextContent("Ready");
  });

  it("strips unsafe SVG attributes and paint references", () => {
    const { container } = render(
      <MarkdownContent
        content={'<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="url(javascript:alert(1))" stroke="#fff" onclick="alert(2)" /></svg>'}
      />,
    );

    const svg = screen.getByRole("img", { name: "Inline SVG" });
    const rect = container.querySelector("rect");
    expect(svg).toBeInTheDocument();
    expect(rect).not.toHaveAttribute("fill");
    expect(rect).not.toHaveAttribute("onclick");
    expect(rect).toHaveAttribute("stroke", "#fff");
  });

  it("removes executable and resource-bearing SVG elements", () => {
    const { container, rerender } = render(
      <MarkdownContent content={'<svg viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10" /></svg>'} />,
    );
    expect(screen.getByRole("img", { name: "Inline SVG" })).toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("alert(1)");

    rerender(
      <MarkdownContent content={'<svg viewBox="0 0 10 10"><image href="https://example.com/tracker.png" width="10" height="10" /></svg>'} />,
    );
    expect(screen.getByRole("img", { name: "Inline SVG" })).toBeInTheDocument();
    expect(container.querySelector("image")).not.toBeInTheDocument();
  });

  it("waits for streamed inline SVG to close and preserves fenced SVG as code", () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>';
    const { container, rerender } = render(
      <MarkdownContent content={'<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" />'} isStreaming />,
    );
    expect(container.querySelector("svg")).not.toBeInTheDocument();

    rerender(<MarkdownContent content={svg} isStreaming />);
    expect(screen.getByRole("img", { name: "Inline SVG" })).toBeInTheDocument();

    rerender(<MarkdownContent content={["```html", svg, "```"].join("\n")} />);
    expect(screen.queryByRole("img", { name: "Inline SVG" })).not.toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent("<svg");
  });

  it.each([
    "Promise<T>",
    "git checkout <branch>",
    "x<y>z",
    "<widget>literal</widget>",
    "Never use <script> in chat.",
  ])("renders unsupported or unmatched angle-bracket prose literally: %s", (content) => {
    const { container, rerender } = render(<MarkdownContent content={content} isStreaming />);

    expect(container.textContent).toBe(content);
    expect(container.querySelector("script")).not.toBeInTheDocument();

    rerender(<MarkdownContent content={content} />);
    expect(container.textContent).toBe(content);
    expect(container.querySelector("script")).not.toBeInTheDocument();
  });

  it("renders unsupported HTML literally while blocking complete active content", () => {
    const { container } = render(
      <MarkdownContent content={'<h2>Raw heading</h2>\n\n**Markdown survives**\n\n<script>alert("x")</script>\n\n<iframe src="https://example.com"></iframe>'} />,
    );

    expect(screen.queryByRole("heading", { name: "Raw heading" })).not.toBeInTheDocument();
    expect(container).toHaveTextContent("<h2>Raw heading</h2>");
    expect(screen.getByText("Markdown survives")).toHaveClass("font-semibold");
    expect(screen.queryByText(/alert\("x"\)/i)).not.toBeInTheDocument();
    expect(document.querySelector("iframe")).not.toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Embedded frame blocked" })).toHaveTextContent(
      "Iframes can load untrusted pages and run active content, so they are not displayed in chat.",
    );
  });

  it("replaces a complete OpenClaw data HTML embed with a security notice", () => {
    const html = '<html><head><style>body{font-family:Arial;background:#1a1a2e;color:#fff}</style></head><body><h1>Embedded Content</h1></body></html>';
    render(
      <MarkdownContent content={`[embed url="data:text/html,${html}" title="Test Embed" height="200" /]`} />,
    );

    expect(document.querySelector("iframe")).not.toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Embedded frame blocked" })).toHaveTextContent(
      "Test Embed was not displayed.",
    );
  });

  it("replaces object embeds with a security notice and inert fallback text", () => {
    const { container } = render(
      <MarkdownContent
        content={'<object data="https://example.com/document.pdf" type="application/pdf"><p>PDF preview unavailable. <strong>Download manually.</strong></p><script>alert(1)</script></object>'}
      />,
    );

    const notice = screen.getByRole("note", { name: "Embedded object blocked" });
    expect(notice).toHaveTextContent("Object embeds can load untrusted external content or legacy plugins");
    expect(notice).toHaveTextContent("Fallback: PDF preview unavailable. Download manually.");
    expect(container.querySelector("object, script")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("alert(1)");
  });

  it("replaces script-driven canvas content without executing or displaying its script", () => {
    const { container } = render(
      <MarkdownContent
        content={'<canvas id="chart" width="600" height="240">Canvas preview unavailable.</canvas><script>document.body.dataset.executed = "true";</script>'}
      />,
    );

    const notice = screen.getByRole("note", { name: "Interactive canvas blocked" });
    expect(notice).toHaveTextContent("Script-driven canvases require executable content");
    expect(notice).toHaveTextContent("Fallback: Canvas preview unavailable.");
    expect(container.querySelector("canvas, script")).not.toBeInTheDocument();
    expect(container).not.toHaveTextContent("document.body");
    expect(document.body).not.toHaveAttribute("data-executed");
  });

  it("replaces legacy embed tags with a security notice", () => {
    const { container } = render(
      <MarkdownContent content={'<embed src="https://example.com/legacy.swf" type="application/x-shockwave-flash">'} />,
    );

    expect(screen.getByRole("note", { name: "Legacy embed blocked" })).toHaveTextContent(
      "Embed tags can load untrusted external content or legacy plugins",
    );
    expect(container.querySelector("embed")).not.toBeInTheDocument();
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
    expect(document.querySelector("iframe")).not.toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Embedded frame blocked" })).toBeInTheDocument();
  });

  it("does not interpret embed directives inside fenced code", () => {
    const directive = '[embed url="data:text/html,<h1>Code</h1>" title="Code Embed" height="200" /]';
    const { container } = render(<MarkdownContent content={["```text", directive, "```"].join("\n")} />);

    expect(screen.queryByTitle("Code Embed")).not.toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "Embedded frame blocked" })).not.toBeInTheDocument();
    expect(container.querySelector("pre code")).toHaveTextContent(directive);
  });

  it("renders sanitized HTML audio with the chat player", () => {
    const { container } = render(
      <MarkdownContent
        content={'<audio controls autoplay onplay="alert(1)" src="https://cdn.example.test/voice/reply.mp3" title="TTS reply"></audio>'}
      />,
    );

    expect(screen.getByRole("button", { name: "Play TTS reply" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download TTS reply" })).toHaveAttribute("href", "https://cdn.example.test/voice/reply.mp3");
    const audio = container.querySelector("audio");
    expect(audio).toHaveAttribute("src", "https://cdn.example.test/voice/reply.mp3");
    expect(audio).not.toHaveAttribute("controls");
    expect(audio).not.toHaveAttribute("autoplay");
    expect(audio).not.toHaveAttribute("onplay");
  });

  it("renders base64 TTS sources nested in HTML audio", () => {
    const { container } = render(
      <MarkdownContent
        content={'<audio title="Generated speech"><source src="data:audio/mpeg;base64,AAAA" type="audio/mpeg"></audio>'}
      />,
    );

    expect(screen.getByRole("button", { name: "Play Generated speech" })).toBeInTheDocument();
    expect(container.querySelector("audio source")).toHaveAttribute("src", "data:audio/mpeg;base64,AAAA");
    expect(container.querySelector("audio source")).toHaveAttribute("type", "audio/mpeg");
  });

  it("rejects unsafe HTML audio sources", () => {
    const { container } = render(
      <MarkdownContent content={'<audio title="Unsafe"><source src="javascript:alert(1)" type="audio/mpeg"></audio>'} />,
    );

    expect(screen.getByText("Audio unavailable")).toBeInTheDocument();
    expect(container.querySelector("audio")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download unsafe/i })).not.toBeInTheDocument();
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

  it("keeps incomplete keyboard markup literal until the closing tag arrives", () => {
    const { container, rerender } = render(<MarkdownContent content="Press <kbd>Ctrl" isStreaming />);
    expect(container.querySelector("kbd")).not.toBeInTheDocument();
    expect(container.textContent).toBe("Press <kbd>Ctrl");

    rerender(<MarkdownContent content="Press <kbd>Ctrl</kbd> + <kbd>C</kbd>" isStreaming />);
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

  it("renders footnotes and abbreviations while keeping shortcodes literal and native emoji intact", async () => {
    const { container } = render(
      <MarkdownContent
        content={[
          "The HTML parser ships with footnotes[^1] :rocket:. Native 🚀 stays.",
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
    expect(screen.getByText(/:rocket:/)).toBeInTheDocument();
    expect(screen.getByText(/Native 🚀 stays/)).toBeInTheDocument();
    expect(screen.getByText("Footnote detail.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1" })).toHaveAttribute("href", "#user-content-fn-1");
  });

  it("preserves colon-delimited prose that resembles emoji shortcodes", () => {
    const content = "Status:warning: and 1:100:";
    const { container, rerender } = render(<MarkdownContent content={content} isStreaming />);

    expect(container.textContent).toBe(content);

    rerender(<MarkdownContent content={content} />);
    expect(container.textContent).toBe(content);
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
