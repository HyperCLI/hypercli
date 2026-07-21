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

  if (markOnly) {
    return (
      <span
        aria-hidden={decorative || undefined}
        aria-label={decorative ? undefined : "HyperCLI"}
        role={decorative ? undefined : "img"}
        className={`relative inline-flex shrink-0 bg-contain bg-center bg-no-repeat ${className} ${imageClassName}`}
        style={style}
      />
    );
  }

  const maskStyle = {
    WebkitMaskImage: `url('${HYPERCLI_LOGO_FULL_SRC}')`,
    maskImage: `url('${HYPERCLI_LOGO_FULL_SRC}')`,
    WebkitMaskPosition: "left center",
    maskPosition: "left center",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  } satisfies CSSProperties;
  const markStyle = { backgroundImage: `url('${HYPERCLI_LOGO_ICON_SRC}')`, width: "19.59%" } satisfies CSSProperties;

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "HyperCLI"}
      role={decorative ? undefined : "img"}
      className={`relative inline-flex shrink-0 text-foreground ${className} ${imageClassName}`}
    >
      <span aria-hidden="true" className="absolute inset-0 hidden bg-contain bg-left bg-no-repeat dark:block" style={style} />
      <span aria-hidden="true" className="absolute inset-0 block bg-current dark:hidden" style={maskStyle} />
      <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 block bg-contain bg-left bg-no-repeat dark:hidden" style={markStyle} />
    </span>
  );
}
