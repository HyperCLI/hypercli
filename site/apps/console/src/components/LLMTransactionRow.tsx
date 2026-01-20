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

interface LLMTransactionRowProps {
  tx: Transaction;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function LLMTransactionRow({ tx, isExpanded, onToggle }: LLMTransactionRowProps) {
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
            {tx.id.slice(0, 8)}...
          </span>
        </td>
        <td className="px-6 py-4 whitespace-nowrap w-28">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getTypeBadgeClass('llm')}`}>
              llm
            </span>
            {tx.rewards && (
              <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getTypeBadgeClass('rewards')}`}>
                rewards
              </span>
            )}
          </div>
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          {meta.model ? (
            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getTypeBadgeClass('llm')}`}>
              {meta.model}
            </span>
          ) : (
            <span className="text-sm text-tertiary-foreground">-</span>
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

              {meta.model && (
                <div>
                  <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                    Model
                  </h3>
                  <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getTypeBadgeClass('llm')}`}>
                    {meta.model}
                  </span>
                </div>
              )}

              {meta.prompt_tokens !== undefined && (
                <div>
                  <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                    Prompt Tokens
                  </h3>
                  <p className="text-foreground">{meta.prompt_tokens.toLocaleString()}</p>
                </div>
              )}

              {meta.completion_tokens !== undefined && (
                <div>
                  <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                    Completion Tokens
                  </h3>
                  <p className="text-foreground">{meta.completion_tokens.toLocaleString()}</p>
                </div>
              )}

              {meta.total_tokens !== undefined && (
                <div>
                  <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                    Total Tokens
                  </h3>
                  <p className="text-foreground font-semibold">{meta.total_tokens.toLocaleString()}</p>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                  Cost
                </h3>
                <AmountDisplay amountUsd={tx.amount_usd} />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-tertiary-foreground uppercase tracking-wider mb-2">
                  Created At
                </h3>
                <p className="text-foreground">{formatDateTime(tx.created_at)}</p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}
