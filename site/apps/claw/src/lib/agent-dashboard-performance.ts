const DASHBOARD_PERFORMANCE_PREFIX = "claw-dashboard:";

export function markDashboardPerformance(name: string): void {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  const mark = `${DASHBOARD_PERFORMANCE_PREFIX}${name}`;
  if (typeof performance.clearMarks === "function") performance.clearMarks(mark);
  performance.mark(mark);
}

export function measureDashboardPerformance(name: string, startMark: string, endMark: string): void {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") return;
  try {
    const measure = `${DASHBOARD_PERFORMANCE_PREFIX}${name}`;
    if (typeof performance.clearMeasures === "function") performance.clearMeasures(measure);
    performance.measure(
      measure,
      `${DASHBOARD_PERFORMANCE_PREFIX}${startMark}`,
      `${DASHBOARD_PERFORMANCE_PREFIX}${endMark}`,
    );
  } catch {
    // Navigation and cancellation can legitimately omit intermediate marks.
  }
}
