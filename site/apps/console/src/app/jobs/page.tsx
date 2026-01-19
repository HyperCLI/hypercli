"use client";

import React, { useEffect, useState } from "react";
import { Header, Footer, useAuth, formatDateTime, getBadgeClass, AlertDialog, getRegionName, getRegionFlag, getAuthBackendUrl } from "@hypercli/shared-ui";
import { useRouter } from "next/navigation";
import AmountDisplay from "../../components/AmountDisplay";

interface Job {
  job_id: string;
  job_key: string;
  user_id: string;
  hostname: string | null;
  state: string;
  gpu_type: string;
  gpu_count: number;
  region: string;
  interruptible: boolean;
  price_per_hour: number;
  price_per_second: number;
  docker_image: string;
  dockerfile: string | null;
  hf_space: string | null;
  command: string[];
  env_vars: { [key: string]: string } | null;
  ports: { [key: string]: number } | null;
  memory_gb: number | null;
  cpu_cores: number | null;
  runtime: number;
  assigned_to: string | null;
  created_at: string;
  launch_by: string;
  expires: string | null;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  completed: boolean | null;
}

type SortColumn = 'job_id' | 'gpu' | 'hostname' | 'state' | 'price_per_hour' | 'created_at';
type SortDirection = 'asc' | 'desc';

interface JobTransaction {
  id: string;
  amount_usd: string;
  status: string;
}

export default function JobsPage() {
  const { isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [totalJobsCount, setTotalJobsCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [expandedJobTx, setExpandedJobTx] = useState<JobTransaction | null>(null);
  const [jobTransactions, setJobTransactions] = useState<Record<string, JobTransaction>>({});
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

  useEffect(() => {
    if (isAuthenticated) {
      fetchJobs();
    }
  }, [isAuthenticated, stateFilter, currentPage]);

  // Auto-refresh jobs every 30 seconds (silent refresh)
  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(() => {
      fetchJobs(true);
    }, 30000);

    return () => clearInterval(interval);
  }, [isAuthenticated, stateFilter]);

  const fetchJobs = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const authToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('auth_token='))
        ?.split('=')[1];

      if (!authToken) {
        if (!silent) {
          setError('No auth token found');
          setLoading(false);
        }
        return;
      }

      let url = getAuthBackendUrl(`/jobs?page=${currentPage}&page_size=${pageSize}`);
      if (stateFilter !== "all") {
        url += `&state=${stateFilter}`;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const jobsData = await response.json();
        // Handle both array (legacy) and paginated response
        setJobs(Array.isArray(jobsData) ? jobsData : jobsData.jobs || []);
        setTotalJobsCount(Array.isArray(jobsData) ? jobsData.length : jobsData.total_count || 0);

        // Fetch transactions for all jobs
        const txResponse = await fetch(
          getAuthBackendUrl("/tx?page_size=100"),
          {
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        if (txResponse.ok) {
          const txData = await txResponse.json();
          // Create a map of job_id to transaction
          const txMap: Record<string, JobTransaction> = {};
          for (const tx of txData.transactions || []) {
            // Check both tx.job_id (new) and tx.meta?.job_id (legacy)
            const jobId = tx.job_id || tx.meta?.job_id;
            if (jobId && tx.transaction_type === 'job') {
              txMap[jobId] = {
                id: tx.id,
                amount_usd: tx.amount_usd,
                status: tx.status
              };
            }
          }
          setJobTransactions(txMap);
        }
      } else if (response.status === 404) {
        setJobs([]);
      } else if (!silent) {
        const errorData = await response.json();
        setError(errorData.detail || 'Failed to load jobs');
      }
    } catch (error) {
      console.error('Error fetching jobs:', error);
      if (!silent) {
        setError(error instanceof Error ? error.message : 'Unknown error');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleCancelJob = async (jobId: string, jobState: string) => {
    // Different messages based on whether job has started (will be billed)
    const isRunning = jobState === 'running';
    const message = isRunning
      ? 'This job is running and you will be charged for the time already used. Cancel anyway?'
      : 'Are you sure you want to cancel this job?';

    setAlertDialog({
      isOpen: true,
      title: "Cancel Job",
      message,
      type: "warning",
      showCancel: true,
      onConfirm: async () => {
        try {
          const authToken = document.cookie
            .split('; ')
            .find(row => row.startsWith('auth_token='))
            ?.split('=')[1];

          if (!authToken) return;

          const response = await fetch(getAuthBackendUrl(`/jobs/${jobId}`), {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json'
            }
          });

          if (response.ok) {
            fetchJobs();
          } else {
            const error = await response.json();
            setAlertDialog({
              isOpen: true,
              title: "Error",
              message: error.detail || 'Failed to cancel job',
              type: "error",
            });
          }
        } catch (error) {
          console.error('Error canceling job:', error);
          setAlertDialog({
            isOpen: true,
            title: "Error",
            message: 'Failed to cancel job',
            type: "error",
          });
        }
      }
    });
  };

  const handleCloneJob = (job: Job) => {
    // Store job config in sessionStorage for the launch page to read
    const cloneConfig = {
      gpu_type: job.gpu_type,
      gpu_count: job.gpu_count,
      region: job.region,
      interruptible: job.interruptible,
      docker_image: job.docker_image,
      dockerfile: job.dockerfile,
      hf_space: job.hf_space,
      command: job.command,
      runtime: job.runtime,
      env_vars: job.env_vars,
      ports: job.ports,
      auth: (job as any).auth  // Auth field from backend
    };
    sessionStorage.setItem('cloneJobConfig', JSON.stringify(cloneConfig));
    router.push('/job');
  };

  const formatJobState = (state: string): string => {
    // Normalize legacy "completed" to "succeeded" for display
    if (state === 'completed') {
      return 'succeeded';
    }
    return state;
  };

  const formatSecondsHumanReadable = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0 && minutes > 0) {
      return `${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${secs}s`;
    }
  };

  const getJobDuration = (job: Job): number | null => {
    if (!job.started_at || !job.completed_at) return null;
    const startedTime = typeof job.started_at === 'number'
      ? job.started_at
      : new Date(job.started_at).getTime() / 1000;
    const completedTime = typeof job.completed_at === 'number'
      ? job.completed_at
      : new Date(job.completed_at).getTime() / 1000;
    return Math.max(0, Math.floor(completedTime - startedTime));
  };

  // Calculate cost from job data when transaction data is not available
  const getJobCost = (job: Job): { amount: number; isEstimate: boolean; isPending: boolean } => {
    const parseTimestamp = (ts: string | number | null): number | null => {
      if (!ts) return null;
      return typeof ts === 'number' ? ts : new Date(ts).getTime() / 1000;
    };

    const startedAt = parseTimestamp(job.started_at);
    const completedAt = parseTimestamp(job.completed_at);

    // For queued/pending jobs, show reserved amount
    if (job.state === 'queued' || job.state === 'assigned' || job.state === 'pending') {
      return { amount: job.runtime * job.price_per_second, isEstimate: false, isPending: true };
    }

    // For running jobs, calculate current cost
    if (job.state === 'running' && startedAt) {
      const now = Date.now() / 1000;
      const duration = now - startedAt;
      return { amount: duration * job.price_per_second, isEstimate: true, isPending: false };
    }

    // For completed/terminated/failed jobs with timestamps
    if (startedAt && completedAt) {
      const duration = completedAt - startedAt;
      return { amount: duration * job.price_per_second, isEstimate: false, isPending: false };
    }

    // For failed jobs that never started
    if (job.state === 'failed' && !startedAt) {
      return { amount: 0, isEstimate: false, isPending: false };
    }

    // Fallback: use runtime as estimate
    return { amount: job.runtime * job.price_per_second, isEstimate: true, isPending: false };
  };

  const handleJobExpand = async (jobId: string) => {
    if (expandedJobId === jobId) {
      setExpandedJobId(null);
      setExpandedJobTx(null);
      return;
    }

    setExpandedJobId(jobId);
    setExpandedJobTx(null);

    // Fetch transaction for this job
    try {
      const authToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('auth_token='))
        ?.split('=')[1];

      if (!authToken) return;

      // Fetch transactions and find the one for this job
      const response = await fetch(
        getAuthBackendUrl(`/tx?job_id=${jobId}`),
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        // Get the first transaction for this job (should be the reservation)
        if (data.transactions && data.transactions.length > 0) {
          const tx = data.transactions[0];
          setExpandedJobTx({
            id: tx.id,
            amount_usd: tx.amount_usd,
            status: tx.status
          });
        }
      }
    } catch (error) {
      console.error('Error fetching job transaction:', error);
    }
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to ascending (except created_at defaults to desc)
      setSortColumn(column);
      setSortDirection(column === 'created_at' ? 'desc' : 'asc');
    }
  };

  const sortedJobs = [...jobs].sort((a, b) => {
    let aValue: any;
    let bValue: any;

    switch (sortColumn) {
      case 'job_id':
        aValue = a.job_id;
        bValue = b.job_id;
        break;
      case 'gpu':
        aValue = `${a.gpu_count}x${a.gpu_type}`;
        bValue = `${b.gpu_count}x${b.gpu_type}`;
        break;
      case 'hostname':
        aValue = a.hostname || '';
        bValue = b.hostname || '';
        break;
      case 'state':
        aValue = a.state;
        bValue = b.state;
        break;
      case 'price_per_hour':
        aValue = a.price_per_hour;
        bValue = b.price_per_hour;
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
            <h1 className="text-4xl font-bold text-white">Jobs</h1>
            <button
              onClick={() => router.push('/job')}
              className="bg-[#38D39F] text-[#0B0D0E] font-semibold py-2 px-6 rounded-lg hover:bg-[#45E4AE] transition-colors"
            >
              Launch GPU
            </button>
          </div>

          {/* State Filter */}
          <div className="flex gap-2 mb-8">
            {['all', 'queued', 'running', 'succeeded', 'terminated', 'failed'].map((state) => (
              <button
                key={state}
                onClick={() => {
                  setStateFilter(state);
                  setCurrentPage(1);
                }}
                className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
                  stateFilter === state
                    ? 'bg-[#38D39F] text-[#0B0D0E]'
                    : 'border border-[#2A2D2F] text-[#D4D6D7] hover:bg-[#161819] hover:border-[#38D39F]'
                }`}
              >
                {state.charAt(0).toUpperCase() + state.slice(1)}
              </button>
            ))}
          </div>

          {loading && <div className="text-[#9BA0A2]">Loading jobs...</div>}
          {error && <div className="text-[#D05F5F] mb-4">Error: {error}</div>}

          {!loading && !error && jobs.length === 0 && (
            <div className="bg-[#161819] border border-[#2A2D2F] p-8 rounded-lg text-center">
              <p className="text-[#9BA0A2] mb-4">You don't have any jobs yet.</p>
            </div>
          )}

          {!loading && jobs.length > 0 && (
            <div className="bg-[#161819] border border-[#2A2D2F] rounded-lg overflow-x-auto">
              <table className="min-w-full divide-y divide-[#2A2D2F]">
                <thead className="bg-[#0B0D0E]">
                  <tr>
                    <th
                      className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider cursor-pointer hover:bg-[#1D1F21] w-24"
                      onClick={() => handleSort('state')}
                    >
                      <div className="flex items-center gap-1">
                        Status
                        {sortColumn === 'state' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider cursor-pointer hover:bg-[#1D1F21] w-32"
                      onClick={() => handleSort('job_id')}
                    >
                      <div className="flex items-center gap-1">
                        Job ID
                        {sortColumn === 'job_id' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider cursor-pointer hover:bg-[#1D1F21] w-28"
                      onClick={() => handleSort('gpu')}
                    >
                      <div className="flex items-center gap-1">
                        Type
                        {sortColumn === 'gpu' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider w-24">
                      Region
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider cursor-pointer hover:bg-[#1D1F21] w-64"
                      onClick={() => handleSort('hostname')}
                    >
                      <div className="flex items-center gap-1">
                        Hostname
                        {sortColumn === 'hostname' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider cursor-pointer hover:bg-[#1D1F21]"
                      onClick={() => handleSort('price_per_hour')}
                    >
                      <div className="flex items-center gap-1">
                        Price/Hour
                        {sortColumn === 'price_per_hour' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider w-20">
                      Cost
                    </th>
                    <th
                      className="px-6 py-3 text-left text-xs font-semibold text-[#6E7375] uppercase tracking-wider cursor-pointer hover:bg-[#1D1F21] w-20"
                      onClick={() => handleSort('created_at')}
                    >
                      <div className="flex items-center gap-1">
                        Created
                        {sortColumn === 'created_at' && (
                          <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-[#161819] divide-y divide-[#2A2D2F]">
                  {sortedJobs.map((job) => (
                    <React.Fragment key={job.job_id}>
                    <tr
                      className="hover:bg-[#1D1F21] cursor-pointer"
                      onClick={(e) => {
                        // Ctrl/Cmd+click opens in new tab
                        if (e.ctrlKey || e.metaKey) {
                          window.open(`/job/${job.job_id}`, '_blank');
                        } else {
                          handleJobExpand(job.job_id);
                        }
                      }}
                    >
                      <td className="px-6 py-4 whitespace-nowrap w-24">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border ${getBadgeClass(job.state)}`}>
                          {formatJobState(job.state)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap w-32">
                        <span className="font-mono text-sm text-white">
                          {job.job_id.substring(0, 8)}...
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap w-28">
                        <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border bg-[#0B0D0E] text-[#D4D6D7] border-[#2A2D2F]">
                          {job.gpu_count}x {job.gpu_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap w-24 text-sm">
                        <span className="inline-flex items-center gap-1" title={getRegionName(job.region)}>
                          <span className="text-lg">{getRegionFlag(job.region)}</span>
                          <span className="text-[#D4D6D7]">{job.region}</span>
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm font-mono w-64">
                        {job.hostname ? (
                          job.ports?.lb ? (
                            <a
                              href={`https://${job.hostname}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[#38D39F] hover:text-[#45E4AE] hover:underline truncate"
                            >
                              <span className="truncate">{job.hostname}</span>
                              <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                              </svg>
                            </a>
                          ) : (
                            <span className="text-[#9BA0A2] truncate block">{job.hostname}</span>
                          )
                        ) : (
                          <span className="text-[#6E7375]">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                        ${job.price_per_hour.toFixed(6)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm w-20">
                        {jobTransactions[job.job_id] ? (
                          <span className={
                            jobTransactions[job.job_id].status.toLowerCase() === 'pending'
                              ? 'text-[#D4D6D7] italic'
                              : job.state === 'failed' || job.state === 'canceled'
                              ? 'line-through text-[#9BA0A2]'
                              : 'text-white'
                          }>
                            <AmountDisplay amountUsd={jobTransactions[job.job_id].amount_usd} />
                          </span>
                        ) : (
                          (() => {
                            // Calculate cost from job data when transaction not available
                            const { amount, isEstimate, isPending } = getJobCost(job);
                            return (
                              <span className={
                                isPending ? 'text-[#D4D6D7] italic' :
                                job.state === 'failed' || job.state === 'canceled' ? 'line-through text-[#9BA0A2]' :
                                'text-white'
                              }>
                                ${amount.toFixed(2)}{isEstimate && job.state === 'running' ? '+' : ''}
                              </span>
                            );
                          })()
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-[#9BA0A2] w-20">
                        {formatDateTime(job.created_at)}
                      </td>
                    </tr>
                    {/* Expandable Details Row */}
                    {expandedJobId === job.job_id && (
                      <tr>
                        <td colSpan={8} className="px-6 py-4 bg-[#0B0D0E]">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                              <h3 className="text-sm font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                                Job ID
                              </h3>
                              <p className="font-mono text-sm text-white">{job.job_id}</p>
                            </div>

                            <div>
                              <h3 className="text-sm font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                                GPU Configuration
                              </h3>
                              <span className="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded border bg-[#161819] text-[#D4D6D7] border-[#2A2D2F]">
                                {job.gpu_count}x {job.gpu_type}
                              </span>
                            </div>

                            <div>
                              <h3 className="text-sm font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                                Price
                              </h3>
                              <p className="text-white">${job.price_per_hour.toFixed(2)}/hour</p>
                            </div>

                            <div>
                              <h3 className="text-sm font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                                {(job.state === 'queued' || job.state === 'assigned') ? 'Reserved Amount' : 'Total Cost'}
                              </h3>
                              {expandedJobTx ? (
                                <p className={
                                  job.state === 'queued' || job.state === 'assigned'
                                    ? 'text-[#D4D6D7] italic'
                                    : job.state === 'failed' || job.state === 'canceled'
                                    ? 'line-through text-[#9BA0A2]'
                                    : 'text-white'
                                }>
                                  <AmountDisplay amountUsd={expandedJobTx.amount_usd} />
                                  {(job.state === 'queued' || job.state === 'assigned') && (
                                    <span className="text-xs ml-1">(pending)</span>
                                  )}
                                </p>
                              ) : (
                                (() => {
                                  const { amount, isEstimate, isPending } = getJobCost(job);
                                  return (
                                    <p className={
                                      isPending ? 'text-[#D4D6D7] italic' :
                                      job.state === 'failed' || job.state === 'canceled' ? 'line-through text-[#9BA0A2]' :
                                      'text-white'
                                    }>
                                      ${amount.toFixed(2)}{isEstimate && job.state === 'running' ? '+' : ''}
                                      {isPending && <span className="text-xs ml-1">(pending)</span>}
                                      {isEstimate && job.state === 'running' && <span className="text-xs ml-1">(running)</span>}
                                    </p>
                                  );
                                })()
                              )}
                            </div>

                            {job.hostname && (
                              <div>
                                <h3 className="text-sm font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                                  Hostname
                                </h3>
                                {job.ports?.lb ? (
                                  <div className="flex items-center gap-2">
                                    <a
                                      href={`https://${job.hostname}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="font-mono text-sm text-[#38D39F] hover:text-[#45E4AE] hover:underline"
                                    >
                                      {job.hostname}
                                    </a>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(`https://${job.hostname}`, '_blank');
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-[#38D39F]/20 text-[#38D39F] rounded hover:bg-[#38D39F]/30"
                                      title="Open in new tab"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                      </svg>
                                      Open
                                    </button>
                                  </div>
                                ) : (
                                  <p className="font-mono text-sm text-white">{job.hostname}</p>
                                )}
                              </div>
                            )}

                            {job.assigned_to && (
                              <div>
                                <h3 className="text-sm font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                                  Assigned To
                                </h3>
                                <p className="font-mono text-sm text-white">{job.assigned_to}</p>
                              </div>
                            )}

                            {job.started_at && (
                              <div>
                                <h3 className="text-sm font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                                  Started At
                                </h3>
                                <p className="text-white">{formatDateTime(job.started_at)}</p>
                              </div>
                            )}

                            {getJobDuration(job) !== null && (
                              <div>
                                <h3 className="text-sm font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                                  Duration
                                </h3>
                                <p className="text-white">{formatSecondsHumanReadable(getJobDuration(job)!)}</p>
                              </div>
                            )}

                            <div>
                              <h3 className="text-sm font-semibold text-[#6E7375] uppercase tracking-wider mb-2">
                                Docker Image
                              </h3>
                              <p className="font-mono text-sm text-white truncate" title={job.docker_image}>{job.docker_image}</p>
                            </div>
                          </div>
                          <div className="flex gap-3 mt-4 pt-4 border-t border-[#2A2D2F]">
                            <a
                              href={`/job/${job.job_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="bg-[#38D39F] text-[#0B0D0E] font-semibold py-2 px-4 rounded-lg hover:bg-[#45E4AE] transition-colors"
                            >
                              View Job
                            </a>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCloneJob(job);
                              }}
                              className="border border-[#2A2D2F] text-[#D4D6D7] font-semibold py-2 px-4 rounded-lg hover:bg-[#161819] hover:border-[#38D39F] transition-colors"
                            >
                              Clone Job
                            </button>
                            {(job.state === 'queued' || job.state === 'assigned' || job.state === 'running') && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelJob(job.job_id, job.state);
                                }}
                                className="border border-[#2A2D2F] text-[#D05F5F] font-semibold py-2 px-4 rounded-lg hover:bg-[#D05F5F]/10 hover:border-[#D05F5F] transition-colors"
                              >
                                Cancel Job
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              <div className="bg-[#161819] px-6 py-3 flex items-center justify-between border-t border-[#2A2D2F]">
                <div className="text-sm text-[#9BA0A2]">
                  <span className="font-medium text-white">{(currentPage - 1) * pageSize + 1}</span>
                  {' - '}
                  <span className="font-medium text-white">{Math.min(currentPage * pageSize, totalJobsCount)}</span>
                  {' of '}
                  <span className="font-medium text-white">{totalJobsCount}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 border border-[#2A2D2F] rounded text-sm font-medium text-[#D4D6D7] hover:bg-[#1D1F21] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => p + 1)}
                    disabled={currentPage * pageSize >= totalJobsCount}
                    className="px-3 py-1.5 border border-[#2A2D2F] rounded text-sm font-medium text-[#D4D6D7] hover:bg-[#1D1F21] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
