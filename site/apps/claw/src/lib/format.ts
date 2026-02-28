/** Format a token count as a compact human-readable string (e.g. 500K, 1.2M). */
export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

/** Format a plan's rate summary line for display. */
export function formatPlanRate(limits: PlanLimits): string {
  return `${formatTokens(limits.tpd)} tokens/day`;
}

/** Format the burst line: "up to X TPM burst" */
export function formatBurstLine(limits: PlanLimits): string {
  return `Up to ${formatTokens(limits.burst_tpm)} TPM burst`;
}

export interface PlanLimits {
  tpd: number;
  tpm: number;
  burst_tpm: number;
  rpm: number;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  aiu: number;
  features: string[];
  models: string[];
  highlighted?: boolean | null;
  expires_at?: string | null;
  limits: PlanLimits;
  agent_resources?: {
    max_agents: number;
    total_cpu: string;
    total_memory: string;
  };
  agents?: number;
}

export function formatCpu(millicores: number): string {
  return millicores >= 1000 ? `${millicores / 1000} vCPU` : `${millicores}m`;
}

export function formatMemory(mib: number): string {
  return mib >= 1024 ? `${(mib / 1024).toFixed(mib % 1024 === 0 ? 0 : 1)} GiB` : `${mib} MiB`;
}
