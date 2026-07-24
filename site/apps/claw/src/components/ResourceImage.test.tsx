import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ComponentProps, type SyntheticEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ResourceImage } from "./ResourceImage";

type MockImageProps = ComponentProps<"img"> & {
  fill?: boolean;
  loader?: unknown;
  unoptimized?: boolean;
};

const nextImageMock = vi.hoisted(() => ({
  renders: [] as MockImageProps[],
}));

vi.mock("next/image", () => ({
  default: (props: MockImageProps) => {
    nextImageMock.renders.push(props);
    const { fill: _fill, loader: _loader, unoptimized: _unoptimized, ...imageProps } = props;
    return createElement("img", imageProps);
  },
}));

describe("ResourceImage", () => {
  beforeEach(() => {
    nextImageMock.renders.length = 0;
  });

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

  it("resets for a replacement source and ignores callbacks from the old source", async () => {
    const onLoad = vi.fn();
    const onError = vi.fn();
    const { rerender } = render(
      <ResourceImage src="https://example.com/a.png" alt="attachment preview" width={64} height={48} onLoad={onLoad} onError={onError} />,
    );
    const firstRender = nextImageMock.renders.at(-1)!;
    const staleLoad = firstRender.onLoad;
    const staleError = firstRender.onError;
    const original = screen.getByAltText("attachment preview");

    fireEvent.load(original);
    expect(screen.queryByRole("status", { name: /loading image/i })).not.toBeInTheDocument();

    rerender(
      <ResourceImage src="https://example.com/b.png" alt="attachment preview" width={64} height={48} onLoad={onLoad} onError={onError} />,
    );

    const replacement = screen.getByAltText("attachment preview");
    expect(replacement).not.toBe(original);
    expect(replacement).toHaveAttribute("src", "https://example.com/b.png");
    expect(replacement).toHaveAttribute("width", "64");
    expect(replacement).toHaveAttribute("height", "48");
    expect(screen.getByRole("status", { name: /loading image/i })).toBeInTheDocument();

    await act(async () => {
      staleLoad?.({} as SyntheticEvent<HTMLImageElement>);
      staleError?.({} as SyntheticEvent<HTMLImageElement>);
    });

    expect(screen.getByRole("status", { name: /loading image/i })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /image unavailable/i })).not.toBeInTheDocument();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    fireEvent.load(replacement);
    expect(screen.queryByRole("status", { name: /loading image/i })).not.toBeInTheDocument();
    expect(onLoad).toHaveBeenCalledTimes(2);
  });
});
