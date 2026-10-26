import React, { useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createPayerResponsibility, getPayerResponsibilities, reauthenticateResident, reviewPayerResponsibility } from '@workspace/api-client-react';
import type { PayerResponsibility } from '@workspace/api-client-react';
import type { Language } from '@/lib/resident/text';
import { useContextId } from '@/lib/resident/hooks';
import { Btn, Card, Chip, ErrorBox, Field, Segment, Skeleton } from '../Ui';
import { useAction } from '../useAction';
import { needsReauth, tt } from './core';
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => { const r = Math.floor(Math.random() * 16); return (ch === 'x' ? r : (r & 3) | 8).toString(16); });
const per = (v: string) => v.slice(0, 7);
const stl = (l: Language, s: string) => s === 'pending' ? tt(l, 'Սպասում է', 'Ожидает ответа', 'Awaiting reply') : s === 'accepted' ? tt(l, 'Ընդունված', 'Принято', 'Accepted') : s === 'declined' ? tt(l, 'Մերժված', 'Отклонено', 'Declined') : tt(l, 'Չեղարկված', 'Отозвано', 'Revoked');
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export default function Payer({ l }: { l: Language }) {
  const ctx = useContextId(); const qc = useQueryClient(); const key = ['resident-payer', ctx];
  const q = useQuery({ queryKey: key, enabled: !!ctx, queryFn: () => getPayerResponsibilities(), refetchInterval: 15_000, refetchOnMount: 'always' });
  const a = useAction(l, () => { void qc.invalidateQueries({ queryKey: key }); });
  const [need, setNeed] = useState(false); const [pw, setPw] = useState(''); const [code, setCode] = useState('');
  const [asg, setAsg] = useState(''); const [rec, setRec] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const cid = useRef(uuid()); const pending = useRef<(() => Promise<unknown>) | null>(null);
  const attempt = (fn: () => Promise<unknown>) => { pending.current = fn; void a.run(async () => { try { await fn(); pending.current = null; setNeed(false); } catch (e) { if (needsReauth(e)) { setNeed(true); return; } throw e; } }); };
  if (q.isPending) return <Skeleton />;
  if (q.isError || !q.data) return <Card><ErrorBox message={tt(l, 'Չհաջողվեց բեռնել։', 'Не удалось загрузить.', 'Could not load.')} retryLabel={tt(l, 'Կրկնել', 'Повторить', 'Retry')} onRetry={() => q.refetch()} /></Card>;
  const w = q.data; const next = per(w.nextPeriod); const start = from || next;
  const okRange = MONTH.test(start) && start >= next && (!to || (MONTH.test(to) && to >= start));
  const review = (x: PayerResponsibility, action: 'accept' | 'decline' | 'revoke') => {
    const run=()=>attempt(() => reviewPayerResponsibility(x.id, { action, version: x.version }));
    if(action!=='revoke'){run();return;}
    Alert.alert(tt(l,'Չեղարկե՞լ ապագա պարտավորությունը','Отозвать будущую ответственность?','Revoke future responsibility?'),
      tt(l,'Արդեն հաշվարկված հաշիվները չեն փոխվում։','Уже выставленные счета не изменятся.','Bills already issued will not change.'),
      [{text:tt(l,'Չեղարկել','Отмена','Cancel'),style:'cancel'},
       {text:tt(l,'Հետ կանչել','Отозвать','Revoke'),style:'destructive',onPress:run}]);
  };
  return <Card>
    <Text accessibilityRole="header" style={{ fontWeight: '800', fontSize: 16 }}>{tt(l, 'Վճարողի պատասխանատվություն', 'Ответственность плательщика', 'Payer responsibility')}</Text>
    <Text style={{ fontSize: 11 }}>{tt(l, 'Սա չի տեղափոխում գումար և սեփականություն։ Ընդունված կանոնը գործում է միայն մինչև ստացողը պիտանի է և ծառայությունը միացված է․ արդեն հաշվարկված ժամանակաշրջանները չեն փոխվում։', 'Это не перевод денег и не смена собственника. Принятое правило действует, пока получатель имеет право, а категория включена компанией; уже выставленные периоды не переносятся.', 'This moves no money and no ownership. An accepted rule applies only while the recipient stays eligible and the company keeps the category enabled; periods already billed never move.')}</Text>
    {w.canPropose && <View style={{ gap: 8 }}>
      {w.assignments.filter(x => x.enabled).length ? <Segment label={tt(l, 'Ծառայություն', 'Услуга', 'Service')} value={asg} options={w.assignments.filter(x => x.enabled).map(x => [x.id, x.serviceName] as [string, string])} onChange={setAsg} /> : <Text>{tt(l, 'Ընկերությունը դեռ չի միացրել ծառայություն։', 'Компания пока не включила ни одной категории.', 'The company has not enabled any category yet.')}</Text>}
      {w.recipients.length ? <Segment label={tt(l, 'Ստացող', 'Получатель', 'Recipient')} value={rec} options={w.recipients.map(x => [x.id, x.name] as [string, string])} onChange={setRec} /> : <Text>{tt(l, 'Նույն բնակարանում ակտիվ վարձակալ կամ ընտանիքի անդամ չկա։', 'В этой квартире нет активного арендатора или члена семьи.', 'No active renter or family member in this unit.')}</Text>}
      <Field label={tt(l, 'Սկսած ամսից (ՏՏՏՏ-ԱԱ)', 'С месяца (ГГГГ-ММ)', 'From month (YYYY-MM)')} value={from || next} onChange={setFrom} maxLength={7} />
      <Field label={tt(l, 'Մինչև ամիս ներառյալ (ըստ ցանկության)', 'По месяц включительно (необязательно)', 'Until month, inclusive (optional)')} value={to} onChange={setTo} maxLength={7} />
      {!okRange && <Text>{tt(l, 'Սկիզբը չի կարող լինել հաջորդ ժամանակաշրջանից շուտ։', 'Начало не может быть раньше следующего периода.', 'Start cannot be before the next period.')}</Text>}
      <Btn label={tt(l, 'Ուղարկել առաջարկը', 'Отправить предложение', 'Send proposal')} busy={a.busy} disabled={!asg || !rec || !okRange} onPress={() => attempt(async () => { await createPayerResponsibility({ payerAssignmentId: asg, recipientId: rec, startsOn: start + '-01', ...(to ? { endsOn: to + '-01' } : {}), clientId: cid.current }); cid.current = uuid(); setAsg(''); setRec(''); setFrom(''); setTo(''); })} />
    </View>}
    {w.delegations.map(x => <View key={x.id + x.version} style={{ gap: 6 }}>
      <Text style={{ fontWeight: '700' }}>{x.serviceName}</Text><Text>{x.ownerName} → {x.recipientName}</Text><Text>{per(x.startsOn)} – {x.endsOn ? per(x.endsOn) : tt(l, 'անժամկետ', 'без срока', 'open-ended')}</Text><Chip label={stl(l, x.status)} tone={x.status === 'accepted' ? 'ok' : 'warn'} />
      {x.canAccept && <><Btn label={tt(l, 'Ընդունել', 'Принять', 'Accept')} busy={a.busy} onPress={() => review(x, 'accept')} /><Btn kind="secondary" label={tt(l, 'Մերժել', 'Отклонить', 'Decline')} busy={a.busy} onPress={() => review(x, 'decline')} /></>}
      {x.canRevoke && <Btn kind="danger" label={tt(l, 'Չեղարկել ապագան', 'Отозвать на будущее', 'Revoke future')} busy={a.busy} onPress={() => review(x, 'revoke')} />}</View>)}
    {!w.delegations.length && <Text>{tt(l, 'Առաջարկներ չկան', 'Предложений нет', 'No proposals yet')}</Text>}
    {w.invoices.length ? <View style={{ gap: 4 }}><Text style={{ fontWeight: '700' }}>{tt(l, 'Իմ հրապարակված հաշիվները (դիտման համար)', 'Мои выставленные счета (только просмотр)', 'My published invoices (read-only)')}</Text>{w.invoices.map(i => <Text key={i.id}>{per(i.period)} · {(Number(i.amountMinor) / 100).toLocaleString(l)} {i.currency} · {i.status}</Text>)}</View> : null}
    {need && <View style={{ gap: 8 }}><Text accessibilityRole="alert">{tt(l, 'Պահանջվում է գաղտնաբառի կրկնակի հաստատում։', 'Нужно подтвердить пароль.', 'Password confirmation is required.')}</Text>
      <Field label={tt(l, 'Գաղտնաբառ', 'Пароль', 'Password')} value={pw} onChange={setPw} maxLength={72} />
      <Field label={tt(l, 'MFA կոդ (եթե կա)', 'Код MFA (если есть)', 'MFA code (if enabled)')} value={code} onChange={setCode} keyboard="number-pad" maxLength={30} />
      <Btn label={tt(l, 'Հաստատել և շարունակել', 'Подтвердить и продолжить', 'Confirm and continue')} busy={a.busy} disabled={!pw} onPress={() => void a.run(async () => { await reauthenticateResident({ password: pw, ...(code.length >= 6 ? { code } : {}) }); setPw(''); setCode(''); const fn = pending.current; if (fn) { await fn(); pending.current = null; } setNeed(false); })} /></View>}
    {a.err ? <ErrorBox message={a.err} /> : null}
  </Card>;
}
