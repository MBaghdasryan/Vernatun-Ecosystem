import React, { useState } from 'react';
import { useAppPalette } from '@/hooks/useAppTheme';
import { Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { createResidentServiceBooking, getResidentRecords, reviewResidentServiceBooking } from '@workspace/api-client-react';
import type { ResidentContinuity, ResidentServiceBooking } from '@workspace/api-client-react';
import type { Language } from '@/lib/resident/text';
import { useContextId } from '@/lib/resident/hooks';
import { Btn, Card, Chip, Empty, ErrorBox, Field, Segment } from '../Ui';
import { useAction } from '../useAction';
import { contKey, fmt, parseLocal, tt } from './core';
const off = (d: Date) => { const m = -d.getTimezoneOffset(); const a = Math.abs(m); return `UTC${m < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`; };
const lab = (l: Language, s: ResidentServiceBooking['status']) => ({ requested: tt(l, 'Հարցված', 'Запрошено', 'Requested'), confirming: tt(l, 'Հաստատվում է', 'Подтверждается', 'Confirming'), confirmed: tt(l, 'Հաստատված', 'Подтверждено', 'Confirmed'), rejected: tt(l, 'Մերժված', 'Отклонено', 'Rejected'), cancelled: tt(l, 'Չեղարկված', 'Отменено', 'Cancelled') })[s];
export default function Bookings({ d, l }: { d: ResidentContinuity; l: Language }) { const palette = useAppPalette();
  const qc = useQueryClient(); const ctx = useContextId(); const router = useRouter();
  const a = useAction(l, () => { void qc.invalidateQueries({ queryKey: contKey(ctx) }); });
  const [sid, setSid] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [note, setNote] = useState('');
  const svc = useQuery({ queryKey: ['resident-cx-services', ctx], enabled: d.canBook && !!ctx, queryFn: () => getResidentRecords('services') });
  if (!d.canBook) return <Empty text={tt(l, 'Ամրագրումը միացված չէ։', 'Запись на услуги не включена.', 'Service booking is not enabled.')} />;
  const f = parseLocal(from); const t = parseLocal(to); const ok = !!f && !!t && f.getTime() > Date.now() && t > f && !!sid;
  return <>
    <Card><Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{tt(l, 'Ծառայության ամրագրում', 'Запись на услугу', 'Book a service')}</Text>
      {svc.data && <Segment label={tt(l, 'Ծառայություն', 'Услуга', 'Service')} value={sid} options={svc.data.items.map(s => [s.id, s.title] as [string, string])} onChange={setSid} />}
      {svc.data && !svc.data.items.length && <Text style={{ color: palette.foreground }}>{tt(l, 'Ծառայություններ չկան', 'Услуг нет', 'No services')}</Text>}
      <Field label={tt(l, 'Սկիզբ (ՏՏՏՏ-ԱԱ-ՕՕ ԺԺ:ՐՐ)', 'Начало (ГГГГ-ММ-ДД ЧЧ:ММ)', 'Starts (YYYY-MM-DD HH:MM)')} value={from} onChange={setFrom} maxLength={16} />
      <Field label={tt(l, 'Ավարտ (ՏՏՏՏ-ԱԱ-ՕՕ ԺԺ:ՐՐ)', 'Окончание (ГГГГ-ММ-ДД ЧЧ:ММ)', 'Ends (YYYY-MM-DD HH:MM)')} value={to} onChange={setTo} maxLength={16} />
      <Field label={tt(l, 'Նշում', 'Комментарий', 'Note')} value={note} onChange={setNote} multiline maxLength={500} />
      <Text style={{ color: palette.foreground, fontSize: 11 }}>{tt(l, 'Ժամը մեկնաբանվում է ձեր սարքի ժամային գոտով', 'Время трактуется в часовом поясе устройства', 'Time is read in this device time zone')} ({off(new Date())}). {d.organizationTimezone ? tt(l, `Կազմակերպության ժամային գոտի՝ ${d.organizationTimezone}։ Ժամը գրեք ձեր սարքի ժամանակով։`, `Часовой пояс организации: ${d.organizationTimezone}. Вводите время по часам устройства.`, `Organization time zone: ${d.organizationTimezone}. Enter the time in your device's time zone.`) : tt(l, 'Կազմակերպության ժամային գոտին նշված չէ։', 'Часовой пояс организации не задан.', 'Organization time zone is not set.')}</Text>
      {(from || to) && !ok && <Text style={{ color: palette.foreground }}>{tt(l, 'Ընտրեք ապագա ժամանակ, ավարտը՝ սկզբից հետո։', 'Выберите будущее время; окончание после начала.', 'Pick a real, existing future time (no Feb 31 or clock-change gaps); end must be after start.')}</Text>}
      <Btn label={tt(l, 'Ուղարկել հարցում', 'Отправить запрос', 'Request slot')} busy={a.busy} disabled={!ok} onPress={() => { if (!f || !t) return; void a.run(async () => { await createResidentServiceBooking({ serviceId: sid, startsAt: f.toISOString(), endsAt: t.toISOString(), note: note.trim() }); setNote(''); setFrom(''); setTo(''); }); }} />
      {a.err ? <ErrorBox message={a.err} /> : null}</Card>
    <Card><Text style={{ color: palette.foreground, fontWeight: '800', fontSize: 16 }}>{tt(l, 'Իմ ամրագրումները', 'Мои записи', 'My bookings')}</Text>
      {d.bookings.map(b => <View key={b.id} style={{ gap: 6 }}><Text style={{ color: palette.foreground, fontWeight: '700' }}>{b.title}</Text><Text style={{ color: palette.foreground }}>{fmt(l, b.startsAt)} – {fmt(l, b.endsAt)}</Text><Chip label={lab(l, b.status)} tone={b.status === 'confirmed' ? 'ok' : 'warn'} />
        {b.requestId ? <Btn kind="secondary" label={tt(l, 'Բացել հայտը', 'Открыть заявку', 'Open request')} onPress={() => router.push({ pathname: '/requests', params: { requestId: b.requestId ?? '' } })} /> : null}
        {b.status === 'requested' && <Btn kind="danger" label={tt(l, 'Չեղարկել', 'Отменить', 'Cancel')} busy={a.busy} onPress={() => void a.run(() => reviewResidentServiceBooking(b.id, { action: 'cancel', version: b.version }))} />}</View>)}
      {!d.bookings.length && <Text style={{ color: palette.foreground }}>{tt(l, 'Ամրագրումներ չկան', 'Записей нет', 'No bookings yet')}</Text>}</Card>
  </>;
}
