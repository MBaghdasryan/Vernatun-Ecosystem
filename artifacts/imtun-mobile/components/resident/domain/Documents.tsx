import React, { useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { downloadResidentDocument, listResidentDocuments } from '@workspace/api-client-react';
import { L, S, type Language, type T } from '@/lib/resident/text';
import { Btn, Card, Empty, ErrorBox, Skeleton } from '../Ui';
import { useAction } from '../useAction';
import { useDomainAccess } from './useDomain';
const D = { dl: ['Ներբեռնել', 'Скачать', 'Download'] as T, nonative: ['Ֆայլի բացումը այս հավելվածի տարբերակում դեռ հասանելի չէ (անհրաժեշտ է ֆայլերի մոդուլ)։ Փաստաթուղթը բացեք վեբ տարբերակում։', 'Открытие файла в этой сборке приложения пока недоступно (нужен модуль работы с файлами). Откройте документ в веб-версии.', 'Opening files is not available in this app build yet (a file module is required). Open the document in the web version.'] as T };
const cat: Record<string, T> = { general: ['Ընդհանուր', 'Общие', 'General'], finance: ['Ֆինանսներ', 'Финансы', 'Finance'], lease: ['Վարձակալություն', 'Аренда', 'Lease'], ownership: ['Սեփականություն', 'Собственность', 'Ownership'], meeting: ['Ժողով', 'Собрание', 'Meeting'], legal: ['Իրավաբանական', 'Юридические', 'Legal'] };
function Row({ d, l }: { d: { id: string; title: string; media_type: string; created_at: string; category: string }; l: Language }) {
  const a = useAction(l, () => {});
  // Authenticated generated transport only; no public URL. Blob is revoked right after the web download starts.
  const open = () => void a.run(async () => {
    if (Platform.OS !== 'web') throw Object.assign(new Error('native'), { status: 0 });
    const blob = await downloadResidentDocument(d.id); const url = URL.createObjectURL(blob); const el = document.createElement('a'); el.href = url; el.download = d.title; el.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return <Card><Text style={{ fontWeight: '800' }}>{d.title}</Text><Text style={{ fontSize: 11, color: '#697780' }}>{cat[d.category] ? L(l, cat[d.category]) : L(l, cat.general)} · {new Date(d.created_at).toLocaleDateString(l)}</Text>
    <Btn kind="secondary" label={L(l, D.dl)} busy={a.busy} onPress={open} />{Platform.OS !== 'web' && <Text style={{ fontSize: 11, color: '#52616b' }}>{L(l, D.nonative)}</Text>}{a.err && Platform.OS === 'web' ? <ErrorBox message={a.err} /> : null}</Card>;
}
export default function Documents({ l }: { l: Language }) {
  const { ctxId } = useDomainAccess('documents');
  const q = useQuery({ queryKey: ['resident-documents', ctxId], enabled: !!ctxId, queryFn: () => listResidentDocuments() });
  return <View style={{ gap: 12 }}>{q.isPending && <Skeleton />}{q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}{q.data && !q.data.length && <Empty text={L(l, S.empty)} />}{q.data?.map(d => <Row key={d.id} d={d} l={l} />)}</View>;
}
