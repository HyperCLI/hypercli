import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EnvVarsSection from "./EnvVarsSection";

describe("EnvVarsSection", () => {
  it("masks every value by default and never leaks the real value or its length", () => {
    render(
      <EnvVarsSection
        envVars={{ API_KEY: "super-secret-token", DB_URL: "postgres://db:5432/app" }}
      />,
    );

    expect(screen.queryByText("super-secret-token")).not.toBeInTheDocument();
    expect(screen.queryByText("postgres://db:5432/app")).not.toBeInTheDocument();
    expect(screen.getAllByText("••••••••")).toHaveLength(2);
  });

  it("reveals only the clicked value when its eyeball is toggled", () => {
    render(
      <EnvVarsSection
        envVars={{ API_KEY: "super-secret-token", DB_URL: "postgres://db:5432/app" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show API_KEY" }));

    expect(screen.getByText("super-secret-token")).toBeInTheDocument();
    expect(screen.queryByText("postgres://db:5432/app")).not.toBeInTheDocument();
    expect(screen.getAllByText("••••••••")).toHaveLength(1);
  });

  it("re-masks the value when the eyeball is toggled again", () => {
    render(<EnvVarsSection envVars={{ API_KEY: "super-secret-token" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Show API_KEY" }));
    expect(screen.getByText("super-secret-token")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide API_KEY" }));
    expect(screen.queryByText("super-secret-token")).not.toBeInTheDocument();
    expect(screen.getByText("••••••••")).toBeInTheDocument();
  });

  it("shows an explicit empty state when no env vars are set", () => {
    render(<EnvVarsSection envVars={null} />);
    expect(screen.getByText("No environment variables set on this job.")).toBeInTheDocument();
  });
});
