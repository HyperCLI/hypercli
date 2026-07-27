const SHELL_PERFORMANCE_PREFIX = "claw-shell:";

export function markShellPerformance(name: string): void {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  const mark = `${SHELL_PERFORMANCE_PREFIX}${name}`;
  if (typeof performance.clearMarks === "function") performance.clearMarks(mark);
  performance.mark(mark);
}

export function measureShellPerformance(name: string, startMark: string, endMark: string): void {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") return;
  try {
    const measure = `${SHELL_PERFORMANCE_PREFIX}${name}`;
    if (typeof performance.clearMeasures === "function") performance.clearMeasures(measure);
    performance.measure(
      measure,
      `${SHELL_PERFORMANCE_PREFIX}${startMark}`,
      `${SHELL_PERFORMANCE_PREFIX}${endMark}`,
    );
  } catch {
    // Cancelled or preloaded flows do not always produce every mark.
  }
}
