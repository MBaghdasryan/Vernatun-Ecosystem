import { useGetMobileAuthSession } from '@workspace/api-client-react';
import { domainAvailable, type DomainView } from '@/lib/resident/domain';
export function useDomainAccess(v: DomainView) {
  const s = useGetMobileAuthSession();
  const ctx = s.data?.contexts.find(c => c.id === s.data?.contextId);
  return { ctxId: s.data?.contextId ?? null, loading: s.isPending, allowed: domainAvailable(ctx, v) };
}
