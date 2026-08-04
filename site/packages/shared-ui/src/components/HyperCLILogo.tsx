"use client";

export const HYPERCLI_LOGO_FULL_SRC = "/logos/hypercli-full-blue.svg";
export const HYPERCLI_LOGO_FULL_LIGHT_SRC = "/logos/hypercli-full-blue-light.svg";
export const HYPERCLI_LOGO_ICON_SRC = "/logos/hypercli-icon-blue.svg";
export const HYPERCLI_AURORA_LOGO_ICON_SRC = HYPERCLI_LOGO_ICON_SRC;
export const HYPERCLI_BRAND_ACCENT_HEX = "#4F7CFF";
export const HYPERCLI_AURORA_BRAND_ACCENT_HEX = "#4F7CFF";

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
  // ThemeScript sets data-color-mode before first paint. CSS-driven selection
  // avoids briefly rendering the server-default dark logo during hydration.
  const backgroundImage = markOnly
    ? `url('${HYPERCLI_LOGO_ICON_SRC}')`
    : `var(--hypercli-logo-full-image, url('${HYPERCLI_LOGO_FULL_SRC}'))`;

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "HyperCLI"}
      role={decorative ? undefined : "img"}
      className={`relative inline-flex shrink-0 bg-contain bg-left bg-no-repeat ${className} ${imageClassName}`}
      style={{ backgroundImage }}
    />
  );
}
