"use client";

import React, { useEffect, useState, useRef } from "react";
import { Header, Footer, useAuth, TopUpModal, AlertDialog, formatDateTime } from "@hypercli/shared-ui";
import { useRouter } from "next/navigation";
import JobTransactionRow from "../../components/JobTransactionRow";
import TopUpTransactionRow from "../../components/TopUpTransactionRow";
import LLMTransactionRow from "../../components/LLMTransactionRow";
import InvoiceTransactionRow from "../../components/InvoiceTransactionRow";

interface UserProfile {
  user_id: string;
  name: string | null;
  email: string | null;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
  is_active: boolean;
  user_type: string;
  meta: string | null;
}

interface Balance {
  user_id: string;
  balance: string;
  balance_units: number;
  rewards_balance: string;
  rewards_balance_units: number;
  total_balance: string;
  total_balance_units: number;
  currency: string;
  decimals: number;
}

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

export default function DashboardPage() {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isEditing, setIsEditing] = useState<{ name: boolean; email: boolean }>({ name: false, email: false });
  const [editValues, setEditValues] = useState({ name: "", email: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [balance, setBalance] = useState<Balance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalTxCount, setTotalTxCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(10);
  const [txLoading, setTxLoading] = useState(false);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [showTopUpModal, setShowTopUpModal] = useState(false);

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingStartTimeRef = useRef<number>(0);
  const initialTxCountRef = useRef<number>(0);
  const [alertDialog, setAlertDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: "info" | "warning" | "error" | "success";
    onConfirm?: () => void | Promise<void>;
    showCancel?: boolean;
  }>({
    isOpen: false,
    title: "",
    message: "",
    type: "info",
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [isLoading, isAuthenticated, router]);

  // Fetch user profile, balance, and transactions
  useEffect(() => {
    if (isAuthenticated) {
      fetchUserProfile();
      fetchBalance();
      fetchTransactions();
    }
  }, [isAuthenticated]);

  // Refetch transactions when page changes
  useEffect(() => {
    if (isAuthenticated) {
      fetchTransactions();
    }
  }, [currentPage]);

  const fetchUserProfile = async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const authToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('auth_token='))
        ?.split('=')[1];

      console.log('🔍 Fetching user profile...');
      console.log('Auth token:', authToken ? 'Found' : 'Missing');
      console.log('Backend URL:', process.env.NEXT_PUBLIC_AUTH_BACKEND);

      if (!authToken) {
        setProfileError('No auth token found');
        setProfileLoading(false);
        return;
      }

      const url = `${process.env.NEXT_PUBLIC_AUTH_BACKEND}/user`;
      console.log('Fetching from:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('Response status:', response.status);

      if (response.ok) {
        const profile = await response.json();
        console.log('✅ Profile loaded:', profile);
        setUserProfile(profile);
        setEditValues({ name: profile.name || "", email: profile.email || "" });
      } else {
        const errorText = await response.text();
        console.error('❌ Failed to load profile:', response.status, errorText);
        setProfileError(`Failed to load profile: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Error fetching user profile:', error);
      setProfileError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleEdit = (field: 'name' | 'email') => {
    setIsEditing(prev => ({ ...prev, [field]: true }));
  };

  const handleCancel = (field: 'name' | 'email') => {
    setIsEditing(prev => ({ ...prev, [field]: false }));
    setEditValues(prev => ({ ...prev, [field]: userProfile?.[field] || "" }));
  };

  const handleSave = async (field: 'name' | 'email') => {
    setIsSaving(true);
    try {
      const authToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('auth_token='))
        ?.split('=')[1];

      if (!authToken) return;

      const response = await fetch(`${process.env.NEXT_PUBLIC_AUTH_BACKEND}/user`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ [field]: editValues[field] })
      });

      if (response.ok) {
        const updatedProfile = await response.json();
        setUserProfile(updatedProfile);
        setIsEditing(prev => ({ ...prev, [field]: false }));
      } else {
        const error = await response.json();
        setAlertDialog({
          isOpen: true,
          title: "Error",
          message: error.detail || 'Failed to update profile',
          type: "error",
        });
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      setAlertDialog({
        isOpen: true,
        title: "Error",
        message: 'Failed to update profile',
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const fetchBalance = async () => {
    try {
      const authToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('auth_token='))
        ?.split('=')[1];

      if (!authToken) return;

      const response = await fetch(`${process.env.NEXT_PUBLIC_AUTH_BACKEND}/balance`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setBalance(data);
      }
    } catch (error) {
      console.error('Error fetching balance:', error);
    }
  };

  const fetchTransactions = async () => {
    setTxLoading(true);
    try {
      const authToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('auth_token='))
        ?.split('=')[1];

      if (!authToken) return;

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_AUTH_BACKEND}/tx?page=${currentPage}&page_size=${pageSize}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setTransactions(data.transactions);
        setTotalTxCount(data.total_count);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setTxLoading(false);
    }
  };

  const handleTransactionToggle = (txId: string) => {
    setExpandedTxId(expandedTxId === txId ? null : txId);
  };

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const startTopUpPolling = () => {
    // Stop any existing polling
    stopPolling();

    // Store initial transaction count and start time
    initialTxCountRef.current = totalTxCount;
    pollingStartTimeRef.current = Date.now();

    // Poll immediately
    fetchBalance();
    fetchTransactions();

    // Poll every second
    pollingIntervalRef.current = setInterval(() => {
      const elapsedSeconds = (Date.now() - pollingStartTimeRef.current) / 1000;

      // Stop after 10 seconds
      if (elapsedSeconds >= 10) {
        console.log('Stopped polling: 10 second timeout reached');
        stopPolling();
        return;
      }

      // Fetch transactions
      fetchTransactionsForPolling();
    }, 1000);
  };

  const fetchTransactionsForPolling = async () => {
    try {
      const authToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('auth_token='))
        ?.split('=')[1];

      if (!authToken) return;

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_AUTH_BACKEND}/tx?page=${currentPage}&page_size=${pageSize}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        setTransactions(data.transactions);
        setTotalTxCount(data.total_count);

        // Stop polling if we got a new transaction
        if (data.total_count > initialTxCountRef.current) {
          console.log('Stopped polling: new transaction detected');
          stopPolling();
          // Refresh balance one more time
          fetchBalance();
        }
      }
    } catch (error) {
      console.error('Error fetching transactions during polling:', error);
    }
  };

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

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
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-4xl font-bold text-white">
              Console Dashboard
            </h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/keys')}
                className="border border-[#2A2D2F] text-[#D4D6D7] font-semibold py-2 px-6 rounded-lg hover:bg-[#161819] hover:border-[#38D39F] transition-colors"
              >
                API Keys
              </button>
              <button
                onClick={() => router.push('/job')}
                className="bg-[#38D39F] text-[#0B0D0E] font-semibold py-2 px-6 rounded-lg hover:bg-[#45E4AE] transition-colors"
              >
                Launch GPU
              </button>
            </div>
          </div>

          {/* User Profile Section */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white mb-6">User Profile</h2>

            {profileLoading && <div className="text-[#9BA0A2]">Loading profile...</div>}
            {profileError && <div className="text-[#D05F5F]">Error: {profileError}</div>}

            {userProfile && (
              <>
                {/* Name Field */}
                <div className="mb-4 flex items-center gap-3">
                  <label className="text-sm font-semibold text-[#6E7375] w-24">Name:</label>
                  {isEditing.name ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="text"
                        value={editValues.name}
                        onChange={(e) => setEditValues(prev => ({ ...prev, name: e.target.value }))}
                        className="bg-[#161819] border border-[#2A2D2F] rounded px-3 py-1 flex-1 max-w-md text-white focus:border-[#38D39F] focus:outline-none"
                        disabled={isSaving}
                      />
                      <button onClick={() => handleSave('name')} disabled={isSaving} className="text-[#38D39F] hover:text-[#45E4AE] font-semibold px-3">
                        Save
                      </button>
                      <button onClick={() => handleCancel('name')} disabled={isSaving} className="text-[#9BA0A2] hover:text-white font-semibold px-3">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-white">{userProfile.name || "(not set)"}</span>
                      <button onClick={() => handleEdit('name')} className="text-[#38D39F] hover:text-[#45E4AE]" title="Edit name">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* Email Field */}
                <div className="mb-4 flex items-center gap-3">
                  <label className="text-sm font-semibold text-[#6E7375] w-24">Email:</label>
                  {isEditing.email ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="email"
                        value={editValues.email}
                        onChange={(e) => setEditValues(prev => ({ ...prev, email: e.target.value }))}
                        className="bg-[#161819] border border-[#2A2D2F] rounded px-3 py-1 flex-1 max-w-md text-white focus:border-[#38D39F] focus:outline-none"
                        disabled={isSaving}
                      />
                      <button onClick={() => handleSave('email')} disabled={isSaving} className="text-[#38D39F] hover:text-[#45E4AE] font-semibold px-3">
                        Save
                      </button>
                      <button onClick={() => handleCancel('email')} disabled={isSaving} className="text-[#9BA0A2] hover:text-white font-semibold px-3">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-white">{userProfile.email || "(not set)"}</span>
                      {userProfile.email && (
                        <span className={`text-xs px-2 py-1 rounded ${userProfile.email_verified ? 'bg-[#38D39F]/20 text-[#38D39F]' : 'bg-[#E0A85F]/20 text-[#E0A85F]'}`}>
                          {userProfile.email_verified ? 'Verified' : 'Not Verified'}
                        </span>
                      )}
                      <button onClick={() => handleEdit('email')} className="text-[#38D39F] hover:text-[#45E4AE]" title="Edit email">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>

                {/* User ID (read-only) */}
                <div className="mb-4 flex items-center gap-3">
                  <label className="text-sm font-semibold text-[#6E7375] w-24">User ID:</label>
                  <span className="text-[#9BA0A2] text-sm font-mono">{userProfile.user_id}</span>
                </div>

                {/* User Type (read-only) */}
                {userProfile.user_type && (
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-semibold text-[#6E7375] w-24">Account:</label>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-semibold ${
                        userProfile.user_type === 'paid'
                          ? 'bg-[#38D39F]/20 text-[#38D39F]'
                          : userProfile.user_type === 'rewards'
                          ? 'bg-[#E0A85F]/20 text-[#E0A85F]'
                          : 'bg-[#161819] text-[#9BA0A2]'
                      }`}
                    >
                      {userProfile.user_type.charAt(0).toUpperCase() + userProfile.user_type.slice(1)}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Balance Section */}
          {balance && (
            <>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-white">Balance</h2>
                <button
                  onClick={() => setShowTopUpModal(true)}
                  className="bg-[#38D39F] text-[#0B0D0E] font-semibold py-2 px-6 rounded-lg hover:bg-[#45E4AE] transition-colors"
                >
                  Top Up
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-[#161819] border border-[#2A2D2F] p-6 rounded-lg">
                  <h3 className="text-xs font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                    Available Balance
                  </h3>
                  <p className="text-2xl font-bold text-white">${balance.available_balance}</p>
                  {balance.pending_reservations_units > 0 && (
                    <p className="text-xs text-[#6E7375] mt-1">
                      ${balance.pending_reservations} reserved
                    </p>
                  )}
                </div>

                <div className="bg-[#161819] border border-[#2A2D2F] p-6 rounded-lg">
                  <h3 className="text-xs font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                    Regular Balance
                  </h3>
                  <p className="text-2xl font-bold text-white">${balance.balance}</p>
                </div>

                <div className="bg-[#161819] border border-[#2A2D2F] p-6 rounded-lg">
                  <h3 className="text-xs font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                    Rewards Balance
                  </h3>
                  <p className={`text-2xl font-bold ${balance.rewards_balance_units < 0 ? 'text-[#D05F5F]' : 'text-white'}`}>
                    ${balance.rewards_balance}
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Transaction History */}
          <div className="mt-12">
            <h2 className="text-2xl font-bold text-white mb-6">
              Transaction History
            </h2>
            <div className="bg-[#161819] border border-[#2A2D2F] rounded-lg overflow-hidden">
              {txLoading ? (
                <div className="p-8 text-center text-[#9BA0A2]">Loading transactions...</div>
              ) : transactions.length === 0 ? (
                <div className="p-8 text-center text-[#9BA0A2]">No transactions yet</div>
              ) : (
                <table className="min-w-full divide-y divide-[#2A2D2F]">
                  <thead className="bg-[#0B0D0E]">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider w-24">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider w-32">
                        ID
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider w-28">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider">
                        Details
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider">
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-[#161819] divide-y divide-[#2A2D2F]">
                    {transactions.map((tx) => {
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
                      }
                      // Default fallback for unknown transaction types
                      return null;
                    })}
                  </tbody>
                </table>
              )}

              {/* Pagination */}
              {!txLoading && transactions.length > 0 && (
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
              )}
            </div>
          </div>
        </div>
      </main>

      <Footer />

      {/* Top Up Modal */}
      <TopUpModal
        isOpen={showTopUpModal}
        onClose={() => setShowTopUpModal(false)}
        userEmail={userProfile?.email || undefined}
        onSuccess={() => {
          // Start polling for transaction updates (polls every 1s for max 10s)
          startTopUpPolling();
        }}
      />

      <AlertDialog
        isOpen={alertDialog.isOpen}
        onClose={() => setAlertDialog({ ...alertDialog, isOpen: false })}
        title={alertDialog.title}
        message={alertDialog.message}
        type={alertDialog.type}
        onConfirm={alertDialog.onConfirm}
        showCancel={alertDialog.showCancel}
      />
    </div>
  );
}
