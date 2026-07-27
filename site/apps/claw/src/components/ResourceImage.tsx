"use client";

import { useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
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
  const srcKey = imageSrcKey(src);
  const nativeDataImage = typeof src === "string" && /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp);base64,/i.test(src);
  const currentSrcKeyRef = useRef(srcKey);
  const [status, setStatus] = useState<{ srcKey: string; value: "loaded" | "failed" } | null>(null);
  const loaded = status?.srcKey === srcKey && status.value === "loaded";
  const failed = status?.srcKey === srcKey && status.value === "failed";

  useLayoutEffect(() => {
    currentSrcKeyRef.current = srcKey;
  }, [srcKey]);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    if (currentSrcKeyRef.current !== srcKey) return;
    setStatus({ srcKey, value: "loaded" });
    onLoad?.(event);
  };

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    if (currentSrcKeyRef.current !== srcKey) return;
    setStatus({ srcKey, value: "failed" });
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
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-text-muted/25 border-t-primary" />
        </span>
      )}
      {failed && (
        <span role="status" aria-label="Image unavailable" className="absolute inset-0 z-[1] flex min-h-12 min-w-12 items-center justify-center rounded-md border border-border bg-surface-low px-2 text-center text-[10px] text-text-muted">
          Image unavailable
        </span>
      )}
      {nativeDataImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URLs are already complete local resources and cannot be optimized.
        <img
          key={srcKey}
          src={src}
          alt={alt}
          width={fill ? undefined : props.width}
          height={fill ? undefined : props.height}
          sizes={props.sizes}
          loading={props.loading}
          decoding={props.decoding}
          fetchPriority={props.fetchPriority}
          style={fill ? { ...props.style, position: "absolute", inset: 0, width: "100%", height: "100%" } : props.style}
          className={`${className ?? ""} ${loaded && !failed ? "opacity-100" : "opacity-0"} transition-opacity duration-150`}
          onLoad={handleLoad}
          onError={handleError}
        />
      ) : (
        <Image
          key={srcKey}
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
      )}
    </span>
  );
}
