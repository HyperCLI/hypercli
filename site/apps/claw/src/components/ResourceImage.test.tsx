import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResourceImage } from "./ResourceImage";

describe("ResourceImage", () => {
  it("shows a loading element until the image loads", async () => {
    render(
      <ResourceImage
        src="data:image/png;base64,abc"
        alt="attachment preview"
        width={64}
        height={64}
      />,
    );

    expect(screen.getByRole("status", { name: /loading image/i })).toBeInTheDocument();

    await act(async () => {
      fireEvent.load(screen.getByAltText("attachment preview"));
    });

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: /loading image/i })).not.toBeInTheDocument();
    });
  });

  it("shows an unavailable state when the image fails", async () => {
    render(
      <ResourceImage
        src="data:image/png;base64,abc"
        alt="attachment preview"
        width={64}
        height={64}
      />,
    );

    await act(async () => {
      fireEvent.error(screen.getByAltText("attachment preview"));
    });

    expect(screen.getByRole("status", { name: /image unavailable/i })).toBeInTheDocument();
  });
});
