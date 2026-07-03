import type { CSSProperties } from "react";

export const HYPERCLI_LOGO_FULL_SRC = "/logos/hyperclaw-full-green.svg";
export const HYPERCLI_LOGO_ICON_SRC = "/logos/hyperclaw-icon-green.svg";
export const HYPERCLI_BRAND_ACCENT_HEX = "#63E452";

interface HyperCLILogoProps {
  className?: string;
  imageClassName?: string;
  markOnly?: boolean;
  decorative?: boolean;
}

export function HyperCLILogo({
  className = "h-[31px] w-[102px]",
  imageClassName = "",
  markOnly = false,
  decorative = false,
}: HyperCLILogoProps) {
  const src = markOnly ? HYPERCLI_LOGO_ICON_SRC : HYPERCLI_LOGO_FULL_SRC;
  const style = { backgroundImage: `url('${src}')` } satisfies CSSProperties;

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "HyperCLI"}
      role={decorative ? undefined : "img"}
      className={`relative inline-flex shrink-0 bg-contain bg-no-repeat ${markOnly ? "bg-center" : "bg-left"} ${className} ${imageClassName}`}
      style={style}
    />
  );
}
