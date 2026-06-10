import Link from "next/link";

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
      <span
        aria-hidden
        className={`block h-full w-full bg-contain bg-left bg-no-repeat ${imageClassName}`}
        style={{ backgroundImage: "url('/logos/hyperclaw-full-green.svg')" }}
      />
    </Link>
  );
}

export function HyperCLILogoMark({ className = "h-4 w-4" }: HyperCLILogoMarkProps) {
  return (
    <span aria-hidden className={`relative inline-flex shrink-0 bg-contain bg-center bg-no-repeat ${className}`} style={{ backgroundImage: "url('/logos/hyperclaw-icon-green.svg')" }} />
  );
}
