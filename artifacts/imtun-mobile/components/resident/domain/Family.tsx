import React, { useState } from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createResidentDelegation, getResidentHousehold, listResidentDelegations } from '@workspace/api-client-react';
import { useDomainAccess } from './useDomain';
import { L, S, type Language, type T } from '@/lib/resident/text';
import { Btn, Card, Chip, Empty, ErrorBox, Skeleton, Field, Segment, Toggle , Row, SectionHead } from '../Ui';
import { roleLabel } from '@/lib/resident/shell';
import { useAction } from '../useAction';
import DelegationActions from '../continuity/FamilyActions';
import HouseholdLeases from '../continuity/HouseholdLeases';
import { useCreateOwnerRenterInvitation, useGetMobileAuthSession } from '@workspace/api-client-react';
type Perm = 'requests.own' | 'requests.create' | 'announcements.read' | 'properties.own' | 'access.create';
const perms: [Perm, T][] = [['requests.own', ['Տեսնել հայտերը', 'Видеть заявки', 'See requests']], ['requests.create', ['Ստեղծել հայտեր', 'Создавать заявки', 'Create requests']], ['announcements.read', ['Հայտարարություններ', 'Объявления', 'Announcements']], ['properties.own', ['Տան տվյալներ', 'Данные дома', 'Home details']], ['access.create', ['Հյուրերի անցագրեր', 'Гостевые пропуска', 'Guest passes']]];
const D = { email: ['Էլ. փոստ', 'Эл. почта', 'Email'] as T, phone: ['Հեռախոս', 'Телефон', 'Phone'] as T, until: ['Վավեր է', 'Действует', 'Valid for'] as T, send: ['Ուղարկել հրավեր', 'Отправить приглашение', 'Send invitation'] as T, sent: ['Հրավերն ուղարկված է։ Այն դեռ ընդունված չէ։', 'Приглашение создано. Оно ещё не принято.', 'Invitation created. It has not been accepted yet.'] as T, list: ['Իմ հրավերները', 'Мои приглашения', 'My invitations'] as T, accepted: ['Ընդունված', 'Принято', 'Accepted'] as T, revoked: ['Չեղարկված', 'Отозвано', 'Revoked'] as T, waiting: ['Սպասում է', 'Ожидает', 'Pending'] as T, untilDate: ['Մինչև', 'До', 'Until'] as T };
const days: [string, string][] = [['30', '30'], ['90', '90'], ['180', '180'], ['365', '365']];
export default function Family({ l }: { l: Language }) { const palette = useAppPalette();
  const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [d, setD] = useState('90'); const [sel, setSel] = useState<Perm[]>(['requests.own']); const [ok, setOk] = useState(false);
  const [renterEmail, setRenterEmail] = useState(''); const [renterPhone, setRenterPhone] = useState(''); const [renterPerms, setRenterPerms] = useState<Perm[]>(['requests.own', 'requests.create']); const [renterUrl, setRenterUrl] = useState('');
  const { ctxId } = useDomainAccess('family'); const qc = useQueryClient();
  const session = useGetMobileAuthSession(); const activeContext = session.data?.contexts.find(context => context.id === session.data?.contextId);
  const inviteRenter = useCreateOwnerRenterInvitation();
  const hh = useQuery({ queryKey: ['resident-household', ctxId], enabled: !!ctxId, queryFn: () => getResidentHousehold() });
  const q = useQuery({ queryKey: ['resident-delegations', ctxId], enabled: !!ctxId && hh.data?.canManageDelegations === true, queryFn: () => listResidentDelegations() });
  const a = useAction(l, () => { void qc.invalidateQueries({ queryKey: ['resident-delegations', ctxId] }); });
  const submit = () => void a.run(async () => { await createResidentDelegation({ email: email.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}), expiresAt: new Date(Date.now() + Number(d) * 864e5).toISOString(), permissions: sel }); setOk(true); setEmail(''); setPhone(''); });
  if (hh.isPending) return <Skeleton />;
  if (hh.isError || !hh.data) return <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => hh.refetch()} />;
  const hd = hh.data;
  return <View style={{ gap: 12 }}>
    <SectionHead title={l === 'hy' ? 'Իմ տունը' : l === 'ru' ? 'Моё домохозяйство' : 'My household'} />{!hd.members.length && <Empty text={L(l, S.empty)} />}{hd.members.map(m => <Row key={m.id} icon="user" tone="plain" title={m.name} subtitle={roleLabel(l, m.role) + (m.expiresAt ? ' · ' + new Date(m.expiresAt).toLocaleDateString(l) : '')} />)}
    <HouseholdLeases hh={hd} l={l} ctxId={ctxId} />
    {hd.canManageDelegations ? <><Card>
    <Field testID="family-invite-email" label={L(l, D.email)} value={email} onChange={x => { setOk(false); setEmail(x); }} keyboard="email-address" /><Field testID="family-invite-phone" label={L(l, D.phone)} value={phone} onChange={setPhone} keyboard="phone-pad" />
    <Segment label={L(l, D.until) + ' (d)'} value={d} options={days} onChange={setD} />
    {perms.map(([k, lab]) => <Toggle testID={`family-invite-permission-${k}`} key={k} label={L(l, lab)} value={sel.includes(k)} onChange={x => setSel(x ? [...sel, k] : sel.filter(y => y !== k))} />)}
    <Btn testID="family-invite-submit" label={L(l, D.send)} busy={a.busy} disabled={!email.includes('@') || !sel.length} onPress={submit} />
    {ok && <Text style={{ color: palette.foreground }}>{L(l, D.sent)}</Text>}{a.err ? <ErrorBox message={a.err} /> : null}</Card>{q.isPending && <Skeleton />}{q.isError && <ErrorBox message={L(l, S.fail)} retryLabel={L(l, S.retry)} onRetry={() => q.refetch()} />}{q.data && !q.data.length && <Empty text={L(l, S.empty)} />}
     {q.data?.map(x => <Card key={x.id}><Text style={{ color: palette.foreground, fontWeight: '800' }}>{x.email}</Text><Chip tone={x.accepted_at ? 'ok' : 'warn'} label={L(l, x.revoked_at ? D.revoked : x.accepted_at ? D.accepted : D.waiting)} /><Text style={{ color: palette.foreground, fontSize: 12 }}>{L(l, D.untilDate)}: {new Date(x.expires_at).toLocaleDateString(l)}</Text><DelegationActions x={x} l={l} ctxId={ctxId} /></Card>)}</> : null}
    {activeContext?.role_key.toLowerCase().includes('owner') ? <Card>
      <Text style={{ color: palette.foreground, fontSize: 15, fontWeight: '800' }}>{l === 'hy' ? 'Հրավիրել վարձակալին' : l === 'ru' ? 'Пригласить арендатора' : 'Invite a renter'}</Text>
      <Text style={{ color: palette.mutedForeground, fontSize: 12, lineHeight: 18 }}>{l === 'hy' ? 'Հրավերը կստեղծի միայն մուտքի իրավունք, ոչ թե բնակարանի գրանցում։' : l === 'ru' ? 'Приглашение предоставит только доступ, но не зарегистрирует квартиру.' : 'The invitation grants access only; it does not register an apartment.'}</Text>
      <Field testID="owner-renter-email" label={L(l, D.email)} value={renterEmail} onChange={setRenterEmail} keyboard="email-address" />
      <Field testID="owner-renter-phone" label={L(l, D.phone)} value={renterPhone} onChange={setRenterPhone} keyboard="phone-pad" />
      {perms.map(([key, label]) => <Toggle testID={`owner-renter-permission-${key}`} key={`renter-${key}`} label={L(l, label)} value={renterPerms.includes(key)} onChange={value => setRenterPerms(value ? [...renterPerms, key] : renterPerms.filter(item => item !== key))} />)}
      <Btn testID="owner-renter-invite-submit" label={l === 'hy' ? 'Ուղարկել վարձակալի հրավերը' : l === 'ru' ? 'Отправить приглашение арендатору' : 'Send renter invitation'} busy={inviteRenter.isPending} disabled={!renterEmail.includes('@') || !renterPerms.length} onPress={() => inviteRenter.mutate({ data: { email: renterEmail.trim(), ...(renterPhone.trim() ? { phone: renterPhone.trim() } : {}), expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(), permissions: renterPerms } }, { onSuccess: result => { setRenterUrl(result.url); setRenterEmail(''); setRenterPhone(''); }, onError: () => setRenterUrl('') })} />
      {renterUrl ? <View accessibilityRole="summary" testID="owner-renter-invitation-result"><Text style={{ color: palette.success, fontSize: 12, fontWeight: '700' }}>{l === 'hy' ? 'Հրավերը ստեղծվել է։ Ուղարկեք հղումը վարձակալին։' : l === 'ru' ? 'Приглашение создано. Отправьте ссылку арендатору.' : 'Invitation created. Share this link with the renter.'}</Text><Text selectable style={{ color: palette.foreground, fontSize: 11, marginTop: 6 }}>{renterUrl}</Text></View> : null}
      {inviteRenter.isError ? <ErrorBox message={l === 'hy' ? 'Չհաջողվեց ստեղծել հրավերը։ Կրկին փորձեք։' : l === 'ru' ? 'Не удалось создать приглашение. Попробуйте ещё раз.' : 'Could not create the invitation. Try again.'} /> : null}
    </Card> : null}
    </View>;
}
