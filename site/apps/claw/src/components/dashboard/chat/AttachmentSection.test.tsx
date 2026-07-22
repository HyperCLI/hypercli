import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AttachmentSection } from "./AttachmentSection";

describe("AttachmentSection", () => {
  it("renders local media handles as unavailable without leaking the handle", () => {
    render(
      <AttachmentSection
        mediaUrls={["media://inbound/generated---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.png"]}
      />,
    );

    expect(screen.getByRole("status", { name: /media preview unavailable/i })).toBeInTheDocument();
    expect(screen.queryByText(/media:\/\/inbound/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view generated/i })).not.toBeInTheDocument();
  });

  it("renders workspace media urls as file chips without leaking runtime paths", () => {
    render(
      <AttachmentSection
        mediaUrls={["MEDIA:/home/node/.openclaw/workspace/865621.jpg"]}
      />,
    );

    expect(screen.getByText("865621.jpg")).toBeInTheDocument();
    expect(screen.queryByText(/\/home\/node\/\.openclaw\/workspace/i)).not.toBeInTheDocument();
  });

  it("renders ICS media handles as file chips instead of unavailable previews", () => {
    render(
      <AttachmentSection
        mediaUrls={["media://inbound/placeholder-calendar---741bc582-9e41-492d-9a13-d8ecd3a2e0b8.ics"]}
      />,
    );

    expect(screen.getByText("placeholder-calendar.ics")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /media preview unavailable/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/media:\/\/inbound/i)).not.toBeInTheDocument();
  });
});
