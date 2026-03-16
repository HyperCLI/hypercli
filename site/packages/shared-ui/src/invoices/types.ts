export interface InvoiceTransaction {
  id: string;
  amountUsd: string;
  transactionType: string;
  status: string;
  createdAt: string | number;
  updatedAt: string | number;
  meta: Record<string, any> | null;
}

export interface InvoiceRecord {
  id: string;
  invoiceId: string | null;
  userId?: string | null;
  amountUsd: string;
  status: string;
  notes?: string | null;
  dueDate?: string | number | null;
  createdAt: string | number;
  updatedAt: string | number;
  meta?: Record<string, any> | null;
  transactions?: InvoiceTransaction[];
}

export interface ReceiptRecord {
  id: string;
  userId?: string | null;
  amountUsd: string;
  status: string;
  transactionType: string;
  rewards?: boolean;
  expiresAt?: string | number | null;
  jobId?: string | null;
  createdAt: string | number;
  updatedAt: string | number;
  meta?: Record<string, any> | null;
}
