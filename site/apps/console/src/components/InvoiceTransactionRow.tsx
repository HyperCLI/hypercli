"use client";

import React from "react";
import { formatDateTime, getBadgeClass, getTypeBadgeClass } from "@hypercli/shared-ui";
import AmountDisplay from "./AmountDisplay";

interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  amount_usd: string;
  transaction_type: string;
  status: string;
  rewards: boolean;
  expires_at: string | null;
  job_id: string | null;
  meta: any;
  created_at: string;
  updated_at: string;
}

interface InvoiceTransactionRowProps {
  tx: Transaction;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function InvoiceTransactionRow({ tx, isExpanded, onToggle }: InvoiceTransactionRowProps) {
  const meta = tx.meta || {};

  return (
    <React.Fragment>
      <tr
        onClick={onToggle}
        className="cursor-pointer hover:bg-surface-low transition-colors"
      >
        <td className="px-6 py-4 whitespace-nowrap w-24">
          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getBadgeClass(tx.status)}`}>
            {tx.status.toLowerCase()}
          </span>
        </td>
        <td className="px-6 py-4 whitespace-nowrap w-32">
          <span className="font-mono text-sm text-muted-foreground">
            {meta.invoice_id || tx.id.slice(0, 8) + '...'}
          </span>
        </td>
        <td className="px-6 py-4 whitespace-nowrap w-28">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getTypeBadgeClass('invoice')}`}>
              invoice
            </span>
          </div>
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          {meta.payment_method ? (
            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getTypeBadgeClass('job')}`}>
              {meta.payment_method === 'bank_transfer' || meta.payment_method === 'wire' ? 'Wire' : meta.payment_method}
            </span>
          ) : (
            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getBadgeClass(tx.status)}`}>
              {tx.status.toLowerCase()}
            </span>
          )}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
          <AmountDisplay amountUsd={tx.amount_usd} />
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
          {formatDateTime(tx.created_at)}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          <svg
            className={`w-5 h-5 text-tertiary-foreground transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} className="px-6 py-4 bg-background">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                  Transaction ID
                </h3>
                <p className="font-mono text-sm text-foreground">{tx.id}</p>
              </div>

              {meta.invoice_id && (
                <div>
                  <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                    Invoice ID
                  </h3>
                  <p className="font-mono text-sm text-foreground">{meta.invoice_id}</p>
                </div>
              )}

              {meta.invoice_uuid && (
                <div>
                  <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                    Invoice UUID
                  </h3>
                  <p className="font-mono text-sm text-foreground">{meta.invoice_uuid}</p>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                  Status
                </h3>
                <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getBadgeClass(tx.status)}`}>
                  {tx.status.toLowerCase()}
                </span>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                  Amount
                </h3>
                <AmountDisplay amountUsd={tx.amount_usd} className="font-semibold" />
              </div>

              {meta.invoice_amount_usd && meta.invoice_amount_usd !== tx.amount_usd && (
                <div>
                  <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                    Invoice Amount
                  </h3>
                  <p className="text-foreground">${meta.invoice_amount_usd}</p>
                </div>
              )}

              {meta.payment_method && (
                <div>
                  <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                    Payment Method
                  </h3>
                  <p className="text-foreground">{meta.payment_method}</p>
                </div>
              )}

              {meta.reference && (
                <div>
                  <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                    Reference
                  </h3>
                  <p className="font-mono text-sm text-foreground">{meta.reference}</p>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                  Created At
                </h3>
                <p className="text-foreground">{formatDateTime(tx.created_at)}</p>
              </div>

              {tx.updated_at && tx.updated_at !== tx.created_at && (
                <div>
                  <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                    Updated At
                  </h3>
                  <p className="text-foreground">{formatDateTime(tx.updated_at)}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}
