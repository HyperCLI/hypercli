import Link from "next/link";
import { ResourceImage } from "@/components/ResourceImage";

interface HyperClawLogoLinkProps {
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}

export function HyperClawLogoLink({
  className = "h-[31px] w-[102px]",
  imageClassName = "",
  priority = false,
}: HyperClawLogoLinkProps) {
  return (
    <Link
      href="/"
      aria-label="HyperClaw home"
      className={`relative inline-flex shrink-0 items-center justify-start overflow-visible align-middle ${className}`}
    >
      <ResourceImage
        src="/logo-horizontal-white.png"
        alt="HyperClaw"
        fill
        unoptimized
        priority={priority}
        sizes="(max-width: 768px) 102px, 114px"
        className={`object-contain object-left ${imageClassName}`}
      />
    </Link>
  );
}
