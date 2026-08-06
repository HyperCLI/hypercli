export interface DeploymentRefreshScheduler {
  invalidate(): void;
  dispose(): void;
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
  refresh: () => Promise<unknown>,
): DeploymentRefreshScheduler {
  let running = false;
  let pending = false;
  let disposed = false;

  const drain = async () => {
    try {
      while (pending && !disposed) {
        pending = false;
        await refresh();
      }
    } finally {
      running = false;
    }
  };

  return {
    invalidate() {
      if (disposed) return;
      pending = true;
      if (running) return;
      running = true;
      void drain().catch(() => undefined);
    },
    dispose() {
      disposed = true;
      pending = false;
    },
  };
}
