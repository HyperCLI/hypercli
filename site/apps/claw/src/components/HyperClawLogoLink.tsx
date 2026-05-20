import Link from "next/link";
import { ResourceImage } from "@/components/ResourceImage";

interface HyperClawLogoLinkProps {
  className?: string;
  imageClassName?: string;
  priority?: boolean;
  themeAware?: boolean;
}

interface HyperClawLogoMarkProps {
  className?: string;
}

export function HyperClawLogoLink({
  className = "h-[31px] w-[102px]",
  imageClassName = "",
  priority = false,
  themeAware = false,
}: HyperClawLogoLinkProps) {
  const imageClasses = `object-contain object-left ${imageClassName}`;

  return (
    <Link
      href="/"
      aria-label="HyperClaw home"
      className={`relative inline-flex shrink-0 items-center justify-start overflow-visible align-middle ${themeAware ? "claw-logo-themed" : ""} ${className}`}
    >
      <span className={themeAware ? "claw-logo-theme-asset claw-logo-theme-default absolute inset-0" : "absolute inset-0"}>
        <ResourceImage
          src="/logo-horizontal-white.png"
          alt=""
          fill
          unoptimized
          priority={priority}
          sizes="(max-width: 768px) 164px, 144px"
          className={imageClasses}
        />
      </span>
      {themeAware ? (
        <>
          <span className="claw-logo-theme-asset claw-logo-theme-green absolute inset-0">
            <ResourceImage
              src="/logos/hyperclaw-full-green.svg"
              alt=""
              fill
              unoptimized
              priority={priority}
              sizes="(max-width: 768px) 164px, 144px"
              className={imageClasses}
            />
          </span>
          <span className="claw-logo-theme-asset claw-logo-theme-purple absolute inset-0">
            <ResourceImage
              src="/logos/hyperclaw-full-purple.svg"
              alt=""
              fill
              unoptimized
              priority={priority}
              sizes="(max-width: 768px) 164px, 144px"
              className={imageClasses}
            />
          </span>
        </>
      ) : null}
    </Link>
  );
}

export function HyperClawLogoMark({ className = "h-4 w-4" }: HyperClawLogoMarkProps) {
  const assetClassName = "claw-logo-theme-asset absolute inset-0 bg-contain bg-center bg-no-repeat";

  return (
    <span aria-hidden className={`claw-logo-themed relative inline-flex shrink-0 ${className}`}>
      <span
        className={`${assetClassName} claw-logo-theme-default`}
        style={{ backgroundImage: "url('/logos/hyperclaw-icon-green.svg')" }}
      />
      <span
        className={`${assetClassName} claw-logo-theme-green`}
        style={{ backgroundImage: "url('/logos/hyperclaw-icon-green.svg')" }}
      />
      <span
        className={`${assetClassName} claw-logo-theme-purple`}
        style={{ backgroundImage: "url('/logos/hyperclaw-icon-purple.svg')" }}
      />
    </span>
  );
}
