"use client";

import Image, { type ImageLoader, type ImageProps } from "next/image";

const resourceImageLoader: ImageLoader = ({ src }) => src;

type ResourceImageProps = Omit<ImageProps, "alt" | "loader" | "unoptimized"> & {
  alt: string;
};

export function ResourceImage({ alt, ...props }: ResourceImageProps) {
  return <Image {...props} alt={alt} loader={resourceImageLoader} unoptimized />;
}
