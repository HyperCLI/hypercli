"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Footer,
  Header,
  InvoiceDetailCard,
  type InvoiceRecord,
  ReceiptDetailCard,
  type ReceiptRecord,
  useAuth,
} from "@hypercli/shared-ui";

import {
  getConsoleInvoice,
  getConsoleTransaction,
  type ConsoleInvoice,
  type ConsoleTransaction,
} from "../../../lib/sdk";

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

export default function BillingInvoiceDetailPage() {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [receipt, setReceipt] = useState<ReceiptRecord | null>(null);
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (!isAuthenticated || !params?.id) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [transactionResult, invoiceResult] = await Promise.allSettled([
          getConsoleTransaction(params.id),
          getConsoleInvoice(params.id),
        ]);

        if (cancelled) {
          return;
        }

        if (transactionResult.status === "fulfilled") {
          setReceipt(mapReceipt(transactionResult.value));
          setInvoice(null);
        } else if (invoiceResult.status === "fulfilled") {
          setInvoice(mapInvoice(invoiceResult.value));
          setReceipt(null);
        } else {
          throw new Error("Billing record not found");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load billing record");
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
  }, [isAuthenticated, params?.id]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-foreground text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-background print:bg-white">
      <div className="billing-page-chrome print:hidden">
        <Header />
      </div>
      <main className="flex-1 pt-20 relative print:pt-0">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
          <div className="billing-page-chrome flex flex-col gap-3 print:hidden">
            <Link href="/billing" className="text-sm font-medium text-primary hover:underline">
              ← Back to billing
            </Link>
            <div>
              <h1 className="text-4xl font-bold text-foreground">
                {receipt ? "Receipt" : "Invoice"}
              </h1>
              <p className="text-muted-foreground">
                UUID-backed billing detail view for Console receipts and enterprise invoices.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="rounded-lg border border-border bg-surface-low px-6 py-10 text-center text-muted-foreground">
              Loading billing record...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          ) : receipt ? (
            <ReceiptDetailCard receipt={receipt} />
          ) : invoice ? (
            <InvoiceDetailCard invoice={invoice} />
          ) : (
            <div className="rounded-lg border border-border bg-surface-low px-6 py-10 text-center text-muted-foreground">
              Billing record not found.
            </div>
          )}
        </div>
      </main>
      <div className="billing-page-chrome print:hidden">
        <Footer />
      </div>
    </div>
  );
}
