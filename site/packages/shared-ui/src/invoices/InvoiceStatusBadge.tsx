import { getBadgeClass } from "../utils/badges";

export function InvoiceStatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getBadgeClass(status)}`}>
      {status.toLowerCase()}
    </span>
  );
}
