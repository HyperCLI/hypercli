export interface DeploymentRefreshScheduler {
  invalidate(includeEnrichment?: boolean): void;
  dispose(): void;
}

export interface DeploymentRefreshSchedulerOptions {
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
}

export interface DeploymentSubscriptionRecovery {
  markHealthy(): void;
  retryAfterFailure(retry: () => void): number;
  reset(): void;
}

export interface DeploymentSubscriptionRecoveryOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Recover one rejected event credential immediately, then bound repeated
 * token/socket failures with exponential backoff. State survives replacement
 * Deployments clients and resets only after an event or principal change.
 */
export function createDeploymentSubscriptionRecovery(
  options: DeploymentSubscriptionRecoveryOptions = {},
): DeploymentSubscriptionRecovery {
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 1_000);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 30_000);
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return {
    markHealthy() {
      failures = 0;
      cancelTimer();
    },
    retryAfterFailure(retry) {
      cancelTimer();
      const delayMs = failures === 0
        ? 0
        : Math.min(baseDelayMs * (2 ** Math.min(failures - 1, 20)), maxDelayMs);
      failures += 1;
      timer = setTimeout(() => {
        timer = null;
        retry();
      }, delayMs);
      return delayMs;
    },
    reset() {
      failures = 0;
      cancelTimer();
    },
  };
}

export function createDeploymentRefreshScheduler(
  refresh: (includeEnrichment: boolean) => Promise<unknown>,
  options: DeploymentRefreshSchedulerOptions = {},
): DeploymentRefreshScheduler {
  const retryDelayMs = Math.max(1, options.retryDelayMs ?? 1_000);
  const maxRetryDelayMs = Math.max(retryDelayMs, options.maxRetryDelayMs ?? 30_000);
  let running = false;
  let pending = false;
  let enrichmentPending = false;
  let disposed = false;
  let failures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRetryTimer = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const startDrain = () => {
    if (disposed || running || retryTimer !== null || !pending) return;
    running = true;
    void drain().catch(() => undefined);
  };

  const scheduleRetry = () => {
    if (disposed || retryTimer !== null || !pending) return;
    const delayMs = Math.min(
      retryDelayMs * (2 ** Math.min(Math.max(failures - 1, 0), 20)),
      maxRetryDelayMs,
    );
    retryTimer = setTimeout(() => {
      retryTimer = null;
      startDrain();
    }, delayMs);
  };

  const drain = async () => {
    try {
      while (pending && !disposed) {
        pending = false;
        const includeEnrichment = enrichmentPending;
        enrichmentPending = false;
        try {
          await refresh(includeEnrichment);
          failures = 0;
        } catch (error) {
          // An invalidation is an edge-triggered hint. Preserve it until the
          // authoritative REST snapshot succeeds, otherwise one transient
          // failure can strand the UI indefinitely with no later event.
          pending = true;
          enrichmentPending ||= includeEnrichment;
          failures += 1;
          throw error;
        }
      }
    } finally {
      running = false;
      scheduleRetry();
    }
  };

  return {
    invalidate(includeEnrichment = false) {
      if (disposed) return;
      pending = true;
      enrichmentPending ||= includeEnrichment;
      startDrain();
    },
    dispose() {
      disposed = true;
      pending = false;
      enrichmentPending = false;
      clearRetryTimer();
    },
  };
}
