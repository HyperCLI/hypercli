import type { ReactNode } from "react";
import { cn } from "../ui/utils";

export interface LandingFooterLink {
  label: ReactNode;
  href: string;
  external?: boolean;
}

export interface LandingFooterLinkGroup {
  title: ReactNode;
  links: LandingFooterLink[];
}

export interface LandingFooterShellProps {
  brand: ReactNode;
  description?: ReactNode;
  linkGroups: LandingFooterLinkGroup[];
  copyright: ReactNode;
  className?: string;
  containerClassName?: string;
}

export function LandingFooterShell({
  brand,
  description,
  linkGroups,
  copyright,
  className,
  containerClassName,
}: LandingFooterShellProps) {
  return (
    <footer className={cn("border-t border-border bg-background", className)}>
      <div className={cn("mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8", containerClassName)}>
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            {brand}
            {description && (
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                {description}
              </p>
            )}
          </div>

          {linkGroups.map((group, groupIndex) => (
            <div key={groupIndex}>
              <h4 className="mb-3 text-sm font-semibold text-foreground">
                {group.title}
              </h4>
              <ul className="space-y-2">
                {group.links.map((link, linkIndex) => (
                  <li key={linkIndex}>
                    <a
                      href={link.href}
                      className="text-sm text-text-muted transition-colors hover:text-foreground"
                      {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 border-t border-border pt-8 text-center">
          <p className="text-xs text-text-muted">{copyright}</p>
        </div>
      </div>
    </footer>
  );
}
