export interface TokenUsageSnapshot {
  byAgent: Record<string, number>;
  dailyTotal: number;
}

export interface TokenUsageRefreshScheduler {
  refresh(): void;
  reconcile(agentId: string | null): void;
  acceptSnapshot(snapshot: TokenUsageSnapshot): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export interface TokenUsageRefreshSchedulerOptions {
  intervalMs?: number;
  maxAttempts?: number;
  deadlineMs?: number;
  now?: () => number;
}

interface ReconcileJob {
  id: number;
  agentId: string | null;
  baselineAgentTotal: number | null;
  baselineDailyTotal: number | null;
  attempts: number;
  startedAt: number;
}

export function createTokenUsageRefreshScheduler(
  fetchSnapshot: () => Promise<TokenUsageSnapshot>,
  applySnapshot: (snapshot: TokenUsageSnapshot) => void,
  options: TokenUsageRefreshSchedulerOptions = {},
): TokenUsageRefreshScheduler {
  const intervalMs = Math.max(1, options.intervalMs ?? 2_000);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 10);
  const deadlineMs = Math.max(intervalMs, options.deadlineMs ?? 20_000);
  const now = options.now ?? Date.now;
  let disposed = false;
  let visible = true;
  let running = false;
  let pending = false;
  let nextJobId = 0;
  let snapshotRevision = 0;
  let hiddenAt: number | null = null;
  let job: ReconcileJob | null = null;
  let lastSnapshot: TokenUsageSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const displayedValueChanged = (candidate: TokenUsageSnapshot, activeJob: ReconcileJob) => {
    const agentTotal = activeJob.agentId ? candidate.byAgent[activeJob.agentId] ?? 0 : null;
    const agentChanged = activeJob.baselineAgentTotal !== null && agentTotal !== activeJob.baselineAgentTotal;
    const dailyChanged = activeJob.baselineDailyTotal !== null && candidate.dailyTotal !== activeJob.baselineDailyTotal;
    return agentChanged || dailyChanged;
  };

  const jobExpired = (activeJob: ReconcileJob) => (
    activeJob.attempts >= maxAttempts || now() - activeJob.startedAt >= deadlineMs
  );

  const finishReconciliation = () => {
    job = null;
    pending = false;
    clearTimer();
  };

  const evaluateSnapshot = (snapshot: TokenUsageSnapshot) => {
    const activeJob = job;
    if (!activeJob) return;
    if (activeJob.baselineAgentTotal === null && activeJob.baselineDailyTotal === null) {
      activeJob.baselineAgentTotal = activeJob.agentId ? snapshot.byAgent[activeJob.agentId] ?? 0 : null;
      activeJob.baselineDailyTotal = snapshot.dailyTotal;
      if (jobExpired(activeJob)) finishReconciliation();
      return;
    }
    if (displayedValueChanged(snapshot, activeJob)) {
      finishReconciliation();
      return;
    }
    if (jobExpired(activeJob)) {
      finishReconciliation();
    }
  };

  const scheduleNextAttempt = () => {
    if (disposed || !visible || !job || pending || timer !== null) return;
    if (jobExpired(job)) {
      finishReconciliation();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      if (job && jobExpired(job)) {
        finishReconciliation();
        return;
      }
      pending = true;
      startDrain();
    }, intervalMs);
  };

  const drain = async () => {
    try {
      while (pending && visible && !disposed) {
        pending = false;
        const activeJobId = job?.id ?? null;
        const revisionAtStart = snapshotRevision;
        if (activeJobId !== null && job?.id === activeJobId) job.attempts += 1;
        try {
          const snapshot = await fetchSnapshot();
          if (disposed) return;
          if (snapshotRevision !== revisionAtStart) continue;
          snapshotRevision += 1;
          lastSnapshot = snapshot;
          applySnapshot(snapshot);
          evaluateSnapshot(snapshot);
        } catch {
          const activeJob = job;
          if (
            activeJob &&
            jobExpired(activeJob)
          ) {
            finishReconciliation();
          }
        }
      }
    } finally {
      running = false;
      if (pending && visible && !disposed) startDrain();
      else scheduleNextAttempt();
    }
  };

  function startDrain() {
    if (disposed || !visible || running || !pending) return;
    clearTimer();
    running = true;
    void drain();
  }

  return {
    refresh() {
      if (disposed) return;
      pending = true;
      startDrain();
    },
    reconcile(agentId) {
      if (disposed) return;
      clearTimer();
      snapshotRevision += 1;
      nextJobId += 1;
      job = {
        id: nextJobId,
        agentId,
        baselineAgentTotal: agentId && lastSnapshot ? lastSnapshot.byAgent[agentId] ?? 0 : null,
        baselineDailyTotal: lastSnapshot?.dailyTotal ?? null,
        attempts: 0,
        startedAt: now(),
      };
      pending = true;
      startDrain();
    },
    acceptSnapshot(snapshot) {
      if (disposed) return;
      snapshotRevision += 1;
      lastSnapshot = snapshot;
      applySnapshot(snapshot);
      evaluateSnapshot(snapshot);
    },
    setVisible(nextVisible) {
      if (disposed || visible === nextVisible) return;
      visible = nextVisible;
      if (!visible) {
        hiddenAt = now();
        clearTimer();
        return;
      }
      if (hiddenAt !== null && job) job.startedAt += Math.max(0, now() - hiddenAt);
      hiddenAt = null;
      if (job && jobExpired(job)) {
        finishReconciliation();
        return;
      }
      if (job || pending) {
        pending = true;
        startDrain();
      }
    },
    dispose() {
      disposed = true;
      pending = false;
      job = null;
      hiddenAt = null;
      clearTimer();
    },
  };
}
