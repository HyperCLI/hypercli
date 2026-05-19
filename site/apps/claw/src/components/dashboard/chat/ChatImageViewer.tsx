"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn } from "lucide-react";
import { ResourceImage } from "@/components/ResourceImage";

interface ChatImageViewerProps {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  width?: number;
  height?: number;
  sizes?: string;
  loading?: "eager" | "lazy";
}

export function ChatImageViewer({
  src,
  alt,
  className,
  containerClassName,
  width = 320,
  height = 320,
  sizes = "(max-width: 640px) 100vw, 320px",
  loading = "lazy",
}: ChatImageViewerProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group relative block max-w-full rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38D39F] focus-visible:ring-offset-2 focus-visible:ring-offset-background ${containerClassName ?? ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`View ${alt}`}
      >
        <ResourceImage
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes={sizes}
          className={`${className ?? ""} cursor-zoom-in`}
          loading={loading}
        />
        <span className="pointer-events-none absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border border-white/15 bg-black/55 text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <ZoomIn className="h-3.5 w-3.5" />
        </span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-[200] bg-black/90 text-white"
        >
          <div className="flex h-full min-h-0 w-full flex-col">
            <div className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-white/10 px-4">
              <p id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">
                {alt}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-white/15 bg-white/10 text-white transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#38D39F]"
                aria-label="Close image viewer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="relative min-h-0 flex-1 p-4 sm:p-6">
              <ResourceImage
                src={src}
                alt={alt}
                fill
                sizes="100vw"
                className="object-contain"
                loading="eager"
              />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
