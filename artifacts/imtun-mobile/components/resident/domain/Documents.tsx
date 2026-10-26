import React, { useEffect, useRef } from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { listResidentDocuments } from '@workspace/api-client-react';
import { openPrivateDocument } from '@/lib/resident/privateDocument';
import { L, S, type Language, type T } from '@/lib/resident/text';
import { Btn, Card, Empty, ErrorBox, Skeleton } from '../Ui';
import { useAction } from '../useAction';
import { useDomainAccess } from './useDomain';
const D = { dl: ['Բացել / պահպանել', 'Открыть / сохранить', 'Open / save'] as T };
const cat: Record<string, T> = { general: ['Ընդհանուր', 'Общие', 'General'], finance: ['Ֆինանսներ', 'Финансы', 'Finance'], lease: ['Վարձակալություն', 'Аренда', 'Lease'], ownership: ['Սեփականություն', 'Собственность', 'Ownership'], meeting: ['Ժողով', 'Собрание', 'Meeting'], legal: ['Իրավաբանական', 'Юридические', 'Legal'] };
function Row({ d, l }: { d: { id: string; title: string; media_type: string; created_at: string; category: string }; l: Language }) { const palette = useAppPalette();
  const a = useAction(l, () => {});
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const open = () => void a.run(async () => {
    request.current?.abort();
    request.current = new AbortController();
    await openPrivateDocument(d, request.current.signal);
  });
  return <Card><Text style={{ color: palette.foreground, fontWeight: '800' }}>{d.title}</Text><Text style={{ fontSize: 11, color: palette.subdued }}>{cat[d.category] ? L(l, cat[d.category]) : L(l, cat.general)} · {new Date(d.created_at).toLocaleDateString(l)}</Text>
    <Btn kind="secondary" label={L(l, D.dl)} busy={a.busy} onPress={open} />{a.err ? <ErrorBox message={a.err} /> : null}</Card>;
}
export default function Documents({ l }: { l: Language }) {
  const { ctxId } = useDomainAccess('documents');
  const q = useQuery({ queryKey: ['resident-documents', ctxId], enabled: !!ctxId, queryFn: () => listResidentDocuments() });
  return <View style={{ gap: 12 }}>{q.isPending && <Skeleton />}{q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}{q.data && !q.data.length && <Empty text={L(l, S.empty)} />}{q.data?.map(d => <Row key={`${ctxId}:${d.id}`} d={d} l={l} />)}</View>;
}
