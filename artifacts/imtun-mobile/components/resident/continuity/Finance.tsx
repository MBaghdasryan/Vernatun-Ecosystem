import React from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getResidentBuildingFinance } from '@workspace/api-client-react';
import type { Language } from '@/lib/resident/text';
import { useContextId } from '@/lib/resident/hooks';
import { Card, ErrorBox, Skeleton } from '../Ui';
import { httpStatus, tt } from './core';
const money = (l: Language, v: string | null, c: string) => v === null ? '—' : (Number(v) / 100).toLocaleString(l, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + c;
export default function BuildingFinance({ l }: { l: Language }) { const palette = useAppPalette();
  const ctx = useContextId(); const q = useQuery({ queryKey: ['resident-cx-finance', ctx], enabled: !!ctx, retry: false, queryFn: () => getResidentBuildingFinance() });
  const off = q.isError && httpStatus(q.error) === 403;
  return <Card><Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 16 }}>{tt(l, 'Շենքի ֆինանսական թափանցիկություն', 'Финансовая прозрачность дома', 'Building finance transparency')}</Text>
    {q.isPending && <Skeleton />}{off && <Text style={{ color: palette.foreground }}>{tt(l, 'Բաժինը հասանելի չէ այս շենքի համար։', 'Раздел недоступен для этого здания.', 'This section is not available for this building.')}</Text>}
    {q.isError && !off && <ErrorBox message={tt(l, 'Չհաջողվեց բեռնել։', 'Не удалось загрузить.', 'Could not load.')} retryLabel={tt(l, 'Կրկնել', 'Повторить', 'Retry')} onRetry={() => q.refetch()} />}
    {q.data && !q.data.length && <Text style={{ color: palette.foreground }}>{tt(l, 'Հրապարակված տվյալներ չկան', 'Опубликованных данных нет', 'No published data')}</Text>}
    {q.data?.map(r => <View key={r.period + r.currency} style={{ gap: 2 }}><Text style={{ color: palette.foreground, fontWeight: '700' }}>{r.period} · {r.currency}</Text>
      {r.status === 'INSUFFICIENT_COHORT' ? <Text style={{ color: palette.foreground }}>{tt(l, 'Անբավարար տվյալներ գաղտնիության համար', 'Недостаточно данных для защиты приватности', 'Not enough data to protect privacy')}</Text> : <><Text style={{ color: palette.foreground }}>{tt(l, 'Հրապարակված գանձումներ', 'Начислено', 'Published charges')}: {money(l, r.publishedMinor, r.currency)}</Text><Text style={{ color: palette.foreground }}>{tt(l, 'Բաշխված վճարումներ', 'Распределено платежей', 'Allocated payments')}: {money(l, r.allocatedMinor, r.currency)}</Text></>}</View>)}</Card>;
}
