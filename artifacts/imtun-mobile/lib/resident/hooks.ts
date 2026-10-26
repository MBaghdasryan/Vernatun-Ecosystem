import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getResidentRecords, getResidentWorkspace, getResidentMessages, useGetMobileAuthSession } from '@workspace/api-client-react';
import type { ResidentRecordKind } from '@workspace/api-client-react';
import type { Language } from './text';

// Every resident query is keyed by the authenticated context id so a context
// switch can never show the previous home's data.
export function useContextId(): string | null {
  const session = useGetMobileAuthSession();
  return session.data?.contextId ?? null;
}
export function useWorkspace() {
  const ctx = useContextId();
  return useQuery({ queryKey: ['resident-ws', ctx], enabled: !!ctx, queryFn: () => getResidentWorkspace() });
}
export function useLang(): Language {
  const ws = useWorkspace();
  return ws.data?.profile.language ?? 'hy';
}
export function useRecords(kind: ResidentRecordKind, enabled: boolean, search = '', filters?: Record<string, unknown>) {
  const ctx = useContextId();
  return useQuery({ queryKey: ['resident-rec', ctx, kind, search, filters ?? {}], enabled: enabled && !!ctx, refetchOnMount: 'always', refetchInterval: kind === 'listings' || kind === 'conversations' ? 30000 : false, queryFn: () => getResidentRecords(kind, (search || (filters && Object.keys(filters).length) ? { ...(search ? { search } : {}), ...filters } : undefined) as never) });
}
export function useMessages(kind: ResidentRecordKind, id: string) {
  const ctx = useContextId();
  return useQuery({ queryKey: ['resident-msg', ctx, kind, id], enabled: !!ctx, queryFn: () => getResidentMessages(kind, id) });
}
export function useResidentRefresh() {
  const qc = useQueryClient();
  const ctx = useContextId();
  return () => { void qc.invalidateQueries({ queryKey: ['resident-rec', ctx] }); void qc.invalidateQueries({ queryKey: ['resident-ws', ctx] }); };
}
export function newUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => { const r = (Math.random() * 16) | 0; return (ch === 'x' ? r : (r & 3) | 8).toString(16); });
}
