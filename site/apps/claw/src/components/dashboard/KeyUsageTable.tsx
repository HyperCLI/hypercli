"use client";

interface KeyUsage {
  key_hash: string;
  name: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  requests: number;
}

interface KeyUsageTableProps {
  keys: KeyUsage[];
  loading?: boolean;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export default function KeyUsageTable({ keys, loading }: KeyUsageTableProps) {
  if (loading) {
    return (
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Usage by Key
        </h3>
        <div className="h-24 flex items-center justify-center text-text-muted">
          Loading...
        </div>
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Usage by Key
        </h3>
        <p className="text-text-muted text-sm">
          No usage data yet. Start making API calls to see per-key metrics.
        </p>
      </div>
    );
  }

  const maxTokens = Math.max(...keys.map((k) => k.total_tokens), 1);

  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">
        Usage by Key (7 days)
      </h3>
      <div className="space-y-3">
        {keys.map((k) => {
          const pct = (k.total_tokens / maxTokens) * 100;
          return (
            <div key={k.key_hash}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-foreground truncate max-w-[200px]">
                  {k.name}
                </span>
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <span>{formatTokens(k.total_tokens)} tokens</span>
                  <span>{k.requests} reqs</span>
                </div>
              </div>
              <div className="w-full h-2 rounded-full bg-surface-low overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#38D39F] to-[#6C63FF] transition-all duration-500"
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
