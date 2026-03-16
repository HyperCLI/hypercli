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
import { formatDate, formatDateTimeShort } from "../utils/datetime";
import { InvoiceRecord } from "./types";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";

interface InvoiceListProps {
  invoices: InvoiceRecord[];
  title?: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  amountLabel?: string;
  renderActions?: (invoice: InvoiceRecord) => ReactNode;
  renderMeta?: (invoice: InvoiceRecord) => ReactNode;
}

export function InvoiceList({
  invoices,
  title = "Invoices",
  description = "Invoice records and accounting references.",
  emptyTitle = "No invoices yet",
  emptyDescription = "Invoices will appear here once billing records are issued.",
  amountLabel = "Amount",
  renderActions,
  renderMeta,
}: InvoiceListProps) {
  return (
    <Card className="border-border bg-surface-low">
      <CardHeader>
        <CardTitle className="text-foreground">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-background px-6 py-10 text-center">
            <p className="text-base font-semibold text-foreground">{emptyTitle}</p>
            <p className="mt-2 text-sm text-muted-foreground">{emptyDescription}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>{amountLabel}</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Details</TableHead>
                  {renderActions ? <TableHead className="text-right">Action</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="align-top">
                      <div className="font-medium text-foreground">
                        {invoice.invoiceId || invoice.id.slice(0, 8)}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{invoice.id}</div>
                    </TableCell>
                    <TableCell className="align-top">
                      <InvoiceStatusBadge status={invoice.status} />
                    </TableCell>
                    <TableCell className="align-top font-medium text-foreground">
                      ${invoice.amountUsd}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {invoice.dueDate ? formatDate(invoice.dueDate) : "—"}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatDateTimeShort(invoice.createdAt)}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="space-y-1 text-sm">
                        {invoice.notes ? (
                          <p className="text-foreground">{invoice.notes}</p>
                        ) : (
                          <p className="text-muted-foreground">No notes</p>
                        )}
                        {renderMeta ? renderMeta(invoice) : null}
                      </div>
                    </TableCell>
                    {renderActions ? (
                      <TableCell className="align-top text-right">
                        {renderActions(invoice)}
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
