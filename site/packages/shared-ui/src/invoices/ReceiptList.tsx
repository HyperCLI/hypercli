import type { ReactNode } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { formatDateTimeShort } from "../utils/datetime";
import { getTypeBadgeClass } from "../utils/badges";
import { formatUsdAmount } from "./format";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";
import type { ReceiptRecord } from "./types";

interface ReceiptListProps {
  receipts: ReceiptRecord[];
  title?: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  formatAmount?: (receipt: ReceiptRecord) => string;
  renderActions?: (receipt: ReceiptRecord) => ReactNode;
  renderMeta?: (receipt: ReceiptRecord) => ReactNode;
}

export function ReceiptList({
  receipts,
  title = "Receipts",
  description = "Top-ups and usage charges tied to your Console account.",
  emptyTitle = "No receipts yet",
  emptyDescription = "Completed top-ups and charges will appear here.",
  formatAmount = (receipt) => formatUsdAmount(receipt.amountUsd),
  renderActions,
  renderMeta,
}: ReceiptListProps) {
  return (
    <Card className="border-border bg-surface-low">
      <CardHeader>
        <CardTitle className="text-foreground">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {receipts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-background px-6 py-10 text-center">
            <p className="text-base font-semibold text-foreground">{emptyTitle}</p>
            <p className="mt-2 text-sm text-muted-foreground">{emptyDescription}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Details</TableHead>
                  {renderActions ? <TableHead className="text-right">Action</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell className="align-top">
                      <div className="font-medium text-foreground">{receipt.id.slice(0, 8)}</div>
                      <div className="font-mono text-xs text-muted-foreground">{receipt.id}</div>
                    </TableCell>
                    <TableCell className="align-top">
                      <span
                        className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getTypeBadgeClass(
                          receipt.transactionType,
                        )}`}
                      >
                        {receipt.transactionType.toLowerCase()}
                      </span>
                    </TableCell>
                    <TableCell className="align-top">
                      <InvoiceStatusBadge status={receipt.status} />
                    </TableCell>
                    <TableCell className="align-top font-medium text-foreground">
                      {formatAmount(receipt)}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatDateTimeShort(receipt.createdAt)}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="space-y-1 text-sm">
                        <p className="text-foreground">
                          {receipt.rewards ? "Rewards credit" : "Paid balance activity"}
                        </p>
                        {renderMeta ? renderMeta(receipt) : null}
                      </div>
                    </TableCell>
                    {renderActions ? (
                      <TableCell className="align-top text-right">
                        {renderActions(receipt)}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
