import Link from "next/link";
import { HyperCLILogo } from "@hypercli/shared-ui";

interface HyperCLILogoLinkProps {
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}

interface HyperCLILogoMarkProps {
  className?: string;
}

export function HyperCLILogoLink({
  className = "h-[31px] w-[102px]",
  imageClassName = "",
  priority = false,
}: HyperCLILogoLinkProps) {
  void priority;

  return (
    <Link
      href="/"
      aria-label="HyperCLI home"
      className={`relative inline-flex shrink-0 items-center justify-start overflow-visible align-middle ${className}`}
    >
      <HyperCLILogo decorative className="h-full w-full" imageClassName={imageClassName} />
    </Link>
  );
}

export function HyperCLILogoMark({ className = "h-4 w-4" }: HyperCLILogoMarkProps) {
  return (
    <HyperCLILogo decorative markOnly className={className} />
  );
}
