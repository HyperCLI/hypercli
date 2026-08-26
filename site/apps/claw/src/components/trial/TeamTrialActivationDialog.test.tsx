import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamTrialActivationDialog } from "./TeamTrialActivationDialog";

const mocks = vi.hoisted(() => ({
  reducedMotion: false,
}));

vi.mock("framer-motion", () => ({
  useReducedMotion: () => mocks.reducedMotion,
}));

vi.mock("@hypercli/shared-ui", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("@hypercli/shared-ui")>();

  function Carousel({
    children,
    setApi,
    opts: _opts,
    ...props
  }: {
    children: ReactNode;
    setApi?: (api: {
      selectedScrollSnap: () => number;
      scrollNext: () => void;
      scrollTo: (index: number) => void;
      on: (event: "select" | "reInit", listener: () => void) => void;
      off: (event: "select" | "reInit", listener: () => void) => void;
    }) => void;
  } & Record<string, unknown>) {
    const api = React.useMemo(() => {
      let selectedIndex = 0;
      const listeners = new Map<string, Set<() => void>>();
      const notify = (event: string) => listeners.get(event)?.forEach((listener) => listener());
      return {
        selectedScrollSnap: () => selectedIndex,
        scrollNext: () => {
          selectedIndex = (selectedIndex + 1) % 6;
          notify("select");
        },
        scrollTo: (index: number) => {
          selectedIndex = index;
          notify("select");
        },
        on: (event: "select" | "reInit", listener: () => void) => {
          const eventListeners = listeners.get(event) ?? new Set();
          eventListeners.add(listener);
          listeners.set(event, eventListeners);
        },
        off: (event: "select" | "reInit", listener: () => void) => {
          listeners.get(event)?.delete(listener);
        },
      };
    }, []);

    React.useEffect(() => {
      setApi?.(api);
    }, [api, setApi]);

    return <div {...props}>{children}</div>;
  }

  return {
    ...actual,
    Carousel,
    CarouselContent: ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
    CarouselItem: ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
  };
});

describe("TeamTrialActivationDialog", () => {
  beforeEach(() => {
    mocks.reducedMotion = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("presents the trial benefits and confirms activation", () => {
    const onStartTrial = vi.fn();
    render(
      <TeamTrialActivationDialog
        open
        onOpenChange={vi.fn()}
        onStartTrial={onStartTrial}
      />,
    );

    expect(screen.getByRole("heading", { name: "Unlock the full HyperCLI experience" })).toBeVisible();
    expect(screen.getAllByRole("img")).toHaveLength(6);
    expect(screen.getByText("Your trial starts today")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Start 7-day free trial" }));
    expect(onStartTrial).toHaveBeenCalledOnce();
  });

  it("advances automatically and supports manual pagination", () => {
    vi.useFakeTimers();
    render(
      <TeamTrialActivationDialog
        open
        onOpenChange={vi.fn()}
        onStartTrial={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Show feature 1" })).toHaveAttribute("aria-current", "step");
    act(() => vi.advanceTimersByTime(4_500));
    expect(screen.getByRole("button", { name: "Show feature 2" })).toHaveAttribute("aria-current", "step");

    fireEvent.click(screen.getByRole("button", { name: "Show feature 5" }));
    expect(screen.getByRole("button", { name: "Show feature 5" })).toHaveAttribute("aria-current", "step");
  });

  it("does not auto-advance when reduced motion is requested", () => {
    mocks.reducedMotion = true;
    vi.useFakeTimers();
    render(
      <TeamTrialActivationDialog
        open
        onOpenChange={vi.fn()}
        onStartTrial={vi.fn()}
      />,
    );

    act(() => vi.advanceTimersByTime(9_000));
    expect(screen.getByRole("button", { name: "Show feature 1" })).toHaveAttribute("aria-current", "step");
  });
});
