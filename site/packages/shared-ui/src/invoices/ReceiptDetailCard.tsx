import { formatDate, formatDateTimeShort } from "../utils/datetime";
import { getTypeBadgeClass } from "../utils/badges";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";
import { PrintActions } from "./PrintActions";
import type { ReceiptRecord } from "./types";

interface ReceiptDetailCardProps {
  receipt: ReceiptRecord;
  title?: string;
  description?: string;
}

function getSettlementRows(meta: Record<string, any> | null | undefined): Array<{ label: string; value: string; href?: string }> {
  if (!meta) return [];

  const paymentMethod = String(meta.payment_method || "").toLowerCase();
  const rows: Array<{ label: string; value: string; href?: string }> = [];

  if (paymentMethod === "stripe") {
    if (meta.card_last4) {
      rows.push({ label: "Card", value: `•••• ${String(meta.card_last4)}` });
    }
    if (!rows.length && meta.stripe_payment_intent) {
      rows.push({ label: "Payment reference", value: String(meta.stripe_payment_intent) });
    }
    return rows;
  }

  if (meta.settlement_tx_hash) {
    const txHash = String(meta.settlement_tx_hash);
    rows.push({
      label: "Base transaction",
      value: txHash,
      href: `https://basescan.org/tx/${txHash}`,
    });
  }
  if (meta.wallet) {
    const wallet = String(meta.wallet);
    rows.push({
      label: "Wallet used",
      value: wallet,
      href: `https://basescan.org/address/${wallet}`,
    });
  }

  return rows;
}

export function ReceiptDetailCard({
  receipt,
  title = "Receipt",
  description = "Payment and settlement record for your Console account.",
}: ReceiptDetailCardProps) {
  const settlementRows = getSettlementRows(receipt.meta);
  const lineTitle =
    receipt.transactionType.toLowerCase() === "top_up" ? "Account top-up" : receipt.transactionType;

  return (
    <article className="billing-document mx-auto max-w-5xl overflow-hidden rounded-[28px] border border-[#2a2d2f] bg-[#111314] text-[#f7f3eb] shadow-[0_32px_120px_rgba(0,0,0,0.35)] print:max-w-none print:rounded-none print:border-0 print:bg-white print:text-[#161819] print:shadow-none">
      <div className="border-b border-[#222527] px-8 py-8 print:border-[#d7d1c6] print:px-0">
        <div className="billing-document__header grid gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-[#161819] px-3 py-1 text-xs font-bold uppercase tracking-[0.28em] text-[#38d39f] print:bg-[#161819] print:text-[#38d39f]">
                HyperCLI
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
                Receipt
              </p>
            </div>
            <div>
              <h2 className="text-4xl font-bold tracking-tight">{title}</h2>
              <p className="mt-2 max-w-2xl text-sm text-[#b5babd] print:text-[#5f584e]">{description}</p>
            </div>
          </div>

          <div className="flex flex-col items-start gap-4">
            <div className="text-left">
              <p className="text-3xl font-bold tracking-tight">{lineTitle}</p>
              <p className="mt-2 font-mono text-xs text-[#8f9699] print:text-[#6e675d] break-all">
                {receipt.id}
              </p>
            </div>
            <PrintActions />
          </div>
        </div>
      </div>

      <div className="border-b border-[#222527] px-8 py-6 print:border-[#d7d1c6] print:px-0">
        <div className="billing-document__dates grid gap-6 md:grid-cols-[1fr_1fr_auto] md:items-start">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
              Receipt date
            </p>
            <p className="mt-3 text-2xl font-semibold">{formatDate(receipt.createdAt)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
              Updated
            </p>
            <p className="mt-3 text-2xl font-semibold">{formatDate(receipt.updatedAt)}</p>
          </div>
          <div className="md:justify-self-end">
            <InvoiceStatusBadge status={receipt.status} />
          </div>
        </div>
      </div>

      <div className="border-b border-[#222527] px-8 py-6 print:border-[#d7d1c6] print:px-0">
        <div className="billing-document__parties grid gap-0 md:grid-cols-2 md:divide-x md:divide-[#222527] print:md:divide-[#d7d1c6]">
          <section className="pb-6 md:pr-8 md:pb-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
              Receipt from
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
              Paid by
            </p>
            <div className="mt-4 space-y-1 text-base leading-8 text-[#f7f3eb] print:text-[#161819]">
              <p className="font-semibold">Authenticated Console account</p>
              <p className="font-mono text-sm break-all">{receipt.userId || "—"}</p>
            </div>
          </section>
        </div>
      </div>

      <div className="px-8 py-6 print:px-0">
        <div className="overflow-hidden rounded-2xl border border-[#222527] print:border-[#d7d1c6]">
          <table className="min-w-full divide-y divide-[#222527] print:divide-[#d7d1c6]">
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
            <tbody className="bg-[#111314] print:bg-white">
              <tr>
                <td className="px-5 py-5 align-top">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getTypeBadgeClass(
                          receipt.transactionType,
                        )}`}
                      >
                        {receipt.transactionType.toLowerCase()}
                      </span>
                      <InvoiceStatusBadge status={receipt.status} />
                    </div>
                    <div className="text-sm text-[#f7f3eb] print:text-[#161819]">{lineTitle}</div>
                    <div className="font-mono text-xs text-[#b5babd] print:text-[#5f584e]">{receipt.id}</div>
                  </div>
                </td>
                <td className="px-5 py-5 align-top text-lg text-[#f7f3eb] print:text-[#161819]">1</td>
                <td className="px-5 py-5 align-top text-lg text-[#f7f3eb] print:text-[#161819]">
                  ${receipt.amountUsd}
                </td>
                <td className="px-5 py-5 align-top text-lg font-semibold text-[#f7f3eb] print:text-[#161819]">
                  ${receipt.amountUsd}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-8 flex justify-end">
          <div className="w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between text-lg text-[#b5babd] print:text-[#5f584e]">
              <span>Subtotal</span>
              <span>${receipt.amountUsd}</span>
            </div>
            <div className="border-t border-[#222527] pt-4 print:border-[#d7d1c6]">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold uppercase tracking-[0.2em] text-[#8f9699] print:text-[#6e675d]">
                  Total paid
                </span>
                <span className="text-4xl font-bold tracking-tight">${receipt.amountUsd}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-[#222527] pt-6 print:border-[#d7d1c6]">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
                Accounting note
              </p>
              <p className="mt-4 text-sm leading-7 text-[#b5babd] print:text-[#5f584e]">
                This receipt reflects account funding or usage activity captured in HyperCLI billing.
                Save it as a PDF if you need a stable accounting artifact.
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8f9699] print:text-[#6e675d]">
                Settlement metadata
              </p>
              {settlementRows.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-[#222527] print:border-[#d7d1c6]">
                  <div className="divide-y divide-[#222527] print:divide-[#ebe4d8]">
                    {settlementRows.map((row) => (
                      <div
                        key={row.label}
                        className="grid gap-2 px-4 py-3 md:grid-cols-[160px_minmax(0,1fr)]"
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8f9699] print:text-[#6e675d]">
                          {row.label}
                        </div>
                        {row.href ? (
                          <a
                            href={row.href}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-xs text-[#38d39f] break-all hover:underline"
                          >
                            {row.value}
                          </a>
                        ) : (
                          <div className="font-mono text-xs text-[#f7f3eb] print:text-[#161819] break-all">
                            {row.value}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-4 text-sm text-[#8f9699] print:text-[#6e675d]">
                  No settlement metadata on this receipt.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
