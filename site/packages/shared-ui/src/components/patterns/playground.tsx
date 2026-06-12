"use client";

import type { ReactNode, SyntheticEvent } from "react";
import Link from "next/link";
import { cn } from "../ui/utils";

export interface PlaygroundTemplateCardProps {
  href: string;
  title: string;
  description?: string;
  thumbnailSrc: string;
  thumbnailAlt?: string;
  outputType?: string;
  aspect?: "square" | "video";
  mediaBadge?: ReactNode;
  tags?: string[];
  onImageError?: (event: SyntheticEvent<HTMLImageElement>) => void;
  className?: string;
}

export function PlaygroundTemplateCard({
  href,
  title,
  description,
  thumbnailSrc,
  thumbnailAlt,
  outputType,
  aspect = "square",
  mediaBadge,
  tags,
  onImageError,
  className,
}: PlaygroundTemplateCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        "group block overflow-hidden rounded-lg border border-border-medium/50 bg-surface-low/40 transition-colors hover:bg-surface-low/60",
        className,
      )}
    >
      <div className={cn("relative overflow-hidden bg-background", aspect === "square" ? "aspect-square" : "aspect-video")}>
        <img
          src={thumbnailSrc}
          alt={thumbnailAlt ?? title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          onError={onImageError}
        />
        {mediaBadge && <div className="absolute bottom-2 left-2 rounded-full border border-primary/30 bg-primary/20 p-1.5 backdrop-blur-sm">{mediaBadge}</div>}
        {outputType && (
          <div className="absolute right-2 top-2 rounded border border-border-medium/50 bg-surface-low/80 px-2 py-0.5 text-xs font-medium text-text-muted backdrop-blur-sm">
            {outputType}
          </div>
        )}
      </div>
      <div className={cn("p-3", aspect === "video" && "p-4")}>
        <h3 className={cn("font-semibold leading-tight text-foreground transition-colors group-hover:text-primary", aspect === "video" ? "mb-2 text-base" : "text-sm")}>
          {title}
        </h3>
        {description && <p className={cn("line-clamp-2 text-text-muted", aspect === "video" ? "mb-3 text-sm" : "mt-1 text-xs")}>{description}</p>}
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export function PlaygroundSectionHeader({ icon, title, count, className }: { icon: ReactNode; title: string; count: number; className?: string }) {
  return (
    <div className={cn("mb-6 flex items-center gap-3", className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</div>
      <h2 className="text-2xl font-bold text-foreground">{title}</h2>
      <span className="rounded-full border border-border-medium/50 bg-surface-low/40 px-2 py-1 text-sm font-medium text-text-muted">{count}</span>
    </div>
  );
}
