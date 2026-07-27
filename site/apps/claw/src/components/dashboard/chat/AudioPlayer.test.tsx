import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AudioPlayer } from "./AudioPlayer";

describe("AudioPlayer", () => {
  it("does not expose unsafe playback or download urls", () => {
    const { container } = render(
      <AudioPlayer
        src="javascript:play.mp3"
        title="Unsafe audio"
        downloadHref="javascript:download.mp3"
      />,
    );

    expect(screen.getByText("Audio unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Unsafe audio" })).toBeDisabled();
    expect(container.querySelector("audio")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download unsafe audio/i })).not.toBeInTheDocument();
  });

  it("marks a source unavailable when native media loading fails", () => {
    const { container } = render(
      <AudioPlayer src="https://cdn.example.test/missing.mp3" title="Missing audio" />,
    );

    fireEvent.error(container.querySelector("audio")!);

    expect(screen.getByText("Audio unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Missing audio" })).toBeDisabled();
  });
});
