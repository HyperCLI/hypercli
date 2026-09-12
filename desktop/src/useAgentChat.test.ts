import { describe, expect, it } from "vitest";
import { runtimeReadAloudDelta } from "./useAgentChat";

describe("runtimeReadAloudDelta", () => {
  it("speaks appended runtime content", () => {
    expect(runtimeReadAloudDelta("Hello", " world", false)).toEqual({
      next: "Hello world",
      replacePending: false,
      speak: " world",
    });
  });

  it("speaks only the suffix for cumulative replacement content", () => {
    expect(runtimeReadAloudDelta("Hello", "Hello world", true)).toEqual({
      next: "Hello world",
      replacePending: false,
      speak: " world",
    });
  });

  it("does not restart audio for non-prefix replacement snapshots", () => {
    expect(runtimeReadAloudDelta("Hello world", "Hello, world.", true)).toEqual({
      next: "Hello, world.",
      replacePending: true,
      speak: "",
    });
  });
});
