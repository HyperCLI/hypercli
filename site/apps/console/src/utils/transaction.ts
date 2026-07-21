/**
 * Transaction utility functions
 */

// Transaction types from backend
export const TRANSACTION_TYPES = {
  TOP_UP: "top_up",
  JOB: "job",
  GENERATION: "generation",
  LLM: "llm",
  REFUND: "refund",
  ADJUSTMENT: "adjustment",
  SUBSCRIPTION: "subscription",
  EXPIRY: "expiry",
} as const;

// Transaction statuses
export const TRANSACTION_STATUSES = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

/**
 * Format transaction type for display
 * @param type - Transaction type from backend (e.g., "top_up")
 * @returns Formatted display name (e.g., "Top Up")
 */
export function formatTransactionType(type: string): string {
  const typeMap: Record<string, string> = {
    top_up: "Top Up",
    job: "Job",
    generation: "Generation",
    llm: "LLM",
    refund: "Refund",
    adjustment: "Adjustment",
    subscription: "Subscription",
    expiry: "Expiry",
  };

  return typeMap[type] || type;
}

/**
 * Get badge color classes for transaction type
 * @param type - Transaction type from backend
 * @returns Tailwind CSS classes for badge styling
 */
export function getTransactionTypeBadgeClass(type: string): string {
  const classMap: Record<string, string> = {
    top_up: "bg-primary/10 text-primary border-primary/30",
    job: "bg-muted text-muted-foreground border-border",
    generation: "bg-muted text-muted-foreground border-border",
    llm: "bg-muted text-muted-foreground border-border",
    refund: "bg-success/10 text-success border-success/30",
    adjustment: "bg-warning/10 text-warning border-warning/30",
    subscription: "bg-primary/10 text-primary border-primary/30",
    expiry: "bg-muted text-muted-foreground border-border",
  };

  return classMap[type] || "bg-muted text-muted-foreground border-border";
}

/**
 * Get badge color classes for transaction status
 * @param status - Transaction status from backend
 * @returns Tailwind CSS classes for badge styling
 */
export function getTransactionStatusBadgeClass(status: string): string {
  const classMap: Record<string, string> = {
    completed: "bg-success/10 text-success border-success/30",
    pending: "bg-warning/10 text-warning border-warning/30",
    failed: "bg-error/10 text-error border-error/30",
  };

  return classMap[status] || "bg-muted text-muted-foreground border-border";
}

/**
 * Capitalize transaction status for display
 * @param status - Transaction status from backend
 * @returns Capitalized status
 */
export function formatTransactionStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
