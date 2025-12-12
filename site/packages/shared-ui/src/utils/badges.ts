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
    // Success states - muted green
    case 'succeeded':
    case 'completed':
      return 'bg-[#38D39F]/10 text-[#38D39F] border-[#38D39F]/30';

    // Warning/pending states - muted amber/yellow
    case 'pending':
    case 'queued':
      return 'bg-[#E0A85F]/10 text-[#E0A85F] border-[#E0A85F]/30';

    // Info/in-progress states - muted blue
    case 'assigned':
    case 'running':
      return 'bg-[#5B9BD5]/10 text-[#5B9BD5] border-[#5B9BD5]/30';

    // Error/failure states - muted red
    case 'failed':
    case 'canceled':
      return 'bg-[#D05F5F]/10 text-[#D05F5F] border-[#D05F5F]/30';

    // Terminated/stopped states - muted gray
    case 'terminated':
      return 'bg-[#6E7375]/10 text-[#9BA0A2] border-[#6E7375]/30';

    // Default - muted gray
    default:
      return 'bg-[#6E7375]/10 text-[#9BA0A2] border-[#6E7375]/30';
  }
};

/**
 * Get muted badge class for type/category badges (job, llm, rewards, etc.)
 */
export const getTypeBadgeClass = (type: string): string => {
  const normalizedType = type.toLowerCase();

  switch (normalizedType) {
    case 'job':
      return 'bg-[#6E7375]/10 text-[#9BA0A2] border-[#6E7375]/30';
    case 'llm':
      return 'bg-[#6E7375]/10 text-[#9BA0A2] border-[#6E7375]/30';
    case 'top_up':
    case 'topup':
      return 'bg-[#38D39F]/10 text-[#38D39F] border-[#38D39F]/30';
    case 'rewards':
      return 'bg-[#E0A85F]/10 text-[#E0A85F] border-[#E0A85F]/30';
    case 'invoice':
      return 'bg-[#5B9BD5]/10 text-[#5B9BD5] border-[#5B9BD5]/30';
    default:
      return 'bg-[#6E7375]/10 text-[#9BA0A2] border-[#6E7375]/30';
  }
};