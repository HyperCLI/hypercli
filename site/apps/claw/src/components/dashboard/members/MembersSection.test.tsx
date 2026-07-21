import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    isLoading: false,
    user: {
      id: "user-1",
      email: "jane@example.com",
      fullName: "Jane Rivera",
    } as {
      id: string;
      email?: string;
      fullName?: string;
    } | null,
  },
}));

vi.mock("@/hooks/useAgentAuth", () => ({
  useAgentAuth: () => mocks.auth,
}));

import { MembersSection } from "./MembersSection";

describe("MembersSection", () => {
  beforeEach(() => {
    mocks.auth.isLoading = false;
    mocks.auth.user = {
      id: "user-1",
      email: "jane@example.com",
      fullName: "Jane Rivera",
    };
  });

  it("shows the authenticated account without unsupported member actions", () => {
    render(<MembersSection />);

    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Visible workspace accounts" })).toBeInTheDocument();
    expect(screen.getByText("Jane Rivera")).toBeInTheDocument();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invite member/i })).not.toBeInTheDocument();
    expect(screen.getByText(/this is not a complete member directory/i)).toBeInTheDocument();
    expect(screen.getByText(/no presence data for other people/i)).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("filters the visible account by name or email", () => {
    render(<MembersSection />);

    const search = screen.getByRole("searchbox", { name: "Search members" });
    fireEvent.change(search, { target: { value: "someone else" } });
    expect(screen.getByText("No accounts found")).toBeInTheDocument();
    expect(screen.queryByText("Jane Rivera")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "example.com" } });
    expect(screen.getByText("Jane Rivera")).toBeInTheDocument();
  });

  it("renders the authenticated account in the compact dashboard panel", () => {
    render(<MembersSection compact />);

    expect(screen.getByRole("heading", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/dashboard/agents?section=members");
    expect(screen.getByText("Jane Rivera")).toBeInTheDocument();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invite member/i })).not.toBeInTheDocument();
  });

  it("renders loading and unavailable account states", () => {
    mocks.auth.isLoading = true;
    const { rerender } = render(<MembersSection />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading account identity");

    mocks.auth.isLoading = false;
    mocks.auth.user = null;
    rerender(<MembersSection />);
    expect(screen.getByRole("status")).toHaveTextContent("Account details are unavailable");
  });
});
