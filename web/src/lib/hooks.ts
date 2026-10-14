import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MediaType } from '@netfish/shared';
import { api } from '../api';

export const useConfig = () => useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity });
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: api.me, retry: false, staleTime: 5 * 60_000 });
export const useLanguages = () => useQuery({ queryKey: ['languages'], queryFn: api.languages, staleTime: Infinity });

/** Something about a title changed (request, grab, new subtitles): refresh what shows it. */
export function useRefreshTitle() {
  const qc = useQueryClient();
  return (mediaType?: MediaType, tmdbId?: number) => {
    if (mediaType && tmdbId) void qc.invalidateQueries({ queryKey: ['title', mediaType, String(tmdbId)] });
    void qc.invalidateQueries({ queryKey: ['home'] });
    void qc.invalidateQueries({ queryKey: ['requests'] });
    void qc.invalidateQueries({ queryKey: ['downloads'] });
  };
}
