"use client";

import React, { useEffect, useState } from "react";
import { Header, Footer, useAuth, formatDateTime, getBadgeClass, getAuthBackendUrl } from "@hypercli/shared-ui";
import { useRouter } from "next/navigation";
import JobTransactionRow from "../../components/JobTransactionRow";
import TopUpTransactionRow from "../../components/TopUpTransactionRow";
import LLMTransactionRow from "../../components/LLMTransactionRow";
import InvoiceTransactionRow from "../../components/InvoiceTransactionRow";
import RenderTransactionRow from "../../components/RenderTransactionRow";

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

type SortColumn = 'id' | 'type' | 'status' | 'amount' | 'created_at';
type SortDirection = 'asc' | 'desc';

export default function HistoryPage() {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalTxCount, setTotalTxCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTransactions();
    }
  }, [isAuthenticated, currentPage, typeFilter]);

  const fetchTransactions = async () => {
    setLoading(true);
    setError(null);
    try {
      const authToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('auth_token='))
        ?.split('=')[1];

      if (!authToken) {
        setError('No auth token found');
        setLoading(false);
        return;
      }

      let url = getAuthBackendUrl(`/tx?page=${currentPage}&page_size=${pageSize}`);
      if (typeFilter !== "all") {
        url += `&transaction_type=${typeFilter}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setTransactions(data.transactions || []);
        setTotalTxCount(data.total_count || 0);
      } else {
        const errorData = await response.json();
        setError(errorData.detail || 'Failed to load transactions');
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection(column === 'created_at' ? 'desc' : 'asc');
    }
  };

  const sortedTransactions = [...transactions].sort((a, b) => {
    let aValue: any;
    let bValue: any;

    switch (sortColumn) {
      case 'id':
        aValue = a.job_id || a.id;
        bValue = b.job_id || b.id;
        break;
      case 'type':
        aValue = a.transaction_type;
        bValue = b.transaction_type;
        break;
      case 'status':
        aValue = a.status;
        bValue = b.status;
        break;
      case 'amount':
        aValue = Math.abs(parseFloat(a.amount_usd));
        bValue = Math.abs(parseFloat(b.amount_usd));
        break;
      case 'created_at':
        aValue = new Date(a.created_at).getTime();
        bValue = new Date(b.created_at).getTime();
        break;
      default:
        return 0;
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const handleTransactionToggle = (txId: string) => {
    setExpandedTxId(expandedTxId === txId ? null : txId);
  };

  const handleFilterChange = (filter: string) => {
    setTypeFilter(filter);
    setCurrentPage(1);
  };

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0B0D0E]">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-[#0B0D0E]">
      <Header />

      <main className="flex-1 pt-20 relative">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-4xl font-bold text-white">Transaction History</h1>
          </div>

          {/* Type Filter */}
          <div className="flex gap-2 mb-8">
            {['all', 'job', 'render', 'llm', 'top_up', 'invoice'].map((type) => (
              <button
                key={type}
                onClick={() => handleFilterChange(type)}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
                  typeFilter === type
                    ? 'bg-[#38D39F] text-[#0B0D0E]'
                    : 'border border-[#2A2D2F] text-[#D4D6D7] hover:bg-[#161819] hover:border-[#38D39F]'
                }`}
              >
                {type === 'top_up' ? 'Top Up' : type === 'llm' ? 'LLM' : type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>

          {loading && <div className="text-[#9BA0A2]">Loading transactions...</div>}
          {error && <div className="text-[#D05F5F] mb-4">Error: {typeof error === 'string' ? error : JSON.stringify(error)}</div>}

          {!loading && !error && transactions.length === 0 && (
            <div className="bg-[#161819] border border-[#2A2D2F] p-8 rounded-lg text-center">
              <p className="text-[#9BA0A2] mb-4">No transactions found.</p>
            </div>
          )}

          {!loading && transactions.length > 0 && (
            <div className="bg-[#161819] border border-[#2A2D2F] rounded-lg overflow-x-auto">
              <table className="min-w-full divide-y divide-[#2A2D2F]">
                <thead className="bg-[#0B0D0E]">
                  <tr>
                    <th
                      className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider cursor-pointer hover:bg-[#1D1F21] w-24"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center gap-1">
                        Status
                        {sortColumn === 'status' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider cursor-pointer hover:bg-[#1D1F21] w-32"
                      onClick={() => handleSort('id')}
                    >
                      <div className="flex items-center gap-1">
                        ID
                        {sortColumn === 'id' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider cursor-pointer hover:bg-[#1D1F21] w-28"
                      onClick={() => handleSort('type')}
                    >
                      <div className="flex items-center gap-1">
                        Type
                        {sortColumn === 'type' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider">
                      Details
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider cursor-pointer hover:bg-[#1D1F21]"
                      onClick={() => handleSort('amount')}
                    >
                      <div className="flex items-center gap-1">
                        Amount
                        {sortColumn === 'amount' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider cursor-pointer hover:bg-[#1D1F21]"
                      onClick={() => handleSort('created_at')}
                    >
                      <div className="flex items-center gap-1">
                        Date
                        {sortColumn === 'created_at' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider">
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-[#161819] divide-y divide-[#2A2D2F]">
                  {sortedTransactions.map((tx) => {
                    if (tx.transaction_type === 'job') {
                      return (
                        <JobTransactionRow
                          key={tx.id}
                          tx={tx}
                          isExpanded={expandedTxId === tx.id}
                          onToggle={() => handleTransactionToggle(tx.id)}
                        />
                      );
                    } else if (tx.transaction_type === 'top_up') {
                      return (
                        <TopUpTransactionRow
                          key={tx.id}
                          tx={tx}
                          isExpanded={expandedTxId === tx.id}
                          onToggle={() => handleTransactionToggle(tx.id)}
                        />
                      );
                    } else if (tx.transaction_type === 'llm') {
                      return (
                        <LLMTransactionRow
                          key={tx.id}
                          tx={tx}
                          isExpanded={expandedTxId === tx.id}
                          onToggle={() => handleTransactionToggle(tx.id)}
                        />
                      );
                    } else if (tx.transaction_type === 'invoice') {
                      return (
                        <InvoiceTransactionRow
                          key={tx.id}
                          tx={tx}
                          isExpanded={expandedTxId === tx.id}
                          onToggle={() => handleTransactionToggle(tx.id)}
                        />
                      );
                    } else if (tx.transaction_type === 'render') {
                      return (
                        <RenderTransactionRow
                          key={tx.id}
                          tx={tx}
                          isExpanded={expandedTxId === tx.id}
                          onToggle={() => handleTransactionToggle(tx.id)}
                        />
                      );
                    }
                    return null;
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="bg-[#0B0D0E] px-6 py-3 flex items-center justify-between border-t border-[#2A2D2F]">
                <div className="text-sm text-[#9BA0A2]">
                  <span className="font-medium text-white">{(currentPage - 1) * pageSize + 1}</span>
                  {' - '}
                  <span className="font-medium text-white">{Math.min(currentPage * pageSize, totalTxCount)}</span>
                  {' of '}
                  <span className="font-medium text-white">{totalTxCount}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 border border-[#2A2D2F] rounded text-sm font-medium text-[#D4D6D7] hover:bg-[#161819] hover:border-[#38D39F] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => p + 1)}
                    disabled={currentPage * pageSize >= totalTxCount}
                    className="px-3 py-1.5 border border-[#2A2D2F] rounded text-sm font-medium text-[#D4D6D7] hover:bg-[#161819] hover:border-[#38D39F] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
