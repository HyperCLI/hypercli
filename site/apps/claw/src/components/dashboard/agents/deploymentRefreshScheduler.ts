export interface DeploymentRefreshScheduler {
  invalidate(): void;
  dispose(): void;
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
