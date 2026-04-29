import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, type RenderHookOptions, type RenderOptions } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { expect } from "vitest";

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
