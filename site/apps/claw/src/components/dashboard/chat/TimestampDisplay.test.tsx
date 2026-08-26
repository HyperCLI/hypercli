import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { expectNoA11yViolations } from "@/test/utils";
import { TimestampDisplay } from "./TimestampDisplay";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-color-mode");
});

describe("TimestampDisplay", () => {
  it.each([
    ["aurora-light", "light"],
    ["aurora-dark", "dark"],
  ] as const)("uses accessible metadata contrast in the %s theme", async (theme, mode) => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-color-mode", mode);

    const { container } = render(
      <>
        <TimestampDisplay timestamp={1_700_000_000_000} variant="v2" placement="inside" isUser={false} />
        <TimestampDisplay timestamp={1_700_000_000_000} variant="v2" placement="inside" isUser />
      </>,
    );

    const timestamps = Array.from(container.children);
    expect(timestamps).toHaveLength(2);
    for (const timestamp of timestamps) {
      expect(timestamp).toHaveClass("text-text-secondary");
      expect(timestamp).not.toHaveClass("text-text-muted/50");
    }
    await expectNoA11yViolations(container);
  });
});
