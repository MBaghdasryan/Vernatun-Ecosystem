import React from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import type { Language } from '@/lib/resident/text';
import { Card, ErrorBox, Skeleton } from '../Ui';
import { useDomainAccess } from '../domain/useDomain';
import { useWorkspace } from '@/lib/resident/hooks';
import { tt, useContinuity } from './core';
import Account from './Account';
import Chats from './Chats';
import Market from './Market';
import Bookings from './Bookings';
import Help from './Help';
import BuildingFinance from './Finance';
export const continuitySections = ['preferences', 'community', 'marketplace', 'services', 'help', 'building'];
function FinanceGate({ l }: { l: Language }) {
  const ws = useWorkspace(); const acc = useDomainAccess('finance');
  if (!ws.data?.settings.financeTransparency || !acc.allowed) return null;
  return <BuildingFinance l={l} />;
}
export default function Continuity({ section, l }: { section: string; l: Language }) {
  const q = useContinuity();
  if (section === 'building') return <FinanceGate l={l} />;
  if (q.isPending) return <Skeleton />;
  if (q.isError || !q.data) return <Card><ErrorBox message={tt(l, 'Չհաջողվեց բեռնել բաժինը։', 'Не удалось загрузить раздел.', 'Could not load this section.')} retryLabel={tt(l, 'Կրկնել', 'Повторить', 'Retry')} onRetry={() => q.refetch()} /></Card>;
  const d = q.data;
  return section === 'preferences' ? <Account d={d} l={l} /> : section === 'community' ? <Chats d={d} l={l} /> : section === 'marketplace' ? <Market d={d} l={l} /> : section === 'services' ? <Bookings d={d} l={l} /> : <Help d={d} l={l} />;
}
