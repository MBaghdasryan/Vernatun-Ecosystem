import React, { useState } from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createResidentPass, listResidentPasses, revokeResidentPass, useGetMobileAuthSession } from '@workspace/api-client-react';
import { L, S, type Language, type T } from '@/lib/resident/text';
import { Btn, Card, Chip, Empty, ErrorBox, Field, Segment, Skeleton , Tabs } from '../Ui';
import { useAction } from '../useAction';
import { useDomainAccess } from './useDomain';
const D = { visitor: ['Հյուրի անունը', 'Имя гостя', 'Guest name'] as T, vehicle: ['Մեքենայի համարանիշ', 'Госномер', 'Vehicle plate'] as T, hours: ['Վավեր է (ժամ)', 'Действует (часов)', 'Valid for (hours)'] as T, create: ['Ստեղծել անցագիր', 'Создать пропуск', 'Create pass'] as T, revoke: ['Չեղարկել', 'Отозвать', 'Revoke'] as T, note: ['Սա միայն անցագրի տվյալն է․ դռան բացումը կամ սարքի ակտիվացումը չի նշանակում։', 'Это только запись пропуска. Открытие двери или активация устройства не подразумеваются.', 'This only creates the pass record. It does not mean a door opens or a device is activated.'] as T, token: ['Մեկանգամյա կոդ (կպահվի միայն այս էկրանին)', 'Одноразовый код (виден только на этом экране)', 'One-time code (shown on this screen only)'] as T, hide: ['Թաքցնել կոդը', 'Скрыть код', 'Hide code'] as T };
const st: Record<string, T> = { active: ['Ակտիվ', 'Действует', 'Active'], revoked: ['Չեղարկված', 'Отозван', 'Revoked'], expired: ['Ժամկետանց', 'Истёк', 'Expired'], pending: ['Սպասում է', 'Ожидает', 'Pending'] };
export default function Passes({ l }: { l: Language }) { const palette = useAppPalette();
  const { ctxId } = useDomainAccess('passes'); const qc = useQueryClient(); const session = useGetMobileAuthSession();
  const unitId = session.data?.contexts.find(c => c.id === session.data?.contextId)?.unit_id ?? null;
  const q = useQuery({ queryKey: ['resident-passes', ctxId], enabled: !!ctxId, queryFn: () => listResidentPasses() });
  const [visitor, setVisitor] = useState(''); const [vehicle, setVehicle] = useState(''); const [hours, setHours] = useState('24'); const [token, setToken] = useState<string | null>(null);
  const [flt, setFlt] = useState<'active' | 'upcoming' | 'expired' | 'revoked'>('active');
  const bucket = (p: { state: string; revoked_at?: string | null; valid_from: string }) => p.revoked_at || p.state === 'revoked' ? 'revoked' : p.state === 'expired' ? 'expired' : new Date(p.valid_from).getTime() > Date.now() ? 'upcoming' : p.state === 'active' ? 'active' : 'expired';
  const a = useAction(l, () => { void qc.invalidateQueries({ queryKey: ['resident-passes', ctxId] }); });
  const create = () => void a.run(async () => { const from = new Date(); const r = await createResidentPass({ unitId: unitId!, visitor: visitor.trim(), vehicle: vehicle.trim(), validFrom: from.toISOString(), validUntil: new Date(from.getTime() + Number(hours) * 3600e3).toISOString() }); setToken(r.token); setVisitor(''); setVehicle(''); });
  return <View style={{ gap: 12 }}>
    <Card><Text style={{ fontSize: 12, color: palette.mutedForeground }}>{L(l, D.note)}</Text><Field label={L(l, D.visitor)} value={visitor} onChange={setVisitor} maxLength={100} /><Field label={L(l, D.vehicle)} value={vehicle} onChange={setVehicle} maxLength={30} />
      <Segment label={L(l, D.hours)} value={hours} options={[['4', '4'], ['24', '24'], ['72', '72'], ['168', '168']]} onChange={setHours} />
      <Btn label={L(l, D.create)} busy={a.busy} disabled={!unitId || visitor.trim().length < 2} onPress={create} />{a.err ? <ErrorBox message={a.err} /> : null}</Card>
    {token && <Card><Text style={{ color: palette.foreground, fontWeight: '800' }}>{L(l, D.token)}</Text><Text selectable style={{ fontSize: 18, fontWeight: '800' }}>{token}</Text><Btn kind="secondary" label={L(l, D.hide)} onPress={() => setToken(null)} /></Card>}
    {q.isPending && <Skeleton />}{q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}{q.data && !q.data.length && <Empty text={L(l, S.empty)} />}
    <Tabs value={flt} onChange={setFlt} options={[['active', L(l, st.active)], ['upcoming', L(l, ['Սպասվող', 'Предстоящие', 'Upcoming'])], ['expired', L(l, st.expired)], ['revoked', L(l, st.revoked)]]} />
    {q.data && !q.data.filter(p => bucket(p) === flt).length && q.data.length > 0 && <Empty text={L(l, S.empty)} />}
    {q.data?.filter(p => bucket(p) === flt).map(p => <Card key={p.id}><Chip tone={p.state === 'active' ? 'ok' : 'warn'} label={st[p.state] ? L(l, st[p.state]) : '·'} /><Text style={{ color: palette.foreground, fontWeight: '800' }}>{p.visitor}{p.vehicle ? ' · ' + p.vehicle : ''}</Text><Text style={{ fontSize: 12, color: palette.mutedForeground }}>{new Date(p.valid_from).toLocaleString(l)} — {new Date(p.valid_until).toLocaleString(l)}</Text>
      {!p.revoked_at && p.state === 'active' && <Btn kind="danger" label={L(l, D.revoke)} busy={a.busy} onPress={() => void a.run(() => revokeResidentPass(p.id))} />}</Card>)}</View>;
}
