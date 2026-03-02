"use client";

/** Base shimmer skeleton. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-shimmer rounded bg-surface-low ${className}`} />
  );
}

export function StatCardSkeleton() {
  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Skeleton className="w-4 h-4 rounded" />
        <Skeleton className="w-20 h-3" />
      </div>
      <Skeleton className="w-16 h-7 mb-1" />
      <Skeleton className="w-24 h-3" />
    </div>
  );
}

export function AgentCardSkeleton() {
  return (
    <div className="glass-card p-4">
      <div className="flex items-start gap-3 mb-3">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="flex-1">
          <Skeleton className="w-24 h-4 mb-1.5" />
          <Skeleton className="w-32 h-3" />
        </div>
        <Skeleton className="w-14 h-5 rounded-full" />
      </div>
      <Skeleton className="w-20 h-3 mb-3" />
      <div className="flex gap-2">
        <Skeleton className="w-16 h-6 rounded" />
        <Skeleton className="w-16 h-6 rounded" />
      </div>
    </div>
  );
}

const BAR_HEIGHTS = ["h-[30%]", "h-[50%]", "h-[70%]", "h-[45%]", "h-[80%]", "h-[55%]", "h-[65%]"];

export function ChartSkeleton() {
  return (
    <div className="glass-card p-6">
      <Skeleton className="w-32 h-5 mb-4" />
      <div className="flex items-end gap-2 h-[200px]">
        {BAR_HEIGHTS.map((h, i) => (
          <div key={i} className={`flex-1 ${h}`}>
            <Skeleton className="w-full h-full rounded-t" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <Skeleton className="w-32 h-5" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-5 py-3 flex items-center gap-4">
            <Skeleton className="w-24 h-4" />
            <Skeleton className="w-16 h-4" />
            <Skeleton className="flex-1 h-4" />
            <Skeleton className="w-20 h-4" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentSidebarSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="p-3 flex items-start gap-3">
          <Skeleton className="w-9 h-9 rounded-full flex-shrink-0" />
          <div className="flex-1">
            <Skeleton className="w-20 h-4 mb-1.5" />
            <Skeleton className="w-28 h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}
