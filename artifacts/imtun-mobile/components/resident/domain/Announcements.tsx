import React from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { listResidentAnnouncements } from '@workspace/api-client-react';
import { L, S, type Language } from '@/lib/resident/text';
import { Card, Empty, ErrorBox, Skeleton } from '../Ui';
import { useDomainAccess } from './useDomain';
export default function Announcements({ l }: { l: Language }) { const palette = useAppPalette();
  const { ctxId } = useDomainAccess('announcements');
  const q = useQuery({ queryKey: ['resident-announcements', ctxId], enabled: !!ctxId, queryFn: () => listResidentAnnouncements() });
  return <View style={{ gap: 12 }}>{q.isPending && <Skeleton />}{q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}{q.data && !q.data.length && <Empty text={L(l, S.empty)} />}
    {q.data?.filter(a => a.published).map(a => <Card key={a.id}><Text style={{ fontSize: 11, color: palette.subdued }}>{new Date(a.created_at).toLocaleDateString(l)}</Text><Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 17 }}>{a.title}</Text><Text style={{ color: palette.mutedForeground }}>{a.body}</Text></Card>)}</View>;
}
