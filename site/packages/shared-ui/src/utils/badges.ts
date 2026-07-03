/**
 * Common badge styling utilities for consistent status/state display
 * Uses muted, dark-theme friendly colors
 */

/**
 * Get badge class based on status/state
 * Works for both job states and transaction statuses
 */
export const getBadgeClass = (status: string): string => {
  const normalizedStatus = status.toLowerCase();

  switch (normalizedStatus) {
    // Success states - semantic success, separate from brand green
    case 'succeeded':
    case 'completed':
      return 'bg-success/10 text-success border-success/30';

    // Warning/pending states - muted amber/yellow
    case 'pending':
    case 'queued':
      return 'bg-warning/10 text-warning border-warning/30';

    // Info/in-progress states - muted blue
    case 'assigned':
    case 'running':
      return 'bg-[#5B9BD5]/10 text-[#5B9BD5] border-[#5B9BD5]/30';

    // Error/failure states - muted red
    case 'failed':
    case 'canceled':
      return 'bg-destructive/10 text-destructive border-destructive/30';

    // Terminated/stopped states - muted gray
    case 'terminated':
      return 'bg-muted text-muted-foreground border-border';

    // Default - muted gray
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
};

/**
 * Get muted badge class for type/category badges (job, llm, rewards, etc.)
 */
export const getTypeBadgeClass = (type: string): string => {
  const normalizedType = type.toLowerCase();

  switch (normalizedType) {
    case 'job':
      return 'bg-muted text-muted-foreground border-border';
    case 'llm':
      return 'bg-muted text-muted-foreground border-border';
    case 'render':
      return 'bg-[#A855F7]/10 text-[#A855F7] border-[#A855F7]/30';
    case 'top_up':
    case 'topup':
      return 'bg-success/10 text-success border-success/30';
    case 'rewards':
      return 'bg-warning/10 text-warning border-warning/30';
    case 'invoice':
      return 'bg-[#5B9BD5]/10 text-[#5B9BD5] border-[#5B9BD5]/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
};
