import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createResidentDelegation, listResidentDelegations } from '@workspace/api-client-react';
import { useDomainAccess } from './useDomain';
import { L, S, type Language, type T } from '@/lib/resident/text';
import { Btn, Card, Chip, Empty, ErrorBox, Skeleton, Field, Segment, Toggle } from '../Ui';
import { useAction } from '../useAction';
type Perm = 'requests.own' | 'requests.create' | 'announcements.read' | 'properties.own' | 'access.create';
const perms: [Perm, T][] = [['requests.own', ['Տեսնել հայտերը', 'Видеть заявки', 'See requests']], ['requests.create', ['Ստեղծել հայտեր', 'Создавать заявки', 'Create requests']], ['announcements.read', ['Հայտարարություններ', 'Объявления', 'Announcements']], ['properties.own', ['Տան տվյալներ', 'Данные дома', 'Home details']], ['access.create', ['Հյուրերի անցագրեր', 'Гостевые пропуска', 'Guest passes']]];
const D = { email: ['Էլ. փոստ', 'Эл. почта', 'Email'] as T, phone: ['Հեռախոս', 'Телефон', 'Phone'] as T, until: ['Վավեր է', 'Действует', 'Valid for'] as T, send: ['Ուղարկել հրավեր', 'Отправить приглашение', 'Send invitation'] as T, sent: ['Հրավերն ուղարկված է։ Այն դեռ ընդունված չէ։', 'Приглашение создано. Оно ещё не принято.', 'Invitation created. It has not been accepted yet.'] as T, list: ['Իմ հրավերները', 'Мои приглашения', 'My invitations'] as T, accepted: ['Ընդունված', 'Принято', 'Accepted'] as T, revoked: ['Չեղարկված', 'Отозвано', 'Revoked'] as T, waiting: ['Սպասում է', 'Ожидает', 'Pending'] as T, untilDate: ['Մինչև', 'До', 'Until'] as T };
const days: [string, string][] = [['30', '30'], ['90', '90'], ['180', '180'], ['365', '365']];
export default function Family({ l }: { l: Language }) {
  const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [d, setD] = useState('90'); const [sel, setSel] = useState<Perm[]>(['requests.own']); const [ok, setOk] = useState(false);
  const { ctxId } = useDomainAccess('family'); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['resident-delegations', ctxId], enabled: !!ctxId, queryFn: () => listResidentDelegations() });
  const a = useAction(l, () => { void qc.invalidateQueries({ queryKey: ['resident-delegations', ctxId] }); });
  const submit = () => void a.run(async () => { await createResidentDelegation({ email: email.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}), expiresAt: new Date(Date.now() + Number(d) * 864e5).toISOString(), permissions: sel }); setOk(true); setEmail(''); setPhone(''); });
  return <View style={{ gap: 12 }}><Card>
    <Field label={L(l, D.email)} value={email} onChange={x => { setOk(false); setEmail(x); }} keyboard="email-address" /><Field label={L(l, D.phone)} value={phone} onChange={setPhone} keyboard="phone-pad" />
    <Segment label={L(l, D.until) + ' (d)'} value={d} options={days} onChange={setD} />
    {perms.map(([k, lab]) => <Toggle key={k} label={L(l, lab)} value={sel.includes(k)} onChange={x => setSel(x ? [...sel, k] : sel.filter(y => y !== k))} />)}
    <Btn label={L(l, D.send)} busy={a.busy} disabled={!email.includes('@') || !sel.length} onPress={submit} />
    {ok && <Text>{L(l, D.sent)}</Text>}{a.err ? <ErrorBox message={a.err} /> : null}</Card>{q.isPending && <Skeleton />}{q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}{q.data && !q.data.length && <Empty text={L(l, S.empty)} />}
    {q.data?.map(x => <Card key={x.id}><Text style={{ fontWeight: '800' }}>{x.email}</Text><Chip tone={x.accepted_at ? 'ok' : 'warn'} label={L(l, x.revoked_at ? D.revoked : x.accepted_at ? D.accepted : D.waiting)} /><Text style={{ fontSize: 12 }}>{L(l, D.untilDate)}: {new Date(x.expires_at).toLocaleDateString(l)}</Text></Card>)}</View>;
}
