import { config } from '../config';
import { request, type RequestOptions } from '../lib/upstream';

/**
 * SuggestArr's public API (/api/v1, since 2.11): it requests in Seerr what people may like,
 * from what they watched in Jellyfin. Netfish reads what it requested, and starts its jobs.
 * Called from the server only: the key acts as the SuggestArr user who made it.
 */

export interface SarrRequest {
  tmdb_id: string | number;
  media_type: 'movie' | 'tv';
  title?: string | null;
  /** The watched title it came from: a TMDB id of the same kind, or a tag ("discover", "ai_search"…). */
  source_media_id?: string | null;
  source_origin?: string | null;
  requested_at?: string;
  /** The Jellyfin user whose history it came from (32 hex characters). */
  media_user?: { id: string } | null;
}

export interface SarrJob {
  id: number;
  name: string;
  job_type: string;
  enabled: boolean;
  schedule_type?: 'preset' | 'cron';
  schedule_value?: string;
}

export interface SarrRun {
  id: number;
  job_id: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  results_count?: number;
  requested_count?: number;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

interface Page<T> {
  data: T;
  meta?: { page: number; per_page: number; total: number; pages: number };
}

const call = <T>(path: string, opts: RequestOptions = {}) =>
  request<Page<T>>('SuggestArr', `${config.suggestarr.url}/api/v1`, path, {
    timeoutMs: 8000,
    ...opts,
    headers: { 'x-api-key': config.suggestarr.apiKey ?? '' },
  });

export const suggestarr = {
  me: () => call<{ id: number; username: string; role: string }>('/me').then((r) => r.data),
  jobs: () => call<SarrJob[]>('/jobs').then((r) => r.data),
  runs: (jobId: number, opts: { status?: SarrRun['status']; perPage?: number } = {}) =>
    call<SarrRun[]>('/runs', { query: { job_id: jobId, status: opts.status, per_page: opts.perPage ?? 1 } }).then((r) => r.data),
  run: (jobId: number) => call<SarrRun>(`/jobs/${jobId}/runs`, { method: 'POST' }).then((r) => r.data),
  requests: (page: number, perPage = 100) => call<SarrRequest[]>('/requests', { query: { page, per_page: perPage, sort: 'date_desc' } }),
};
