import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getNotificationPreferences, getUnreadNotificationCount, listResidentNotifications, markResidentNotificationRead, updateNotificationPreferences } from '@workspace/api-client-react';
import type { NotificationPreferences } from '@workspace/api-client-react';
import { L, S, type Language, type T } from '@/lib/resident/text';
import { Btn, Card, Chip, Empty, ErrorBox, Skeleton, Toggle } from '../Ui';
import { useAction } from '../useAction';
import { useDomainAccess } from './useDomain';
const cat: Record<string, T> = { requests: ['Հայտեր', 'Заявки', 'Requests'], finance: ['Ֆինանսներ', 'Финансы', 'Finance'], community: ['Համայնք', 'Сообщество', 'Community'], access: ['Մուտք', 'Доступ', 'Access'], leases: ['Վարձակալություն', 'Аренда', 'Leases'], support: ['Աջակցություն', 'Поддержка', 'Support'], onboarding: ['Միացում', 'Подключение', 'Onboarding'], system: ['Համակարգ', 'Система', 'System'] };
const D = { unread: ['Չկարդացված', 'Непрочитанные', 'Unread'] as T, inapp: ['Հավելվածում', 'В приложении', 'In-app'] as T, email: ['Էլ. փոստ', 'Эл. почта', 'Email'] as T, list: ['Ծանուցումներ', 'Уведомления', 'Notifications'] as T, read: ['Նշել կարդացված', 'Прочитано', 'Mark read'] as T, crit: ['Կարևոր', 'Важное', 'Critical'] as T, denied: ['Բովանդակությունը հասանելի չէ', 'Содержимое недоступно', 'Content unavailable'] as T };
const kindText = (l: Language, k: string, c: string) => cat[c] ? L(l, cat[c]) : L(l, ['Ծանուցում', 'Уведомление', 'Notification']);
const viewingText: Record<string,T> = {
  viewing_requested: ['Դիտման նոր հարցում', 'Новый запрос на просмотр', 'New viewing request'],
  viewing_confirmed: ['Դիտումը հաստատվեց', 'Просмотр подтверждён', 'Viewing confirmed'],
  viewing_declined: ['Դիտումը մերժվեց', 'Просмотр отклонён', 'Viewing declined'],
  viewing_cancelled: ['Դիտումը չեղարկվեց', 'Просмотр отменён', 'Viewing cancelled'],
};
export default function Notifications({ l }: { l: Language }) {
  const { ctxId } = useDomainAccess('notifications'); const qc = useQueryClient();
  const n = useQuery({ queryKey: ['resident-unread', ctxId], enabled: !!ctxId, queryFn: () => getUnreadNotificationCount() });
  const p = useQuery({ queryKey: ['resident-notif-pref', ctxId], enabled: !!ctxId, queryFn: () => getNotificationPreferences() });
  const list = useQuery({ queryKey: ['resident-notif', ctxId], enabled: !!ctxId, queryFn: () => listResidentNotifications() });
  const rd = useAction(l, () => { void qc.invalidateQueries({ queryKey: ['resident-notif', ctxId] }); void qc.invalidateQueries({ queryKey: ['resident-unread', ctxId] }); });
  const [v, setV] = useState<NotificationPreferences | null>(null);
  useEffect(() => { if (p.data) setV(p.data); }, [p.data]);
  const a = useAction(l, () => { void qc.invalidateQueries({ queryKey: ['resident-notif-pref', ctxId] }); });
  const setCat = (k: string, f: 'email' | 'in_app', x: boolean) => v && setV({ ...v, categories: { ...v.categories, [k]: { ...v.categories[k], [f]: x } } });
  return <View style={{ gap: 12 }}>
    <Card><Text style={{ fontWeight: '800' }}>{L(l, D.unread)}: {n.isPending ? '…' : n.data ? n.data.unread : L(l, S.unknown)}</Text></Card>
    {list.isPending && <Skeleton />}{list.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => list.refetch()} />}{list.data && !list.data.length && <Empty text={L(l, S.empty)} />}
    {list.data?.map(x => <Card key={x.id}><View style={{ flexDirection: 'row', gap: 8 }}><Chip tone={x.read_at ? 'ok' : 'warn'} label={viewingText[x.event_code] ? L(l, viewingText[x.event_code]) : kindText(l, x.kind, x.category)} />{x.critical && <Chip tone="warn" label={L(l, D.crit)} />}</View><Text style={{ fontSize: 12 }}>{new Date(x.created_at).toLocaleString(l)}</Text>{x.access_denied && <Text style={{ fontSize: 12 }}>{L(l, D.denied)}</Text>}{!x.read_at && !x.access_denied && <Btn kind="secondary" label={L(l, D.read)} busy={rd.busy} onPress={() => void rd.run(() => markResidentNotificationRead(x.id))} />}</Card>)}
    {p.isPending && <Skeleton />}{p.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => p.refetch()} />}
    {v && <Card><Toggle label={L(l, D.inapp)} value={v.in_app_enabled} onChange={x => setV({ ...v, in_app_enabled: x })} /><Toggle label={L(l, D.email)} value={v.email_enabled} onChange={x => setV({ ...v, email_enabled: x })} />
      {Object.keys(cat).map(k => <View key={k}><Text style={{ fontWeight: '700' }}>{L(l, cat[k])}</Text><Toggle label={L(l, D.inapp)} value={v.categories[k]?.in_app ?? true} onChange={x => setCat(k, 'in_app', x)} /><Toggle label={L(l, D.email)} value={v.categories[k]?.email ?? true} onChange={x => setCat(k, 'email', x)} /></View>)}
      <Btn label={L(l, S.save)} busy={a.busy} onPress={() => void a.run(() => updateNotificationPreferences(v))} />{a.err ? <ErrorBox message={a.err} /> : null}</Card>}
  </View>;
}
