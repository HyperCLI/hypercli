import { cn } from "../ui/utils";

export function ShimmerSkeleton({ className = "" }: { className?: string }) {
  return <div className={cn("animate-shimmer rounded bg-surface-low", className)} />;
}

export function StatCardSkeleton() {
  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShimmerSkeleton className="h-4 w-4 rounded" />
        <ShimmerSkeleton className="h-3 w-20" />
      </div>
      <ShimmerSkeleton className="mb-1 h-7 w-16" />
      <ShimmerSkeleton className="h-3 w-24" />
    </div>
  );
}

export function AgentCardSkeleton() {
  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex items-start gap-3">
        <ShimmerSkeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1">
          <ShimmerSkeleton className="mb-1.5 h-4 w-24" />
          <ShimmerSkeleton className="h-3 w-32" />
        </div>
        <ShimmerSkeleton className="h-5 w-14 rounded-full" />
      </div>
      <ShimmerSkeleton className="mb-3 h-3 w-20" />
      <div className="flex gap-2">
        <ShimmerSkeleton className="h-6 w-16 rounded" />
        <ShimmerSkeleton className="h-6 w-16 rounded" />
      </div>
    </div>
  );
}

const BAR_HEIGHTS = ["30%", "50%", "70%", "45%", "80%", "55%", "65%"];

export function ChartSkeleton() {
  return (
    <div className="glass-card p-6">
      <ShimmerSkeleton className="mb-4 h-5 w-32" />
      <div className="flex h-[200px] items-end gap-2">
        {BAR_HEIGHTS.map((height, index) => (
          <div key={index} className="flex-1" style={{ height }}>
            <ShimmerSkeleton className="h-full w-full rounded-t" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <ShimmerSkeleton className="h-5 w-32" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-5 py-3">
            <ShimmerSkeleton className="h-4 w-24" />
            <ShimmerSkeleton className="h-4 w-16" />
            <ShimmerSkeleton className="h-4 flex-1" />
            <ShimmerSkeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AgentSidebarSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex items-start gap-3 p-3">
          <ShimmerSkeleton className="h-9 w-9 flex-shrink-0 rounded-full" />
          <div className="flex-1">
            <ShimmerSkeleton className="mb-1.5 h-4 w-20" />
            <ShimmerSkeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}
