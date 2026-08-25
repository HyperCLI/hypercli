import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentsPageLoadingShell } from "./AgentsPageLoadingShell";

const pageSource = readFileSync(resolve(process.cwd(), "src/app/dashboard/agents/page.tsx"), "utf8");
const globalCss = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

describe("AgentsPageLoadingShell", () => {
  it("renders a privacy-neutral dashboard frame while the client route starts", () => {
    const { container } = render(<AgentsPageLoadingShell />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading agent workspace");
    expect(screen.getByTestId("agents-page-loading-shell")).toHaveClass("bg-background");
    expect(screen.getByText("Agents")).toBeInTheDocument();
    expect(screen.getByText("Launch agent")).toBeInTheDocument();
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(container.querySelector(".agents-page-loading-desktop")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".agents-page-loading-mobile")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector('[data-slot="loading-navigation"]')).toHaveClass("w-64", "pt-14");
    expect(container.querySelector('[data-slot="loading-navigation-header"]')).toHaveClass("h-14", "pl-4", "pr-3");
    expect(container.querySelector('[data-slot="loading-roster"]')).toHaveClass("w-52");
    expect(container.querySelector('[data-slot="loading-workspace"]')).toHaveClass("w-12");
    expect(container.querySelectorAll('[data-slot="loading-agent-row"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-slot="loading-workspace-control"]')).toHaveLength(7);
    expect(container.querySelector('[data-slot="loading-account"]')).toHaveClass("px-3", "py-2");
    expect(container.querySelector(".agents-page-loading-mobile header")).toHaveClass(
      "h-[calc(3.5rem+env(safe-area-inset-top))]",
      "pt-[env(safe-area-inset-top)]",
    );
    expect(container.querySelector('[data-slot="loading-mobile-logo"]')).toHaveClass("h-10", "w-8");
    expect(container.querySelector('[data-slot="loading-mobile-menu"]')).toHaveClass("h-11", "w-11");
    expect(document.querySelector(".animate-shimmer, .animate-spin")).not.toBeInTheDocument();
  });

  it("stays wired to the route boundary with the dashboard viewport breakpoint", () => {
    expect(pageSource).toContain(
      'import { AgentsPageLoadingShell } from "@/components/dashboard/agents/AgentsPageLoadingShell";',
    );
    expect(pageSource).toContain("<React.Suspense fallback={<AgentsPageLoadingShell />}>");
    expect(globalCss).toContain(
      "@media (min-width: 64rem), (min-width: 48rem) and (min-height: 31.25rem)",
    );
  });
});
