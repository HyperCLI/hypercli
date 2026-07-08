import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithClient } from "@/test/utils";
import { SharedKnowledgePanel, type SharedKnowledgeAgent } from "./SharedKnowledgePanel";

const agents: SharedKnowledgeAgent[] = [
  { id: "agent-docs", name: "Docs Agent", pod_name: "docs-agent", state: "RUNNING", meta: null },
  { id: "agent-brand", name: "Brand Agent", pod_name: "brand-agent", state: "STOPPED", meta: null },
  { id: "agent-ops", name: "Ops Agent", pod_name: "ops-agent", state: "RUNNING", meta: null },
];

function renderSharedKnowledgePanel() {
  renderWithClient(<SharedKnowledgePanel agents={agents} />);
}

describe("SharedKnowledgePanel", () => {
  it("renders knowledge bases with the first card expanded", () => {
    renderSharedKnowledgePanel();

    expect(screen.getByRole("heading", { name: "Shared Knowledge" })).toBeInTheDocument();
    expect(screen.getByText("Product Documentation")).toBeInTheDocument();
    expect(screen.getByText("Brand Assets")).toBeInTheDocument();
    expect(screen.getByText("Contents")).toBeInTheDocument();
    expect(screen.getByText("PRD - Agent Workspaces")).toBeInTheDocument();
    expect(screen.getByText("Assigned Agents")).toBeInTheDocument();
    expect(screen.getByText("Docs Agent")).toBeInTheDocument();
  });

  it("filters bases and expands nested folders", () => {
    renderSharedKnowledgePanel();

    fireEvent.change(screen.getByPlaceholderText(/search knowledge bases/i), { target: { value: "api" } });

    expect(screen.getByText("API Documentation")).toBeInTheDocument();
    expect(screen.queryByText("Brand Assets")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open/i }));
    fireEvent.click(screen.getByText("Integration Guides"));

    expect(screen.getByText("GitHub OAuth.md")).toBeInTheDocument();
    expect(screen.getByText("Webhook Events.md")).toBeInTheDocument();
  });

  it("opens the new knowledge base modal and creates a local base", () => {
    renderSharedKnowledgePanel();

    fireEvent.click(screen.getByRole("button", { name: /new knowledge base/i }));
    expect(screen.getByRole("dialog", { name: /new knowledge base/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /docs agent/i }).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText(/product documentation/i), { target: { value: "Support Docs" } });
    fireEvent.change(screen.getByPlaceholderText(/what knowledge will this base contain/i), { target: { value: "Customer support procedures." } });
    fireEvent.click(screen.getByRole("button", { name: /create knowledge base/i }));

    expect(screen.queryByRole("dialog", { name: /new knowledge base/i })).not.toBeInTheDocument();
    expect(screen.getByText("Support Docs")).toBeInTheDocument();
    expect(screen.getByText("Customer support procedures.")).toBeInTheDocument();
    expect(screen.getByText(/no files yet/i)).toBeInTheDocument();
  });

  it("lists available agents and toggles local assignments", () => {
    renderSharedKnowledgePanel();

    const productCard = screen.getByText("Product Documentation").closest("article");
    expect(productCard).toBeInstanceOf(HTMLElement);
    const product = within(productCard as HTMLElement);

    expect(product.getByText("2 agents")).toBeInTheDocument();
    fireEvent.click(product.getByRole("button", { name: /assign agent/i }));

    expect(product.getByRole("button", { name: /ops agent/i })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(product.getByRole("button", { name: /ops agent/i }));

    expect(product.getByText("3 agents")).toBeInTheDocument();
    expect(product.getByRole("button", { name: /ops agent/i })).toHaveAttribute("aria-pressed", "true");
  });
});
