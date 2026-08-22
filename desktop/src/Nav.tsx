import { ChevronRight } from "lucide-react";
import Logo from "./Logo";

export interface Crumb {
  label: string;
  onClick?: () => void;
}

export default function Nav({
  trail,
  action,
}: {
  trail: Crumb[];
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
      <nav className="flex items-center gap-1.5 text-xs">
        <Logo size={14} />
        {trail.map((crumb, index) => {
          const isCurrent = index === trail.length - 1;
          return (
            <span key={crumb.label} className="flex items-center gap-1.5">
              {index > 0 && <ChevronRight size={12} className="text-ink-dim" />}
              {isCurrent || !crumb.onClick ? (
                <span
                  className={
                    isCurrent ? "font-medium text-ink" : "text-ink-dim"
                  }
                >
                  {crumb.label}
                </span>
              ) : (
                <button
                  type="button"
                  className="text-ink-dim transition-colors hover:text-ink"
                  onClick={crumb.onClick}
                >
                  {crumb.label}
                </button>
              )}
            </span>
          );
        })}
      </nav>
      {action}
    </div>
  );
}
