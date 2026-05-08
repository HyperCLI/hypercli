import Image from "next/image";
import Link from "next/link";

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
      <Image
        src="/logo-horizontal-white.png"
        alt="HyperClaw"
        fill
        priority={priority}
        sizes="(max-width: 768px) 102px, 114px"
        className={`object-contain object-left ${imageClassName}`}
      />
    </Link>
  );
}
