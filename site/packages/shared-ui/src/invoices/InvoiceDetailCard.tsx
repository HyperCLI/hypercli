import Link from "next/link";
import { formatDate, formatDateTimeShort } from "../utils/datetime";
import { getTypeBadgeClass } from "../utils/badges";
import { formatUsdAmount } from "./format";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";
import { PrintActions } from "./PrintActions";
import { InvoiceRecord } from "./types";

interface InvoiceDetailCardProps {
  invoice: InvoiceRecord;
  title?: string;
  description?: string;
  getTransactionHref?: (transactionId: string) => string;
}

export function InvoiceDetailCard({
  invoice,
  title = "Invoice",
  description = "Enterprise billing document for your Console account.",
  getTransactionHref,
}: InvoiceDetailCardProps) {
  const lineItems = invoice.transactions ?? [];

  return (
    <article className="billing-document mx-auto max-w-5xl overflow-hidden rounded-[28px] border border-[#2a2d2f] bg-[#111314] text-[#f7f3eb] shadow-[0_32px_120px_rgba(0,0,0,0.35)] print:max-w-none print:rounded-none print:border-0 print:bg-white print:text-[#161819] print:shadow-none">
      <div className="px-8 py-8 print:px-0">
        <div className="billing-document__header grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-[#161819] px-3 py-1 text-xs font-bold uppercase tracking-[0.28em] text-[#38d39f] print:bg-[#161819] print:text-[#38d39f]">
                HyperCLI
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
                Billing
              </p>
            </div>
            <div>
              <h2 className="text-4xl font-bold tracking-tight">{title}</h2>
              <p className="mt-2 max-w-2xl text-sm text-[#b5babd] print:text-[#5f584e]">{description}</p>
            </div>
          </div>

          <div className="flex flex-col items-start gap-4">
            <div className="text-left">
              <p className="text-3xl font-bold tracking-tight">
                {invoice.invoiceId || `Invoice ${invoice.id.slice(0, 8)}`}
              </p>
              <p className="mt-2 font-mono text-xs text-[#8f9699] print:text-[#6e675d] break-all">
                {invoice.id}
              </p>
            </div>
            <PrintActions />
          </div>
        </div>
      </div>

      <div className="px-8 py-6 print:px-0">
        <div className="billing-document__dates grid gap-6 md:grid-cols-[1fr_1fr_auto] md:items-start">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
              Invoice date
            </p>
            <p className="mt-3 text-2xl font-semibold">{formatDate(invoice.createdAt)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
              Due date
            </p>
            <p className="mt-3 text-2xl font-semibold">
              {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
            </p>
          </div>
          <div className="md:justify-self-end">
            <InvoiceStatusBadge status={invoice.status} />
          </div>
        </div>
      </div>

      <div className="px-8 py-6 print:px-0">
        <div className="billing-document__parties grid gap-0 md:grid-cols-2 md:divide-x md:divide-[#222527] print:md:divide-[#d7d1c6]">
          <section className="pb-6 md:pr-8 md:pb-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
              Bill from
            </p>
            <div className="mt-4 space-y-1 text-base leading-8 text-[#f7f3eb] print:text-[#161819]">
              <p className="font-semibold">HyperCLI</p>
              <p>Console billing</p>
              <p>mail.hypercli.com</p>
              <p>support@hypercli.com</p>
            </div>
          </section>
          <section className="pt-6 md:pl-8 md:pt-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
              Bill to
            </p>
            <div className="mt-4 space-y-1 text-base leading-8 text-[#f7f3eb] print:text-[#161819]">
              <p className="font-semibold">Authenticated Console account</p>
              <p className="font-mono text-sm break-all">{invoice.userId || "—"}</p>
            </div>
          </section>
        </div>
      </div>

      <div className="px-8 py-6 print:px-0">
        <div className="overflow-hidden rounded-2xl border border-[#222527] print:border-[#d7d1c6]">
          <table className="min-w-full divide-y divide-[#222527] print:divide-[#d7d1c6]">
            <colgroup>
              <col />
              <col style={{ width: "80px" }} />
              <col style={{ width: "140px" }} />
              <col style={{ width: "140px" }} />
            </colgroup>
            <thead className="bg-[#111314] print:bg-white">
              <tr>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
                  Description
                </th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
                  Qty
                </th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
                  Unit price
                </th>
                <th className="px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#222527] bg-[#111314] print:divide-[#ebe4d8] print:bg-white">
              {lineItems.length > 0 ? (
                lineItems.map((tx) => (
                  <tr key={tx.id}>
                    <td className="px-5 py-5 align-top">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getTypeBadgeClass(
                              tx.transactionType,
                            )}`}
                          >
                            {tx.transactionType}
                          </span>
                          <InvoiceStatusBadge status={tx.status} />
                        </div>
                        {getTransactionHref ? (
                          <Link
                            href={getTransactionHref(tx.id)}
                            className="font-mono text-xs text-[#38d39f] hover:underline"
                          >
                            {tx.id}
                          </Link>
                        ) : (
                          <div className="font-mono text-xs text-[#b5babd] print:text-[#5f584e]">{tx.id}</div>
                        )}
                        <div className="text-sm text-[#b5babd] print:text-[#5f584e]">
                          Recorded {formatDateTimeShort(tx.createdAt)}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-5 align-top text-lg text-[#f7f3eb] print:text-[#161819]">1</td>
                    <td className="px-5 py-5 align-top text-lg text-[#f7f3eb] print:text-[#161819]">
                      {formatUsdAmount(tx.amountUsd)}
                    </td>
                    <td className="px-5 py-5 align-top text-lg text-[#f7f3eb] print:text-[#161819]">
                      {formatUsdAmount(tx.amountUsd)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-12 text-center text-sm text-[#8f9699] print:text-[#6e675d]"
                  >
                    No linked charges yet.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="bg-[#111314] print:bg-white">
              <tr>
                <td className="px-5 py-2" colSpan={2} />
                <td className="px-5 py-2 text-lg text-[#b5babd] print:text-[#5f584e]">Subtotal</td>
                <td className="px-5 py-2 text-lg text-[#b5babd] print:text-[#5f584e]">
                  {formatUsdAmount(invoice.amountUsd)}
                </td>
              </tr>
              <tr>
                <td className="px-5 py-2" colSpan={2} />
                <td className="px-5 py-2 text-[13px] font-semibold uppercase tracking-[0.2em] text-[#8f9699] print:text-[#6e675d]">
                  Total
                </td>
                <td className="px-5 py-2 text-lg font-bold text-[#f7f3eb] print:text-[#161819]">
                  {formatUsdAmount(invoice.amountUsd)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-10 pt-6 print:mt-6 print:pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
            Notes
          </p>
          <p className="mt-4 text-sm leading-7 text-[#b5babd] print:text-[#5f584e]">
            {invoice.notes || "No invoice notes were attached to this billing record."}
          </p>
        </div>
      </div>
    </article>
  );
}
