"use client";

import { useThemeOptional } from "./ThemeProvider";

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
  // The logo also renders outside a ThemeProvider (tests, emails, bare
  // pages); fall back to the dark-variant full lockup in that case.
  const theme = useThemeOptional();
  const mode = theme?.mode ?? "dark";
  const src = markOnly
    ? HYPERCLI_LOGO_ICON_SRC
    : mode === "light"
      ? HYPERCLI_LOGO_FULL_LIGHT_SRC
      : HYPERCLI_LOGO_FULL_SRC;

  return (
    <span
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : "HyperCLI"}
      role={decorative ? undefined : "img"}
      className={`relative inline-flex shrink-0 bg-contain bg-left bg-no-repeat ${className} ${imageClassName}`}
      style={{ backgroundImage: `url('${src}')` }}
    />
  );
}
