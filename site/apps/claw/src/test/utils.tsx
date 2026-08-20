import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, type RenderHookOptions, type RenderOptions } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { expect } from "vitest";
import { Deployments } from "@hypercli.com/sdk/agents";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function renderWithClient(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & {
    queryClient?: QueryClient;
    provider?: ComponentType<{ children: ReactNode }>;
  },
) {
  const { queryClient: providedClient, provider: ExtraProvider, ...renderOptions } = options ?? {};
  const queryClient = providedClient ?? createTestQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {ExtraProvider ? <ExtraProvider>{children}</ExtraProvider> : children}
    </QueryClientProvider>
  );

  return {
    queryClient,
    ...render(ui, { ...renderOptions, wrapper: Wrapper }),
  };
}

export function renderHookWithClient<Result, Props>(
  callback: (initialProps: Props) => Result,
  options?: Omit<RenderHookOptions<Props>, "wrapper"> & {
    queryClient?: QueryClient;
    provider?: ComponentType<{ children: ReactNode }>;
  },
) {
  const { queryClient: providedClient, provider: ExtraProvider, ...renderOptions } = options ?? {};
  const queryClient = providedClient ?? createTestQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {ExtraProvider ? <ExtraProvider>{children}</ExtraProvider> : children}
    </QueryClientProvider>
  );

  return {
    queryClient,
    ...renderHook(callback, { ...renderOptions, wrapper: Wrapper }),
  };
}

export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe(container);
  expect(results.violations).toEqual([]);
}

/**
 * A Deployments whose transport is mocked but whose logs primitive is real.
 *
 * `useAgentLogs` no longer parses frames itself -- it subscribes through
 * `Deployments.subscribeLogs`, which owns the wire contract. Stubbing only the
 * transport (`logsConnect`) keeps log tests exercising the same framing code the
 * app runs, so a wire change cannot pass here and still break the panel.
 */
export function mockDeployments(partial: Record<string, unknown>): Deployments {
  return Object.assign(Object.create(Deployments.prototype), partial) as Deployments;
}
