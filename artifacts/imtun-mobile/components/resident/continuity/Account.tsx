import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { confirmResidentEmailVerification, startResidentEmailVerification, updateResidentNotificationSettings } from '@workspace/api-client-react';
import type { ResidentContinuity, ResidentNotificationSettings } from '@workspace/api-client-react';
import type { Language } from '@/lib/resident/text';
import { useContextId } from '@/lib/resident/hooks';
import { Btn, Card, Chip, ErrorBox, Field, Toggle } from '../Ui';
import { useAction } from '../useAction';
import Avatar from './Avatar';
import { contKey, httpStatus, tt } from './core';
function Email({ d, l, refresh }: { d: ResidentContinuity; l: Language; refresh: () => void }) {
  const [sent, setSent] = useState(false); const [code, setCode] = useState(''); const [left, setLeft] = useState(0); const [note, setNote] = useState('');
  const a = useAction(l, refresh);
  useEffect(() => { if (left <= 0) return; const id = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(id); }, [left]);
  const start = () => { setNote(''); void a.run(async () => { try { await startResidentEmailVerification(); setSent(true); setLeft(60); } catch (e) { if (httpStatus(e) === 429) { setLeft(60); setNote(tt(l, 'Սպասեք նոր կոդ պահանջելուց առաջ։', 'Подождите перед повторной отправкой.', 'Please wait before requesting another code.')); } else throw e; } }); };
  return <Card>
    <Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 16 }}>{tt(l, 'Էլ. փոստի հաստատում', 'Подтверждение почты', 'Email verification')}</Text>
    <Text>{d.email || '—'}</Text><Chip label={d.emailVerified ? tt(l, 'Հաստատված է', 'Подтверждена', 'Verified') : tt(l, 'Չհաստատված', 'Не подтверждена', 'Not verified')} tone={d.emailVerified ? 'ok' : 'warn'} />
    {!d.emailVerified && <>
      <Btn label={left > 0 ? tt(l, `Կրկին ${left} վրկ հետո`, `Снова через ${left} с`, `Resend in ${left}s`) : sent ? tt(l, 'Կրկին ուղարկել', 'Отправить снова', 'Resend code') : tt(l, 'Ուղարկել կոդը', 'Отправить код', 'Send code')} disabled={left > 0} busy={a.busy} onPress={start} />
      {sent && <><Field label={tt(l, '6-նիշ կոդ', '6-значный код', '6-digit code')} value={code} onChange={v => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboard="number-pad" maxLength={6} />
        <Btn label={tt(l, 'Հաստատել', 'Подтвердить', 'Confirm')} disabled={code.length !== 6} busy={a.busy} onPress={() => void a.run(async () => { await confirmResidentEmailVerification({ code }); setCode(''); setSent(false); })} /></>}</>}
    {note ? <Text>{note}</Text> : null}{a.err ? <ErrorBox message={a.err} /> : null}
  </Card>;
}
function Notify({ v, l, refresh }: { v: ResidentNotificationSettings; l: Language; refresh: () => void }) {
  const [s, setS] = useState(v); const [ok, setOk] = useState(false); const a = useAction(l, refresh);
  const set = <K extends keyof ResidentNotificationSettings>(k: K, x: ResidentNotificationSettings[K]) => { setOk(false); setS({ ...s, [k]: x }); };
  return <Card>
    <Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 16 }}>{tt(l, 'Ծանուցումներ', 'Уведомления', 'Notifications')}</Text>
    <Toggle label={tt(l, 'Էլ. փոստով', 'По почте', 'By email')} value={s.emailEnabled} onChange={x => set('emailEnabled', x)} />
    <Toggle label={tt(l, 'Հավելվածում', 'В приложении', 'In app')} value={s.inAppEnabled} onChange={x => set('inAppEnabled', x)} />
    <Toggle label={tt(l, 'Լռության ժամեր', 'Тихие часы', 'Quiet hours')} value={s.quietEnabled} onChange={x => set('quietEnabled', x)} />
    {s.quietEnabled && <>
      <Field label={tt(l, 'Սկիզբ (ԺԺ:ՐՐ)', 'С (ЧЧ:ММ)', 'From (HH:MM)')} value={s.quietStart} onChange={x => set('quietStart', x)} maxLength={5} />
      <Field label={tt(l, 'Ավարտ (ԺԺ:ՐՐ)', 'До (ЧЧ:ММ)', 'To (HH:MM)')} value={s.quietEnd} onChange={x => set('quietEnd', x)} maxLength={5} />
      <Field label={tt(l, 'Ժամային գոտի (օր.՝ Asia/Yerevan)', 'Часовой пояс (напр. Asia/Yerevan)', 'Time zone (e.g. Asia/Yerevan)')} value={s.timezone} onChange={x => set('timezone', x)} maxLength={64} /></>}
    <Text style={{ fontSize: 11 }}>{tt(l, 'Լռության ժամերը հետաձգում են ոչ կրիտիկական ծանուցումները․ էլ. փոստի աշխատողը դեռ կարգավորված չէ, իսկ անվտանգության կոդերը ուղարկվում են անմիջապես։', 'Тихие часы откладывают некритичные уведомления. Почтовый обработчик пока не настроен; коды безопасности отправляются сразу.', 'Quiet hours defer non-critical notifications. The email worker is not configured yet; security codes are always sent immediately.')}</Text>
    <Btn label={tt(l, 'Պահպանել', 'Сохранить', 'Save')} busy={a.busy} onPress={() => void a.run(async () => { await updateResidentNotificationSettings(s); setOk(true); })} />
    {ok && <Text accessibilityRole="alert">{tt(l, 'Պահպանված է', 'Сохранено', 'Saved')}</Text>}{a.err ? <ErrorBox message={a.err} /> : null}
  </Card>;
}
export default function Account({ d, l }: { d: ResidentContinuity; l: Language }) {
  const qc = useQueryClient(); const ctx = useContextId(); const router = useRouter();
  const refresh = () => { void qc.invalidateQueries({ queryKey: contKey(ctx) }); };
  const act = d.activation;
  return <>
    {act && <Card><Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 16 }}>{tt(l, 'Ակտիվացում', 'Активация', 'Activation')}</Text>
      <Chip label={act.ready ? tt(l, 'Պատրաստ է', 'Готово', 'Ready') : act.required ? tt(l, 'Պարտադիր է', 'Требуется', 'Required') : tt(l, 'Ոչ պարտադիր', 'Не требуется', 'Not required')} tone={act.ready ? 'ok' : 'warn'} />
      <Text>{act.emailVerified ? '✓ ' : '○ '}{tt(l, 'Էլ. փոստը հաստատված է', 'Почта подтверждена', 'Email verified')}</Text>
      <Text>{act.missingAgreements === 0 ? '✓ ' : '○ '}{act.missingAgreements === 0 ? tt(l, 'Պարտադիր համաձայնագրերը ընդունված են', 'Обязательные соглашения приняты', 'Mandatory agreements accepted') : tt(l, `Չընդունված համաձայնագրեր՝ ${act.missingAgreements}`, `Не принято соглашений: ${act.missingAgreements}`, `Agreements pending: ${act.missingAgreements}`)}</Text>
      {act.missingAgreements > 0 && <Btn kind="secondary" label={tt(l, 'Բացել համաձայնագրերը', 'Открыть соглашения', 'Open agreements')} onPress={() => router.push({ pathname: '/resident/[section]', params: { section: 'agreements' } })} />}</Card>}
    <Email d={d} l={l} refresh={refresh} />
    <Card><Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 16 }}>{tt(l, 'Հեռախոսի հաստատում', 'Подтверждение телефона', 'Phone verification')}</Text>
      <Text>{tt(l, 'SMS մատակարարը կարգավորված չէ, հեռախոսը հաստատել հնարավոր չէ։ (PROVIDER_REQUIRED)', 'SMS-провайдер не подключён, подтвердить телефон пока нельзя. (PROVIDER_REQUIRED)', 'No SMS provider is configured; the phone cannot be verified yet. (PROVIDER_REQUIRED)')}</Text></Card>
    <Avatar l={l} available={d.avatarAvailable === true} ctx={ctx} refresh={refresh} />
    <Notify key={d.notificationSettings.version} v={d.notificationSettings} l={l} refresh={refresh} />
  </>;
}
