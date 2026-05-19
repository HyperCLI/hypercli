"use client";

import { useEffect, useState, type SyntheticEvent } from "react";
import Image, { type ImageLoader, type ImageProps } from "next/image";

const resourceImageLoader: ImageLoader = ({ src }) => src;

type ResourceImageProps = Omit<ImageProps, "alt" | "loader" | "unoptimized"> & {
  alt: string;
  unoptimized?: true;
};

function imageSrcKey(src: ImageProps["src"]): string {
  return typeof src === "string" ? src : JSON.stringify(src);
}

export function ResourceImage({
  alt,
  unoptimized: _unoptimized,
  className,
  fill,
  src,
  onLoad,
  onError,
  ...props
}: ResourceImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const srcKey = imageSrcKey(src);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [srcKey]);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    setLoaded(true);
    onLoad?.(event);
  };

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    setFailed(true);
    onError?.(event);
  };

  return (
    <span className={`relative ${fill ? "block h-full w-full" : "inline-block max-w-full align-top"} overflow-hidden`}>
      {!loaded && !failed && (
        <span
          role="status"
          aria-label="Loading image"
          className="absolute inset-0 z-[1] flex min-h-12 min-w-12 items-center justify-center rounded-md border border-border bg-surface-low"
        >
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted/25 border-t-[#38D39F]" />
        </span>
      )}
      {failed && (
        <span role="status" aria-label="Image unavailable" className="absolute inset-0 z-[1] flex min-h-12 min-w-12 items-center justify-center rounded-md border border-border bg-surface-low px-2 text-center text-[10px] text-text-muted">
          Image unavailable
        </span>
      )}
      <Image
        {...props}
        src={src}
        fill={fill}
        alt={alt}
        loader={resourceImageLoader}
        unoptimized
        className={`${className ?? ""} ${loaded && !failed ? "opacity-100" : "opacity-0"} transition-opacity duration-150`}
        onLoad={handleLoad}
        onError={handleError}
      />
    </span>
  );
}
