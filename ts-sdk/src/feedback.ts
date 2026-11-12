/**
 * Feedback API - in-app bug reports on the agents control base.
 *
 * One multipart POST carries the report text plus up to five screenshot or
 * screen-recording attachments; the backend attributes the report to the
 * authenticated identity, stores attachments under
 * <user_id>/<report_id>/ in the dedicated reports bucket, and records the
 * submission in the bug_reports table.
 */
import type { HTTPClient } from './http.js';

export interface FeedbackAttachment {
  filename: string;
  blob: Blob;
}

export interface BugReportSubmission {
  /** Report body; required, 16384 characters max. */
  text: string;
  /** Screenshots or recordings; at most 5, 25 MiB each, 100 MiB total. */
  attachments?: FeedbackAttachment[];
  /** Client version, recorded with the report. */
  appVersion?: string;
  /** Active agent the report is about; best-effort materialized server-side. */
  agentId?: string;
  /** Active session the report is about; best-effort materialized server-side. */
  sessionId?: string;
}

export interface BugReportReceipt {
  id: string;
  attachmentCount: number;
  status: string;
}

export class FeedbackAPI {
  constructor(private http: HTTPClient) {}

  /**
   * Submit a bug report. Returns the backend receipt (report id, stored
   * attachment count, status).
   */
  async submitBugReport(submission: BugReportSubmission, options: { timeout?: number; signal?: AbortSignal } = {}): Promise<BugReportReceipt> {
    const fields: Record<string, string> = { text: submission.text };
    if (submission.appVersion) fields.app_version = submission.appVersion;
    if (submission.agentId) fields.agent_id = submission.agentId;
    if (submission.sessionId) fields.session_id = submission.sessionId;
    const files = (submission.attachments ?? []).map((attachment) => ({
      field: 'attachments',
      filename: attachment.filename,
      blob: attachment.blob,
    }));
    const data = await this.http.postForm<any>(
      '/feedback',
      fields,
      files,
      { timeout: options.timeout, signal: options.signal }
    );
    return {
      id: data?.id ?? '',
      attachmentCount: data?.attachment_count ?? 0,
      status: data?.status ?? '',
    };
  }
}
