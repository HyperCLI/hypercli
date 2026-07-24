"use client";

import { getRegionFlag, getRegionName } from "../utils/gpu";

export interface RegionDisplayProps {
  region: string;
  showName?: boolean;
  className?: string;
  nameClassName?: string;
}

export function RegionDisplay({
  region,
  showName = true,
  className = "",
  nameClassName = "text-foreground",
}: RegionDisplayProps) {
  const name = getRegionName(region);

  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`} title={name}>
      <span
        aria-hidden="true"
        className="inline-flex h-7 w-8 shrink-0 items-center justify-center text-[22px] leading-none"
      >
        {getRegionFlag(region)}
      </span>
      {showName ? <span className={`min-w-0 truncate ${nameClassName}`}>{name}</span> : null}
      <span className="sr-only">{name}</span>
    </span>
  );
}
