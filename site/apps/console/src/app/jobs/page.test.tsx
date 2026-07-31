import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JobsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@hypercli/shared-ui", () => ({
  Header: () => null,
  Footer: () => null,
  AlertDialog: () => null,
  RegionDisplay: ({ region }: { region: string }) => <span>{region}</span>,
  formatDateTime: (value: string) => value,
  getBadgeClass: () => "",
  getRegionName: (region: string) => region,
  getAuthBackendUrl: (path: string) => `https://api.test/api${path}`,
  getAuthCookieToken: () => "test-token",
}));

vi.mock("../../components/AmountDisplay", () => ({
  default: ({ amount }: { amount: number }) => <span>{amount}</span>,
}));

const makeJob = (id: string, hostname: string) => ({
  job_id: id,
  job_key: `${id}-key`,
  user_id: "user-1",
  hostname,
  state: "running",
  gpu_type: "L40S",
  gpu_count: 1,
  region: "kr",
  interruptible: true,
  price_per_hour: 1,
  price_per_second: 1 / 3600,
  docker_image: "example/image:latest",
  dockerfile: null,
  hf_space: null,
  command: [],
  env_vars: null,
  ports: null,
  memory_gb: 48,
  cpu_cores: 8,
  runtime: 3600,
  assigned_to: "instance-1",
  created_at: "2026-07-31T08:00:00Z",
  launch_by: "2026-07-31T08:05:00Z",
  expires: null,
  assigned_at: "2026-07-31T08:00:05Z",
  started_at: "2026-07-31T08:00:10Z",
  completed_at: null,
  completed: false,
});

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as Response;

describe("JobsPage live refresh", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts a stale request and refreshes immediately when the window regains focus", async () => {
    const freshJob = makeJob("fresh-job-123", "fresh.hypercli.com");
    let resolveInitial: ((value: Response) => void) | undefined;
    let initialSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        initialSignal = init.signal as AbortSignal;
        return new Promise<Response>((resolve) => {
          resolveInitial = resolve;
        });
      })
      .mockResolvedValueOnce(response({ jobs: [freshJob], total_count: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<JobsPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(await screen.findByText("fresh.hypercli.com")).toBeInTheDocument();
    expect(initialSignal?.aborted).toBe(true);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ cache: "no-store" });

    // Even a non-standard fetch implementation that resolves after abort must
    // not overwrite the newer response.
    await act(async () => {
      resolveInitial?.(response({ jobs: [], total_count: 0 }));
      await Promise.resolve();
    });
    expect(screen.getByText("fresh.hypercli.com")).toBeInTheDocument();
  });

  it("keeps the last good rows visible across a background 503 and recovers on focus", async () => {
    const existingJob = makeJob("existing-job-123", "existing.hypercli.com");
    const recoveredJob = makeJob("recovered-job-123", "recovered.hypercli.com");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ jobs: [existingJob], total_count: 1 }))
      .mockResolvedValueOnce(response({ detail: "Director restarting" }, 503))
      .mockResolvedValueOnce(response({ jobs: [existingJob, recoveredJob], total_count: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<JobsPage />);
    expect(await screen.findByText("existing.hypercli.com")).toBeInTheDocument();

    fireEvent.focus(window);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Live updates are temporarily unavailable",
    );
    expect(screen.getByText("existing.hypercli.com")).toBeInTheDocument();

    fireEvent.focus(window);
    expect(await screen.findByText("recovered.hypercli.com")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(warnSpy).toHaveBeenCalledWith(
      "Background jobs refresh failed:",
      "Director restarting",
    );
  });
});
