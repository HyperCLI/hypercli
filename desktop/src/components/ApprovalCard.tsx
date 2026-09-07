import { ShieldAlert } from "lucide-react";
import type { ApprovalRequest } from "../useAgentChat";

export function ApprovalCard({ approval }: { approval: ApprovalRequest }) {
  const firstAllow = approval.options.findIndex((o) => o.kind?.startsWith("allow"));
  const highRisk =
    approval.kind === "delete" || approval.kind === "execute" || approval.kind === "move";

  return (
    <div
      className={`rounded-lg border px-3.5 py-3 ${
        highRisk ? "border-warning/50 bg-warning-bg" : "border-border bg-card"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <ShieldAlert size={14} className={highRisk ? "text-warning" : "text-text-secondary"} />
        <span className="text-[13px] font-medium">Approval needed</span>
      </div>
      <p className="text-[12px] text-text-secondary mb-3">{approval.title}</p>
      <div className="flex flex-wrap gap-2">
        {approval.options.map((option, i) => (
          <button
            key={option.optionId}
            onClick={() => approval.respond(option.optionId)}
            className={
              i === firstAllow
                ? "ui-primary-button !rounded-md !text-[12px] !px-3 !py-1.5"
                : "ui-secondary-button"
            }
          >
            {option.name}
          </button>
        ))}
        <button
          onClick={() => approval.respond(null)}
          className="rounded-md text-[12px] text-text-secondary px-3 py-1.5 hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
