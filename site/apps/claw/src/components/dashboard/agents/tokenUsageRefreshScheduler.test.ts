import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTokenUsageRefreshScheduler,
  type TokenUsageSnapshot,
} from "./tokenUsageRefreshScheduler";

const snapshot = (agentTotal: number, dailyTotal = agentTotal): TokenUsageSnapshot => ({
  byAgent: { "agent-1": agentTotal },
  dailyTotal,
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("createTokenUsageRefreshScheduler", () => {
  it("refreshes immediately and stops when authoritative usage changes", async () => {
    vi.useFakeTimers();
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot(120));
    const applySnapshot = vi.fn();
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, applySnapshot);
    scheduler.acceptSnapshot(snapshot(100));

    scheduler.reconcile("agent-1");
    await flush();
    vi.advanceTimersByTime(20_000);

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(applySnapshot).toHaveBeenLastCalledWith(snapshot(120));
  });

  it("continues beyond the old five-second window without overlapping requests", async () => {
    vi.useFakeTimers();
    const releases: Array<(value: TokenUsageSnapshot) => void> = [];
    const fetchSnapshot = vi.fn(() => new Promise<TokenUsageSnapshot>((resolve) => releases.push(resolve)));
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, vi.fn(), {
      intervalMs: 2_000,
      maxAttempts: 10,
    });
    scheduler.acceptSnapshot(snapshot(100));
    scheduler.reconcile("agent-1");

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    releases.shift()?.(snapshot(100));
    await flush();
    vi.advanceTimersByTime(2_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);

    releases.shift()?.(snapshot(100));
    await flush();
    vi.advanceTimersByTime(2_000);
    releases.shift()?.(snapshot(100));
    await flush();
    vi.advanceTimersByTime(2_000);
    releases.shift()?.(snapshot(130));
    await flush();

    expect(fetchSnapshot).toHaveBeenCalledTimes(4);
  });

  it("queues a superseding completion behind an in-flight request", async () => {
    const releases: Array<(value: TokenUsageSnapshot) => void> = [];
    const fetchSnapshot = vi.fn(() => new Promise<TokenUsageSnapshot>((resolve) => releases.push(resolve)));
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, vi.fn());
    scheduler.acceptSnapshot(snapshot(100));

    scheduler.reconcile("agent-1");
    scheduler.reconcile("agent-1");
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    releases.shift()?.(snapshot(100));
    await flush();
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);

    releases.shift()?.(snapshot(140));
    await flush();
  });

  it("does not let an older in-flight response overwrite a newer accepted snapshot", async () => {
    const releases: Array<(value: TokenUsageSnapshot) => void> = [];
    const fetchSnapshot = vi.fn(() => new Promise<TokenUsageSnapshot>((resolve) => releases.push(resolve)));
    const applySnapshot = vi.fn();
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, applySnapshot);
    scheduler.acceptSnapshot(snapshot(100));
    scheduler.refresh();

    scheduler.acceptSnapshot(snapshot(140));
    releases.shift()?.(snapshot(110));
    await flush();

    expect(applySnapshot).toHaveBeenLastCalledWith(snapshot(140));
  });

  it("applies one refresh without a prior snapshot or reconciliation job", async () => {
    const applySnapshot = vi.fn();
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot(75));
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, applySnapshot);

    scheduler.refresh();
    await flush();

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(applySnapshot).toHaveBeenCalledOnce();
    expect(applySnapshot).toHaveBeenLastCalledWith(snapshot(75));
  });

  it("invalidates a pre-completion request and runs the queued reconciliation", async () => {
    const releases: Array<(value: TokenUsageSnapshot) => void> = [];
    const fetchSnapshot = vi.fn(() => new Promise<TokenUsageSnapshot>((resolve) => releases.push(resolve)));
    const applySnapshot = vi.fn();
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, applySnapshot);
    scheduler.acceptSnapshot(snapshot(200));
    scheduler.refresh();

    scheduler.reconcile("agent-1");
    releases.shift()?.(snapshot(50));
    await flush();

    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(applySnapshot).toHaveBeenLastCalledWith(snapshot(200));

    releases.shift()?.(snapshot(240));
    await flush();
    expect(applySnapshot).toHaveBeenLastCalledWith(snapshot(240));
  });

  it("keeps reconciling when no baseline snapshot is available", async () => {
    vi.useFakeTimers();
    const fetchSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshot(0))
      .mockResolvedValueOnce(snapshot(25));
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, vi.fn(), { intervalMs: 100 });

    scheduler.reconcile("agent-1");
    await flush();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
  });

  it("reconciles an unattributed turn using the daily total", async () => {
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot(100, 160));
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, vi.fn());
    scheduler.acceptSnapshot(snapshot(100, 120));

    scheduler.reconcile(null);
    await flush();

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures and stops at the attempt bound", async () => {
    vi.useFakeTimers();
    const fetchSnapshot = vi.fn().mockRejectedValue(new Error("offline"));
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, vi.fn(), {
      intervalMs: 100,
      maxAttempts: 3,
      deadlineMs: 10_000,
    });

    scheduler.reconcile("agent-1");
    await flush();
    await vi.advanceTimersByTimeAsync(300);

    expect(fetchSnapshot).toHaveBeenCalledTimes(3);
  });

  it("pauses while hidden and resumes one reconciliation burst when visible", async () => {
    vi.useFakeTimers();
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot(100));
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, vi.fn(), { intervalMs: 100 });
    scheduler.acceptSnapshot(snapshot(100));
    scheduler.setVisible(false);

    scheduler.reconcile("agent-1");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSnapshot).not.toHaveBeenCalled();

    scheduler.setVisible(true);
    await flush();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it("does not consume the reconciliation deadline while hidden", async () => {
    vi.useFakeTimers();
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot(100));
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, vi.fn(), {
      intervalMs: 100,
      deadlineMs: 500,
    });
    scheduler.acceptSnapshot(snapshot(100));
    scheduler.setVisible(false);
    scheduler.reconcile("agent-1");

    await vi.advanceTimersByTimeAsync(5_000);
    scheduler.setVisible(true);
    await flush();

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it("finishes an in-flight request without scheduling another attempt while hidden", async () => {
    vi.useFakeTimers();
    let release: ((value: TokenUsageSnapshot) => void) | null = null;
    const fetchSnapshot = vi.fn(() => new Promise<TokenUsageSnapshot>((resolve) => { release = resolve; }));
    const applySnapshot = vi.fn();
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, applySnapshot, { intervalMs: 100 });
    scheduler.acceptSnapshot(snapshot(100));
    scheduler.reconcile("agent-1");

    scheduler.setVisible(false);
    const resolveRequest = release as ((value: TokenUsageSnapshot) => void) | null;
    resolveRequest?.(snapshot(100));
    await flush();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(applySnapshot).toHaveBeenLastCalledWith(snapshot(100));
  });

  it("does not start an attempt at the deadline boundary", async () => {
    vi.useFakeTimers();
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot(100));
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, vi.fn(), {
      intervalMs: 100,
      maxAttempts: 100,
      deadlineMs: 500,
    });
    scheduler.acceptSnapshot(snapshot(100));
    scheduler.reconcile("agent-1");
    await flush();

    await vi.advanceTimersByTimeAsync(500);

    expect(fetchSnapshot).toHaveBeenCalledTimes(5);
  });

  it("accepts lower authoritative totals and treats them as reflected", async () => {
    vi.useFakeTimers();
    const applySnapshot = vi.fn();
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot(20));
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, applySnapshot);
    scheduler.acceptSnapshot(snapshot(500));

    scheduler.reconcile("agent-1");
    await flush();
    vi.advanceTimersByTime(20_000);

    expect(applySnapshot).toHaveBeenLastCalledWith(snapshot(20));
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it("drops timers and queued work after disposal", async () => {
    vi.useFakeTimers();
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot(100));
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, vi.fn(), { intervalMs: 100 });
    scheduler.acceptSnapshot(snapshot(100));
    scheduler.reconcile("agent-1");
    await flush();

    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it("ignores an unresolved request that settles after disposal", async () => {
    let release: ((value: TokenUsageSnapshot) => void) | null = null;
    const fetchSnapshot = vi.fn(() => new Promise<TokenUsageSnapshot>((resolve) => { release = resolve; }));
    const applySnapshot = vi.fn();
    const scheduler = createTokenUsageRefreshScheduler(fetchSnapshot, applySnapshot);
    scheduler.refresh();

    scheduler.dispose();
    const resolveRequest = release as ((value: TokenUsageSnapshot) => void) | null;
    resolveRequest?.(snapshot(100));
    await flush();

    expect(applySnapshot).not.toHaveBeenCalled();
  });
});
