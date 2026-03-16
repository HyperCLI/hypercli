"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Header,
  Footer,
  useAuth,
  InvoiceList,
  ReceiptList,
  InvoiceSummaryCard,
  type InvoiceRecord,
  type ReceiptRecord,
} from "@hypercli/shared-ui";
import { useRouter } from "next/navigation";

import {
  getConsoleInvoices,
  getConsoleTransactions,
  type ConsoleInvoice,
  type ConsoleTransaction,
} from "../../lib/sdk";

function mapInvoice(invoice: ConsoleInvoice): InvoiceRecord {
  return {
    id: invoice.id,
    invoiceId: invoice.invoice_id,
    userId: invoice.user_id,
    amountUsd: invoice.amount_usd,
    status: invoice.status,
    notes: invoice.notes,
    dueDate: invoice.due_date,
    createdAt: invoice.created_at,
    updatedAt: invoice.updated_at,
    meta: invoice.meta,
    transactions: invoice.transactions.map((tx) => ({
      id: tx.id,
      amountUsd: tx.amount_usd,
      transactionType: tx.transaction_type,
      status: tx.status,
      createdAt: tx.created_at,
      updatedAt: tx.updated_at,
      meta: tx.meta,
    })),
  };
}

function mapReceipt(receipt: ConsoleTransaction): ReceiptRecord {
  return {
    id: receipt.id,
    userId: receipt.user_id,
    amountUsd: receipt.amount_usd,
    status: receipt.status,
    transactionType: receipt.transaction_type,
    rewards: receipt.rewards,
    expiresAt: receipt.expires_at,
    jobId: receipt.job_id,
    createdAt: receipt.created_at,
    updatedAt: receipt.updated_at,
    meta: receipt.meta,
  };
}

export default function BillingPage() {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [txData, invoiceData] = await Promise.all([
          getConsoleTransactions({ page: 1, pageSize: 50 }),
          getConsoleInvoices({ page: 1, pageSize: 50 }),
        ]);
        if (!cancelled) {
          setReceipts(txData.transactions.map(mapReceipt));
          setInvoices(invoiceData.invoices.map(mapInvoice));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load billing records");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const paidCount = useMemo(
    () => invoices.filter((invoice) => invoice.status === "paid").length,
    [invoices],
  );
  const topUpCount = useMemo(
    () => receipts.filter((receipt) => receipt.transactionType.toLowerCase() === "top_up").length,
    [receipts],
  );
  const issuedCount = useMemo(
    () => invoices.filter((invoice) => invoice.status === "issued" || invoice.status === "processing").length,
    [invoices],
  );

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-foreground text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-background">
      <Header />
      <main className="flex-1 pt-20 relative">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-4xl font-bold text-foreground">Billing</h1>
            <p className="text-muted-foreground">
              Receipts for top-ups and charges, plus enterprise invoices when your account uses them.
            </p>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-3">
            <InvoiceSummaryCard
              label="Receipts"
              value={String(receipts.length)}
              description="Top-ups and usage charges tied to this account."
            />
            <InvoiceSummaryCard
              label="Top Ups"
              value={String(topUpCount)}
              description="Completed account funding events in your receipt history."
            />
            <InvoiceSummaryCard
              label="Invoices"
              value={String(invoices.length)}
              description="Enterprise invoice records, if your account is billed that way."
            />
          </div>

          {loading ? (
            <div className="rounded-lg border border-border bg-surface-low px-6 py-10 text-center text-muted-foreground">
              Loading billing records...
            </div>
          ) : (
            <div className="space-y-8">
              <ReceiptList
                receipts={receipts}
                title="Receipts"
                description="Use the transaction UUID directly in the URL for receipt detail views."
                emptyTitle="No receipts yet"
                emptyDescription="Completed top-ups and charges will appear here."
                renderActions={(receipt) => (
                  <Link
                    href={`/billing/${receipt.id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Open
                  </Link>
                )}
              />

              <InvoiceList
                invoices={invoices}
                title="Invoices"
                description="Use the invoice UUID directly in the URL for enterprise billing detail views."
                emptyTitle="No invoices yet"
                emptyDescription="Most Console users will only see invoices if they are billed through the enterprise flow."
                renderActions={(invoice) => (
                  <Link
                    href={`/billing/${invoice.id}`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Open
                  </Link>
                )}
              />

              {invoices.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <InvoiceSummaryCard
                    label="Open invoices"
                    value={String(issuedCount)}
                    description="Issued or processing invoices that still need attention."
                  />
                  <InvoiceSummaryCard
                    label="Paid invoices"
                    value={String(paidCount)}
                    description="Invoices already settled and credited."
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
